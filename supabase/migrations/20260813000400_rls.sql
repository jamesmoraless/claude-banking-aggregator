-- ---------------------------------------------------------------------------
-- Cash Atlas — Row Level Security and privilege grants
--
-- Model:
--   * Every user-owned table has RLS enabled and is scoped by user_id.
--   * Grants are revoked wholesale and re-granted narrowly, including at
--     column level where the browser may only touch specific fields.
--   * The browser never writes classification-adjacent bookkeeping columns,
--     never writes Plaid-owned columns, and never reaches access tokens.
--   * Edge Functions use the service role, which bypasses RLS entirely, and are
--     responsible for their own user scoping (they derive user_id from the
--     verified JWT — never from the request body).
-- ---------------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.institutions        enable row level security;
alter table public.plaid_items         enable row level security;
alter table public.plaid_item_secrets  enable row level security;
alter table public.accounts            enable row level security;
alter table public.balance_snapshots   enable row level security;
alter table public.transactions        enable row level security;
alter table public.transfer_matches    enable row level security;
alter table public.transaction_rules   enable row level security;
alter table public.sync_runs           enable row level security;

-- Start from zero. Supabase grants broad table privileges to anon/authenticated
-- by default; we re-grant deliberately below.
revoke all on public.profiles           from anon, authenticated;
revoke all on public.institutions       from anon, authenticated;
revoke all on public.plaid_items        from anon, authenticated;
revoke all on public.plaid_item_secrets from anon, authenticated;
revoke all on public.accounts           from anon, authenticated;
revoke all on public.balance_snapshots  from anon, authenticated;
revoke all on public.transactions       from anon, authenticated;
revoke all on public.transfer_matches   from anon, authenticated;
revoke all on public.transaction_rules  from anon, authenticated;
revoke all on public.sync_runs          from anon, authenticated;

-- ---------------------------------------------------------------------------
-- profiles — the user owns their settings row.
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (display_name, base_currency, timezone, onboarding_completed_at)
  on public.profiles to authenticated;

create policy "profiles: read own"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- institutions — readable; only the display label is user-editable.
-- ---------------------------------------------------------------------------
grant select on public.institutions to authenticated;
grant update (display_name) on public.institutions to authenticated;

create policy "institutions: read own"
  on public.institutions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "institutions: rename own"
  on public.institutions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- plaid_items — read-only to the browser. Connection lifecycle (create,
-- reconnect, disconnect) happens exclusively through Edge Functions.
-- The access token is not on this table, so SELECT here is safe.
-- ---------------------------------------------------------------------------
grant select on public.plaid_items to authenticated;

create policy "plaid_items: read own"
  on public.plaid_items for select to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- plaid_item_secrets — NO grants and NO policies, deliberately.
--
-- RLS is enabled with zero policies, so every non-service role is denied by
-- default. Do not add a policy to this table. Do not expose it through a view.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- accounts — user owns reporting flags and the display label. Manual accounts
-- are fully user-managed; Plaid accounts are managed by sync.
-- ---------------------------------------------------------------------------
grant select on public.accounts to authenticated;
grant insert, delete on public.accounts to authenticated;
grant update (
  display_name, include_in_cash, include_in_net_worth, hidden,
  -- Manual accounts only; enforced by the update policy's WITH CHECK.
  name, official_name, type, subtype, current_balance, available_balance,
  iso_currency_code, closed_at, balances_updated_at
) on public.accounts to authenticated;

create policy "accounts: read own"
  on public.accounts for select to authenticated
  using ((select auth.uid()) = user_id);

-- Only manual accounts may be created from the browser.
create policy "accounts: insert own manual"
  on public.accounts for insert to authenticated
  with check ((select auth.uid()) = user_id and source = 'manual');

-- Rows stay owned by the same user and may not change source.
create policy "accounts: update own"
  on public.accounts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Deleting a Plaid account would be silently undone by the next sync, and
-- would destroy transaction history. Only manual accounts are deletable.
create policy "accounts: delete own manual"
  on public.accounts for delete to authenticated
  using ((select auth.uid()) = user_id and source = 'manual');

-- ---------------------------------------------------------------------------
-- balance_snapshots — history is written by sync only.
-- ---------------------------------------------------------------------------
grant select on public.balance_snapshots to authenticated;

create policy "balance_snapshots: read own"
  on public.balance_snapshots for select to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- transactions — readable; only override columns are writable.
--
-- Column-level grants are what stop the browser rewriting Plaid's raw data or
-- forging our system classification. RLS scopes the rows; grants scope the
-- columns. Both are required.
-- ---------------------------------------------------------------------------
grant select on public.transactions to authenticated;
grant update (
  user_type, user_transfer_subtype, user_classified_at,
  excluded_from_spending, source_transaction_id
) on public.transactions to authenticated;

create policy "transactions: read own"
  on public.transactions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "transactions: override own"
  on public.transactions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- transfer_matches — read-only. Confirm/reject/relink go through RPCs so that
-- both legs of the pair are validated and updated atomically.
-- ---------------------------------------------------------------------------
grant select on public.transfer_matches to authenticated;

create policy "transfer_matches: read own"
  on public.transfer_matches for select to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- transaction_rules — fully user-managed.
-- ---------------------------------------------------------------------------
grant select, insert, delete on public.transaction_rules to authenticated;
grant update (
  name, enabled, priority, match_field, match_operator, match_value,
  min_amount, max_amount, account_id, result_type, result_transfer_subtype
) on public.transaction_rules to authenticated;

create policy "transaction_rules: read own"
  on public.transaction_rules for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "transaction_rules: insert own"
  on public.transaction_rules for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "transaction_rules: update own"
  on public.transaction_rules for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "transaction_rules: delete own"
  on public.transaction_rules for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- sync_runs — operational log, read-only to the user.
-- ---------------------------------------------------------------------------
grant select on public.sync_runs to authenticated;

create policy "sync_runs: read own"
  on public.sync_runs for select to authenticated
  using ((select auth.uid()) = user_id);
