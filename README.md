# Cash Atlas

A personal finance application that answers one question honestly: **how much did I actually earn and spend?**

Bank aggregators are bad at this. Move $2,000 from chequing to savings and most apps count it as $2,000 of spending. Pay off a credit card whose purchases they already counted, and they count it again. Cash Atlas removes movements between your own accounts, credit-card payments for purchases already recorded, and investment contributions — then shows you exactly how it arrived at the number.

```
Gross debits                       $15,842
Less internal transfers            −$3,210
Less credit card payments          −$4,712
Less investment transfers          −$1,089
Less applicable refunds               −$0
─────────────────────────────────────────
Actual spending                     $6,831
```

Every figure in the app breaks down like this, and the AI assistant answers from the same numbers the dashboard shows.

---

## What it does

- **Cash position** — total cash, checking and savings across every connected institution.
- **Real income and spending** — monthly figures with internal transfers, card payments and investment contributions excluded.
- **Transaction explorer** — filter, search and reclassify; every override is preserved separately from what your bank reported.
- **Transfer review** — uncertain matches are surfaced for confirmation rather than silently applied.
- **Cash flow analysis** — income vs spending trends, category breakdowns, top merchants, and a full audit of what was excluded and why.
- **Atlas AI** — ask questions in plain language; Claude answers using a fixed set of read-only financial tools, never raw SQL.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 18, TypeScript (strict), Vite 6, React Router 6 |
| Styling | Tailwind CSS 3.4, shadcn/ui (Radix primitives), Lucide icons |
| Charts | Recharts |
| Server state | TanStack Query 5 |
| Forms & validation | React Hook Form, Zod |
| Backend | Supabase — PostgreSQL, Auth, RLS, Edge Functions (Deno), cron |
| Bank data | Plaid (Link, Accounts, Transactions, Webhooks) |
| AI | Anthropic Claude API with tool calling |
| Testing | Vitest, React Testing Library, Playwright |
| Hosting | Vercel (frontend), Supabase (everything else) |
| Package manager | pnpm |

There is no separate Node server. Supabase *is* the backend.

**Tailwind 3.4 rather than 4** — deliberate. shadcn/ui's Tailwind 4 support is newer, and this project values a boring, well-trodden styling setup over the latest major. See `ARCHITECTURE.md` for the other notable decisions.

---

## Repository structure

```
├── src/
│   ├── app/                    Router, shell, providers, query client
│   ├── components/
│   │   ├── ui/                 shadcn/ui primitives
│   │   └── common/             Metric cards, empty/error/loading states, badges
│   ├── config/env.ts           Frontend environment validation
│   ├── features/               Feature-based modules
│   │   ├── accounts/           api.ts · hooks.ts · components
│   │   ├── auth/
│   │   ├── cash-flow/
│   │   ├── chat/
│   │   ├── connections/        Plaid Link and Edge Function calls
│   │   ├── overview/
│   │   ├── settings/
│   │   ├── transactions/
│   │   └── transfers/
│   ├── lib/
│   │   ├── financial/          Domain layer: direction, money, classification, cash flow
│   │   ├── supabase/           Client, query keys, error normalisation
│   │   └── logger.ts           Structured logging with redaction
│   └── types/database.types.ts Generated Supabase types
├── supabase/
│   ├── migrations/             All schema changes, in order
│   └── functions/
│       ├── _shared/            Controllers, services, repositories, clients
│       └── <function-name>/    Thin HTTP entrypoints
├── e2e/                        Playwright specs
├── scripts/                    Migration validation, secret scanning
└── docs/
```

Within a feature: `api.ts` holds data access, `hooks.ts` wraps it in TanStack Query, and components consume the hooks. Components never call Supabase directly.

---

## Local development

**Prerequisites:** Node 20.11+, pnpm 10+, [Supabase CLI](https://supabase.com/docs/guides/cli), Docker (for the local Supabase stack).

```bash
pnpm install
cp .env.example .env.local

pnpm db:start          # starts local Supabase; prints the URL and keys
                       # paste them into .env.local
pnpm db:reset          # applies every migration
pnpm db:types          # regenerates src/types/database.types.ts

pnpm dev               # http://localhost:5173
```

Without valid Supabase configuration the app shows a setup screen naming the missing variables. It does not fall back to sample data — there is no demo mode.

For the full path to real bank data (Plaid credentials, Edge Function secrets, webhooks, deployment), follow **[MANUAL_SETUP.md](./MANUAL_SETUP.md)**.

---

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm build` | Production build |
| `pnpm preview` | Serve the production build locally |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm format` | Prettier |
| `pnpm test` | Vitest |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:coverage` | Coverage report |
| `pnpm test:e2e` | Playwright |
| `pnpm verify` | typecheck → lint → test → build |
| `pnpm db:start` / `db:stop` | Local Supabase stack |
| `pnpm db:reset` | Drop and re-apply all migrations |
| `pnpm db:diff -- <name>` | Generate a migration from local schema changes |
| `pnpm db:push` | Apply migrations to the linked remote project |
| `pnpm db:types` | Regenerate types from the local database |
| `pnpm db:types:remote` | Regenerate types from the linked project |
| `pnpm functions:serve` | Run Edge Functions locally |
| `pnpm functions:deploy` | Deploy Edge Functions |
| `./scripts/validate-migrations.sh` | Apply migrations to a throwaway PostgreSQL and assert security invariants (no Docker needed) |
| `./scripts/check-no-secrets.sh` | Scan tracked files for credentials |

---

## Testing

The financial domain is tested hardest, because a wrong number there is worse than a crash — it looks correct.

```bash
pnpm test
```

Covered:

- **Plaid sign interpretation** — purchases, deposits, card payments, refunds, on both depository and credit accounts.
- **Actual spending** — refunds reducing spending, exclusion components summing exactly to the result, refund-dominated months netting negative.
- **Savings rate** — zero income returns `null`, never `0` or `Infinity`; period rates recomputed from summed components rather than averaged.
- **Classification precedence** — user override beats system classification beats `UNKNOWN`, and a stale system subtype never attaches to a user decision.
- **Money formatting** — a missing value renders as `—`, a genuine zero renders as `$0.00`, foreign currencies carry their ISO code.

Database migrations are verified against a real PostgreSQL 17 server by `./scripts/validate-migrations.sh`, which also asserts that RLS is enabled on every table, that `plaid_item_secrets` has no policies, and that the browser role cannot write Plaid-owned columns.

Playwright covers the shell, SPA routing and the rule that no financial figure appears before authentication.

---

## Deployment

**Frontend → Vercel.** `vercel.json` sets the build command, output directory, SPA rewrites and security headers. Only `VITE_`-prefixed variables are configured there, and only publishable values.

**Backend → Supabase.** Migrations via `pnpm db:push`, Edge Functions via `pnpm functions:deploy`, secrets via `supabase secrets set`.

`PLAID_SECRET`, `ANTHROPIC_API_KEY`, `ACCESS_TOKEN_ENCRYPTION_KEY` and the service-role key are Supabase Edge Function secrets. None of them may ever appear in a `VITE_` variable — CI fails the build if one does.

Full step-by-step: **[MANUAL_SETUP.md](./MANUAL_SETUP.md)**.

---

## Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — system design, data model, sync flow, transfer matching, security model, and the reasoning behind each significant decision.
- **[MANUAL_SETUP.md](./MANUAL_SETUP.md)** — every remaining manual step, with exact commands.
