# Architecture

How Cash Atlas is put together, and why.

---

## 1. System overview

```
Banks / Financial Institutions
             │
             ▼
           Plaid
             │  webhooks + /transactions/sync
             ▼
   Supabase Edge Functions          ← PLAID_SECRET, access tokens, ANTHROPIC_API_KEY
             │
             ▼
     Normalisation Layer            ← classification, transfer detection
             │
             ▼
     Supabase PostgreSQL            ← source of truth, protected by RLS
             │
       ┌─────┴──────┐
       ▼            ▼
 React Dashboard   Finance Chat Tools
       │            │
       │            ▼
       │        Claude API
       │            │
       └─────┬──────┘
             ▼
           User
```

Two rules define the boundary:

**The browser reads the database directly.** Balances, transactions and reporting RPCs are queried straight from Supabase under Row Level Security. Routing every read through an Edge Function would add latency and a second authorisation layer to get wrong, for no gain.

**The browser never performs a privileged operation.** Anything touching `PLAID_SECRET`, a Plaid access token, the Anthropic key or the service-role key runs in an Edge Function. There is no third option.

---

## 2. The canonical calculation path

The requirement that the dashboard, the Cash Flow screen and the AI assistant cannot disagree is met structurally, not by discipline: **there is only one implementation of each figure, and it lives in SQL.**

```
transactions (raw)
      │
      ▼
transactions_classified          ← THE definition of what a transaction means
      │
      ├── dashboard_cash_summary()
      ├── monthly_cashflow()
      ├── spending_by_category()
      ├── income_by_source()
      ├── top_merchants()
      ├── transfer_summary()
      └── cash_trend()
                │
     ┌──────────┴──────────┐
     ▼                     ▼
React (TanStack Query)   Atlas AI tools
```

`monthly_cashflow()` is called by the Overview card, the Cash Flow screen and the `get_monthly_cashflow` AI tool. They receive the same rows. There is no second code path that could drift.

### What TypeScript does and does not compute

| Concern | Owner |
|---|---|
| Classifying a transaction at write time | TypeScript (Edge Function normalisation) |
| Detecting transfer pairs | TypeScript (Edge Function) |
| Aggregating classified rows into totals | **SQL only** |
| Summing monthly rows into a period total | TypeScript (`sumCashflow`) |
| Formatting for display | TypeScript |

`sumCashflow` adds up rows the database already produced; it never recomputes a monthly figure from raw transactions. The one piece of arithmetic it does perform independently — the period savings rate — is recomputed from summed components rather than averaged across months, because averaging a ratio weights a $100 month equally with a $10,000 month.

### Exclusion buckets partition exactly

`transactions_classified` assigns every eligible outflow to exactly one `spending_exclusion_bucket`, or to none (in which case it is spending). Therefore:

```
gross_debits = expense_outflows
             + internal_transfers + credit_card_payments + investment_transfers
             + unclassified_outflows + adjustment_outflows
             + user_excluded_outflows + other_non_expense_outflows
```

This is what makes the calculation panel *arithmetic* rather than narrative. `buildSpendingExplanation` asserts the identity and sets `balances: false` if it ever fails, so a schema change that breaks it surfaces as a visible warning instead of a quietly wrong total. `scripts/validate-migrations.sh` proves the partition against real rows in CI.

---

## 3. Data model

```
auth.users
    │
    ├── profiles                 base currency, timezone      (1:1, created by trigger)
    ├── institutions             one row per user per bank
    │       │
    │       └── plaid_items      one authenticated connection
    │               │                   │
    │               │                   └── plaid_item_secrets   ← encrypted access token
    │               │                                              (service role only)
    │               └── accounts
    │                       ├── balance_snapshots      daily history
    │                       └── transactions
    │                               ├── transfer_matches   outgoing ↔ incoming pairs
    │                               └── source_transaction_id → refund's original purchase
    │
    ├── transaction_rules        reusable classification rules
    └── sync_runs                operational log
```

### Three classifications, never merged

A transaction carries three independent opinions about what it is:

| Columns | Written by | Overwritten by |
|---|---|---|
| `plaid_category_*`, `amount`, `pending` | Sync, from Plaid | Sync only |
| `system_type`, `system_transfer_subtype` | Normalisation | Normalisation, freely |
| `user_type`, `user_transfer_subtype` | The user | The user only |

Effective type resolves as **user → system → UNKNOWN**. Because the layers never overwrite each other, a user override can be undone to reveal what the classifier decided, and that can be traced back to what the bank actually reported. Column-level `GRANT`s enforce this: the browser role can write `user_*` and nothing else.

### Pending transactions

Excluded from every aggregate. Plaid replaces a pending transaction with a posted one, so counting both would double-count a single purchase. Sync additionally retires the superseded pending row via `plaid_pending_transaction_id`, so the protection is belt and braces. Pending rows remain visible in the transaction list with a badge — they are real activity — they just do not contribute to totals.

### Removal is soft

A Plaid `removed` event sets `removed_at` rather than deleting the row. Every financial view filters removed rows out, so the effect on figures is identical, but the history remains auditable.

### Currency

Every account and transaction keeps its native currency. Aggregates filter to the profile's `base_currency` (default `CAD`) and **return an explicit count of what they excluded**:

- `dashboard_cash_summary()` returns `excluded_account_count` and `excluded_currencies`.
- `monthly_cashflow()` returns `foreign_currency_transaction_count`.

The UI shows these ("Excludes 2 accounts in USD"), so a total is never quietly incomplete. FX conversion is not implemented; the schema and RPCs are shaped so it can be added later without changing the reporting contract.

---

## 4. Plaid integration

### Connect

```
Browser                Edge Function              Plaid
   │  click connect         │                       │
   ├───────────────────────▶│  /link/token/create   │
   │                        ├──────────────────────▶│
   │    link_token          │                       │
   │◀───────────────────────┤                       │
   │  Plaid Link UI ────────────────────────────────▶│  user authenticates
   │  public_token          │                       │
   ├───────────────────────▶│  /item/public_token/exchange
   │                        ├──────────────────────▶│
   │                        │  access_token         │
   │                        │  → encrypt, store in plaid_item_secrets
   │                        │  → sync accounts
   │                        │  → initialise transaction sync
   │  safe metadata only    │
   │◀───────────────────────┤
```

The access token never leaves the server, and the exchange response contains only counts and the institution name.

### Transaction sync is incremental

`/transactions/sync` with a persisted per-Item cursor. Full date-range re-downloads are never used.

```
load cursor → fetch page → apply added/modified/removed
            → more pages? repeat
            → COMMIT cursor only after the page is applied
            → normalise → detect transfers → record sync_run
```

**Cursor discipline:** the cursor advances only after its page has been committed. A crash mid-sync replays that page rather than skipping it. Combined with upserts keyed on `plaid_transaction_id`, replaying is harmless — which is what makes sync idempotent.

### Webhooks are primary, cron is the safety net

Plaid webhooks (`SYNC_UPDATES_AVAILABLE`, `ITEM_ERROR`, `PENDING_EXPIRATION`) drive updates. `plaid-sync-all` on a schedule catches anything a missed webhook would otherwise strand. See MANUAL_SETUP.md for the cron configuration, which is not applied automatically.

---

## 5. Transfer detection

A dedicated service, not scattered SQL conditions. Given an unmatched outflow it scores candidate inflows on:

- amount equality within a tolerance
- opposite direction (`areOpposingDirections`)
- different account, same owner
- compatible currencies
- proximity in date
- Plaid's own `TRANSFER_*` categorisation
- description and institution similarity
- known credit-card payment patterns

Scores combine into a confidence in `[0, 1]`, and the confidence decides the outcome:

| Confidence | Status | Effect on spending |
|---|---|---|
| High | `AUTO_MATCHED` | Excluded immediately |
| Middling | `NEEDS_REVIEW` | **Still counted** until confirmed |
| — | `USER_CONFIRMED` | Excluded |
| — | `USER_REJECTED` | Counted; the pair is never proposed again |

Uncertain matches do not silently alter spending. The count of pending reviews is surfaced in the sidebar, because unreviewed matches make every spending figure provisional.

**Idempotency** comes from `unique (outgoing_transaction_id, incoming_transaction_id)` plus partial unique indexes ensuring a transaction participates in at most one live match. Re-running detection updates rows in place. Rejected matches are retained precisely so detection can see them and not re-propose.

**Rejection returns both legs to `UNKNOWN`** rather than guessing. We have learned the transfer hypothesis was wrong; we have not learned what is right, and inventing a classification would move money between the income and spending totals without evidence. The transactions appear in the review queue instead.

### Credit-card payments

A payment from chequing to a connected card is not new spending — the purchases on that card are already counted. But this only holds when the card *is* connected. The engine requires a matched inflow on a credit account owned by the same user; it never excludes a transaction merely because its description contains "PAYMENT". An unmatched payment to an unconnected card stays in spending, which is the conservative and correct answer.

---

## 6. Security model

### Layered, not single-point

| Layer | Protection |
|---|---|
| Network | Only browser-facing functions expose CORS; webhook and scheduled functions do not |
| Platform | `verify_jwt` rejects unauthenticated calls before our code runs |
| Application | Edge Functions derive `user_id` from the verified JWT, never from the request body |
| Row | RLS scopes every table to `auth.uid()` |
| Column | `GRANT UPDATE (…)` restricts which fields the browser may write |
| Storage | Access tokens encrypted with AES-256-GCM |

### Why access tokens live in their own table

`plaid_item_secrets` has RLS enabled and **zero policies**, with all grants revoked from `anon` and `authenticated`. Only the service role reaches it.

This is stronger than a column on `plaid_items` protected by a policy. A column can be exposed by a `select *` in a new view, a forgotten column grant, or a policy edited carelessly. A table with no policies denies by default and has no mechanism by which a mistake could open it. `scripts/validate-migrations.sh` asserts the property in CI.

### What is never logged

`src/lib/logger.ts` and the Edge Function logger redact any key matching `token|secret|password|key|authorization|cookie|credential`, and any *value* shaped like a Plaid token, a JWT or a Supabase key. Financial amounts are not logged either — a console entry is not a safe place for someone's balances.

`sync_runs` stores stable error codes and safe messages only. Never a raw exception, payload or token.

### Claude's access

The assistant receives **no database access, no SQL capability and no credentials**. It can call a fixed list of typed tools. Each tool is implemented server-side, validates its arguments with Zod, and runs scoped to the authenticated user. `search_transactions` accepts structured filters that map onto PostgREST operators; there is nowhere to put SQL.

Structured response blocks (metric cards, charts, tables) are built **deterministically from tool results**, not from model output. Claude supplies prose; it cannot type a number into a metric card. This is why the assistant cannot contradict the dashboard.

---

## 7. Edge Function organisation

Entrypoints are thin:

```
supabase/functions/plaid-sync-transactions/index.ts
   → parse request, verify JWT, validate with Zod
   → SyncTransactionsController
        → TransactionSyncService
             → PlaidClient              (retries, timeouts)
             → TransactionRepository    (upserts, cursor persistence)
             → NormalizationService     (classification)
             → TransferDetectionService (matching)
   → map result to an HTTP response
```

Shared code lives in `supabase/functions/_shared/`: `auth/`, `controllers/`, `services/`, `repositories/`, `plaid/`, `anthropic/`, `validation/`, `errors/`, `logging/`, `config/`, `types/`, `financial/`.

Every function returns the same error envelope, and never a stack trace:

```json
{ "error": { "code": "STABLE_CODE", "message": "Safe, human-readable", "requestId": "…" } }
```

Configuration is read once through a central config module rather than scattered `Deno.env.get` calls, so a missing secret produces one clear startup error naming the variable.

---

## 8. Frontend architecture

```
UI component  →  feature hook  →  api function  →  Supabase
```

Components never call Supabase. `api.ts` holds data access, `hooks.ts` wraps it in TanStack Query with a key from the central registry.

### Query keys and invalidation

Every key is namespaced by user id, so signing in as a different user cannot surface the previous user's cached figures. `financialDataKeys(userId)` lists every family derived from transactions or balances; mutations invalidate the whole list.

That is deliberately coarse. Invalidating a subset after reclassifying a transaction is how you end up with the Cash Flow screen disagreeing with the Transactions screen the user just edited — the exact failure this application exists to prevent.

### No mock mode

There is no `USE_MOCK_DATA`, no fixture switching, no demo mode. The app either talks to its real backend or renders a configuration state naming the missing variables. Test fixtures exist only under `__tests__/` and `e2e/`.

### State handling

Because nothing is fabricated, state handling carries real weight. Distinguishing these is not pedantry:

- **Empty** — no data yet; offers the action that creates it.
- **No results** — data exists, filters excluded it. Telling someone with 4,000 transactions they have none is a bug.
- **Zero** — a legitimate `$0`, rendered as a figure with an explanation so it cannot be mistaken for a failure.
- **Unknown** — `—`, not `$0`. A user with no accounts has an unknown balance.

Error boundaries wrap each route and each independent card, mirroring the partial-failure principle in sync: one failing chart does not take down the balances beside it.

---

## 9. Decisions worth knowing

**Unclassified outflows are excluded from Actual Spending, and reported.**
The alternative — counting them — would fold undetected transfers into spending, the exact problem this app solves. But silently dropping them understates spending, so `monthly_cashflow` returns `unclassified_outflows` and `unclassified_transaction_count`, the explanation panel gives them their own line, and the UI links to the review queue. The figure is provisional and says so.

**Pending transactions do not count.**
Deterministic, and it matches what "actual" means. The alternative double-counts across the pending→posted transition.

**Views are `SECURITY INVOKER`.**
RLS on the base tables applies through them. A view cannot become a data leak. Requires PostgreSQL 15+, which is why the migration validator refuses to run on 14.

**Transfer confirm/reject/relink are RPCs, not table writes.**
Each touches three rows atomically and must verify the caller owns both legs. A `WITH CHECK` clause complex enough to do that is a worse place for the logic than a `SECURITY DEFINER` function that re-derives the user from `auth.uid()`.

**Balance snapshots are unique per account per UTC day.**
Re-running a sync updates the day's row instead of creating near-duplicate history. `cash_trend` takes the latest snapshot at or before each month end and reports `is_complete`, so a partial month looks partial rather than looking like a dip.

**Spending is not coloured red.**
A grocery shop is not an error. Colouring every expense red makes genuinely urgent states — reconnect required, unclassified — invisible. Direction is carried by an explicit `+`/`−`, an icon and a screen-reader label, so meaning never depends on colour alone.

**Tailwind 3.4, not 4.**
shadcn/ui's Tailwind 4 support is newer and the migration touches every token. Boring and well-trodden wins for styling infrastructure.

**Database types are committed.**
`src/types/database.types.ts` is regenerated with `pnpm db:types`. It is committed so CI can typecheck without a database.

---

## 10. Implementation status

| Phase | Status |
|---|---|
| Foundation — app, tooling, shell, auth, design system, domain layer | ✅ Complete |
| Database — schema, constraints, indexes, RLS, canonical views and RPCs | ✅ Complete |
| Screens — Overview, Accounts | ✅ Complete |
| Screens — Transactions, Transfer Review, Cash Flow, Settings | 🚧 In progress |
| Edge Functions — Plaid connect, sync, webhooks, refresh, removal | 🚧 In progress |
| Normalisation — classification, rules, transfer detection, card matching | 🚧 In progress |
| Atlas AI — `finance-chat`, tools, structured responses | 🚧 In progress |

Routes for unbuilt screens render an explicit "not built yet" panel. They contain no sample financial data, so nothing on them can be mistaken for a working feature.
