# Manual setup

Everything that cannot be automated from this repository, in the order it needs doing.

Nothing here has been done for you. No Supabase project has been created, no Plaid account configured, no deployment made. This document exists so you never have to ask *"what do I have to fill in to make this real?"*

> **The code is complete.** Every Edge Function, migration and screen described below is implemented. Nothing here requires further development — only configuration and third-party account setup.

**Time:** roughly 45–60 minutes for a first run, most of it waiting on dashboards.

---

## Quick reference: where every value goes

| Variable | Where it belongs | Scope | Obtain from |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `.env.local` + Vercel env | Public (in the bundle) | Supabase → Project Settings → API |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env.local` + Vercel env | Public (in the bundle) | Supabase → Project Settings → API Keys |
| `PLAID_CLIENT_ID` | Supabase Edge Function secret | **Server only** | Plaid Dashboard → Developers → Keys |
| `PLAID_SECRET` | Supabase Edge Function secret | **Server only** | Plaid Dashboard → Developers → Keys |
| `PLAID_ENV` | Supabase Edge Function secret | Server only | `sandbox` or `production` |
| `PLAID_WEBHOOK_URL` | Supabase Edge Function secret | Server only | Your deployed function URL |
| `PLAID_REDIRECT_URI` | Supabase Edge Function secret | Server only | Optional; OAuth institutions only |
| `ANTHROPIC_API_KEY` | Supabase Edge Function secret | **Server only** | console.anthropic.com → API Keys |
| `ACCESS_TOKEN_ENCRYPTION_KEY` | Supabase Edge Function secret | **Server only** | Generate — command below |
| `SUPABASE_SERVICE_ROLE_KEY` | Injected automatically | **Server only** | Do not set manually |

> **Never** put a value from the "Server only" rows into a `VITE_`-prefixed variable or into Vercel's environment. Vite inlines `VITE_` variables into the JavaScript bundle, where anyone can read them. `./scripts/check-no-secrets.sh` fails CI if this happens.

---

## 1. Supabase

### 1.1 Create the project

- [ ] Create an account at [supabase.com](https://supabase.com).
- [ ] Create a new project. Choose a region close to you and **save the database password** — it is shown once.
- [ ] Note the **project ref** from the URL: `https://supabase.com/dashboard/project/<PROJECT_REF>`.

### 1.2 Install and link the CLI

- [ ] Install the CLI:
      ```bash
      brew install supabase/tap/supabase       # macOS
      # or see https://supabase.com/docs/guides/cli
      ```
- [ ] Log in:
      ```bash
      supabase login
      ```
- [ ] Link this repository to your project:
      ```bash
      supabase link --project-ref <PROJECT_REF>
      ```

### 1.3 Apply migrations

- [ ] Push the schema:
      ```bash
      pnpm db:push
      ```
- [ ] Confirm the tables exist — Supabase → Table Editor. You should see `profiles`, `institutions`, `plaid_items`, `plaid_item_secrets`, `accounts`, `balance_snapshots`, `transactions`, `transfer_matches`, `transaction_rules`, `sync_runs`.
- [ ] Every table except `profiles` should be **empty**. That is correct — Cash Atlas seeds no financial data.

### 1.4 Confirm authentication

- [ ] Supabase → Authentication → Providers → **Email** is enabled.
- [ ] Authentication → URL Configuration:
  - **Site URL**: `http://localhost:5173` for local work; your Vercel production URL once deployed.
  - **Redirect URLs**: add both `http://localhost:5173/**` and `https://<your-app>.vercel.app/**`.
- [ ] Decide on email confirmation (Authentication → Providers → Email → *Confirm email*). For a personal app, turning it off makes first sign-up quicker. The sign-up screen handles both cases.

### 1.5 Confirm Row Level Security

- [ ] Supabase → Advisors → **Security Advisor**. Resolve anything reported.
- [ ] Verify the access-token table is locked down — SQL Editor:
      ```sql
      select count(*) as policy_count
      from pg_policies
      where schemaname = 'public' and tablename = 'plaid_item_secrets';
      -- must return 0

      select has_table_privilege('authenticated', 'public.plaid_item_secrets', 'SELECT');
      -- must return false
      ```
- [ ] Verify RLS is on everywhere:
      ```sql
      select relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false;
      -- must return no rows
      ```

### 1.6 Generate the encryption key

Plaid access tokens are encrypted at rest with AES-256-GCM.

- [ ] Generate a 32-byte key:
      ```bash
      openssl rand -base64 32
      ```
- [ ] **Store it in your password manager.** If it is lost, every stored access token becomes undecryptable and each institution must be reconnected through Plaid Link.

### 1.7 Set Edge Function secrets

- [ ] Set them all (replace the placeholders with real values):
      ```bash
      supabase secrets set \
        PLAID_CLIENT_ID=<from Plaid dashboard> \
        PLAID_SECRET=<from Plaid dashboard> \
        PLAID_ENV=production \
        PLAID_WEBHOOK_URL=https://<PROJECT_REF>.supabase.co/functions/v1/plaid-webhook \
        ANTHROPIC_API_KEY=<from console.anthropic.com> \
        ACCESS_TOKEN_ENCRYPTION_KEY=<the base64 key from 1.6>
      ```
- [ ] Confirm they are set (names only are shown; values are never displayed):
      ```bash
      supabase secrets list
      ```

> `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions automatically. Do not set them.

**Changing a secret requires redeploying the functions** (§1.8) for the new value to take effect.

### 1.8 Deploy Edge Functions

- [ ] Deploy everything:
      ```bash
      pnpm functions:deploy
      ```
- [ ] Confirm in Supabase → Edge Functions that each function is listed.
- [ ] Note the webhook URL — you need it for Plaid:
      ```
      https://<PROJECT_REF>.supabase.co/functions/v1/plaid-webhook
      ```

### 1.9 Configure scheduled synchronisation

Webhooks are the primary update mechanism. The scheduled job is a safety net for missed webhooks and is **not configured automatically**.

- [ ] Enable the extensions — Supabase → Database → Extensions: enable **`pg_cron`** and **`pg_net`**.
- [ ] Store the service-role key in Vault so it is not written into the cron definition — SQL Editor:
      ```sql
      select vault.create_secret(
        '<YOUR_SERVICE_ROLE_KEY>',
        'sync_all_service_key',
        'Service role key used by the scheduled Plaid sync'
      );
      ```
      (Service-role key: Supabase → Project Settings → API Keys. Treat it like a root password.)
- [ ] Schedule the job — runs every 6 hours:
      ```sql
      select cron.schedule(
        'cash-atlas-sync-all',
        '0 */6 * * *',
        $$
        select net.http_post(
          url := 'https://<PROJECT_REF>.supabase.co/functions/v1/plaid-sync-all',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets
              where name = 'sync_all_service_key'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 300000
        );
        $$
      );
      ```
- [ ] Verify it is registered:
      ```sql
      select jobname, schedule, active from cron.job;
      ```
- [ ] After the first run, check it worked:
      ```sql
      select operation, status, started_at, records_added, error_code
      from sync_runs order by started_at desc limit 10;
      ```

---

## 2. Plaid

### 2.1 Credentials

- [ ] Create an account at [dashboard.plaid.com](https://dashboard.plaid.com).
- [ ] Request **Production** access if you have not already — approval is not instant, so start here. Use **Sandbox** meanwhile.
- [ ] Copy your **`client_id`** — Developers → Keys.
- [ ] Copy the secret for the environment you are using — Developers → Keys (**Sandbox** and **Production** secrets are different values).
- [ ] Add both to Supabase secrets (§1.7). Set `PLAID_ENV` to `sandbox` or `production` to match the secret you used.

### 2.2 Products

- [ ] Developers → **Products**: confirm **Transactions** is enabled for your environment.
- [ ] Cash Atlas requests `transactions` only. It does not request Auth, Identity, Assets or Investments.

### 2.3 Webhooks

- [ ] Developers → **Webhooks** → set the URL to:
      ```
      https://<PROJECT_REF>.supabase.co/functions/v1/plaid-webhook
      ```
- [ ] This must match the `PLAID_WEBHOOK_URL` secret exactly.
- [ ] Send a test webhook from the Plaid dashboard, then confirm it arrived:
      ```bash
      supabase functions logs plaid-webhook
      ```

### 2.4 Allowed domains and OAuth

- [ ] Developers → **API** → Allowed redirect URIs: add your Vercel production URL and `http://localhost:5173` if you plan to connect OAuth institutions (most Canadian banks are OAuth).
- [ ] If you added a redirect URI, set the matching secret:
      ```bash
      supabase secrets set PLAID_REDIRECT_URI=https://<your-app>.vercel.app
      pnpm functions:deploy
      ```

### 2.5 First connection

- [ ] Open Cash Atlas, sign in, click **Connect institution**.
- [ ] Complete Plaid Link with a real institution (or a Sandbox one — username `user_good`, password `pass_good`).
- [ ] Confirm accounts appeared:
      ```sql
      select name, type, subtype, current_balance, iso_currency_code from accounts;
      ```
- [ ] Confirm transactions synced (Plaid may take a few minutes to make history available on a brand-new Item):
      ```sql
      select count(*), min(posted_date), max(posted_date) from transactions;
      ```
- [ ] Confirm the sync was recorded:
      ```sql
      select operation, status, records_added, records_modified, duration_ms
      from sync_runs order by started_at desc limit 5;
      ```

---

## 3. Anthropic

- [ ] Create an account at [console.anthropic.com](https://console.anthropic.com).
- [ ] Add billing credit — the API is not covered by a Claude.ai subscription.
- [ ] Create an API key: **API Keys** → *Create Key*. It is shown once.
- [ ] Add it to Supabase secrets:
      ```bash
      supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
      pnpm functions:deploy
      ```
- [ ] Open the **Chat** tab and ask *"How much cash do I have?"*.

If the key is missing, the Chat screen shows a configuration state rather than a fabricated answer. If you have no synchronised data yet, the assistant says so rather than inventing figures.

---

## 4. Vercel

- [ ] Push this repository to GitHub.
- [ ] Import it at [vercel.com/new](https://vercel.com/new).
- [ ] Confirm the settings Vercel detects from `vercel.json`:
  - **Framework preset**: Vite
  - **Build command**: `pnpm build`
  - **Output directory**: `dist`
  - **Install command**: `pnpm install --frozen-lockfile`
- [ ] Add environment variables — Project Settings → Environment Variables. Add each to **Production**, **Preview** and **Development**:
      ```
      VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
      VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
      ```
- [ ] **Add nothing else.** No Plaid, Anthropic or service-role values belong here.
- [ ] Deploy.
- [ ] Add the production URL to Supabase → Authentication → URL Configuration (Site URL and Redirect URLs).
- [ ] Add the production URL to Plaid's allowed redirect URIs if you use OAuth institutions.
- [ ] Confirm a deep link works: open `https://<your-app>.vercel.app/accounts` directly. It must load the app, not 404. (This exercises the SPA rewrite in `vercel.json`.)

---

## 5. Local development

- [ ] Copy the template:
      ```bash
      cp .env.example .env.local
      ```
- [ ] Start the local Supabase stack (needs Docker):
      ```bash
      pnpm db:start
      ```
- [ ] Copy the printed **API URL** and **publishable/anon key** into `.env.local`:
      ```
      VITE_SUPABASE_URL=http://127.0.0.1:54321
      VITE_SUPABASE_PUBLISHABLE_KEY=<printed by db:start>
      ```
- [ ] Apply migrations locally:
      ```bash
      pnpm db:reset
      ```
- [ ] Regenerate database types:
      ```bash
      pnpm db:types
      ```
- [ ] Start the app:
      ```bash
      pnpm dev            # http://localhost:5173
      ```
- [ ] Run the checks:
      ```bash
      pnpm verify         # typecheck → lint → test → build
      ```
- [ ] Optional — run Edge Functions locally. Create `supabase/functions/.env` (git-ignored) with the same secrets as §1.7, then:
      ```bash
      pnpm functions:serve
      ```
- [ ] Optional — end-to-end tests:
      ```bash
      pnpm test:e2e:install     # once
      pnpm test:e2e
      ```

**No Docker?** Validate migrations against a throwaway PostgreSQL 17 instead:
```bash
brew install postgresql@17
./scripts/validate-migrations.sh
```

---

## 6. Verify the whole thing works

Work through these in order. Each one confirms a different link in the chain.

- [ ] **Configuration** — start the app with `VITE_SUPABASE_URL` blank. You should see *"Cash Atlas isn't connected yet"* naming the missing variable. Restore it.
- [ ] **Auth** — create an account, sign out, sign back in.
- [ ] **Profile trigger** — `select * from profiles;` returns one row with `base_currency = 'CAD'`.
- [ ] **Empty state** — the Overview shows *"No accounts connected"* with a Connect button, **not** a grid of `$0.00` cards.
- [ ] **Link token** — click Connect institution. Plaid Link should open. If it does not, check `supabase functions logs plaid-create-link-token`.
- [ ] **Exchange** — complete Plaid Link. Accounts should appear without a page refresh.
- [ ] **Access token safety** — from the browser console:
      ```js
      await window.supabase?.from('plaid_item_secrets').select('*')
      ```
      This must return an error or an empty result. It must **never** return a token.
- [ ] **Transactions** — the Transactions screen lists real transactions from your bank.
- [ ] **Cash flow** — the Cash Flow screen shows real monthly figures, and the Monthly Summary adds up: gross debits minus exclusions minus refunds equals actual spending.
- [ ] **Cross-screen agreement** — the Overview surplus for the current month equals the Cash Flow surplus for the same month. They come from the same RPC, so any difference is a bug worth reporting.
- [ ] **Transfer detection** — if you moved money between two connected accounts, check `select * from transfer_matches;` and review anything marked `NEEDS_REVIEW`.
- [ ] **Webhook** — trigger a test webhook from Plaid, then `select * from sync_runs where operation = 'WEBHOOK' order by started_at desc limit 1;`
- [ ] **Atlas AI** — ask *"How much did I actually spend last month, excluding transfers?"* and confirm the figure matches the Cash Flow screen.
- [ ] **Freshness** — every screen showing figures also shows when the data was last synced.
- [ ] **No secrets committed** — `./scripts/check-no-secrets.sh` passes.

---

## 7. Troubleshooting

**"Cash Atlas isn't connected yet"**
`.env.local` is missing or has a typo. Vite reads environment variables only at startup — restart the dev server after editing.

**"The plaid-create-link-token function is not deployed"**
Run `pnpm functions:deploy`. Confirm with `supabase functions list`.

**Plaid Link opens then immediately errors**
Usually a `PLAID_ENV` mismatch: a Sandbox secret with `PLAID_ENV=production`, or vice versa. They are different values. Check `supabase functions logs plaid-create-link-token`.

**Accounts connected but no transactions**
Plaid prepares transaction history asynchronously for a new Item; it can take several minutes. The `SYNC_UPDATES_AVAILABLE` webhook fires when ready. Check `select * from sync_runs order by started_at desc;`.

**Transactions exist but Cash Flow is empty**
Most likely a currency mismatch: aggregates only include accounts and transactions in your base currency. Check:
```sql
select iso_currency_code, count(*) from transactions group by 1;
select base_currency from profiles;
```

**Spending looks too high**
Check for unreviewed transfers (`select * from transfer_matches where status = 'NEEDS_REVIEW';`) and unclassified transactions (`select count(*) from transactions where system_type = 'UNKNOWN' and user_type is null;`). Both are surfaced in the UI.

**Webhook not arriving**
The Plaid dashboard URL must match `PLAID_WEBHOOK_URL` exactly. The webhook function is the only one with `verify_jwt = false` — Plaid cannot present a Supabase JWT. Check `supabase functions logs plaid-webhook`.

**`ERR_PNPM_LINKING_FAILED: No space left on device`**
Free disk space, then `pnpm install` again. `pnpm store prune` reclaims unreferenced packages.
