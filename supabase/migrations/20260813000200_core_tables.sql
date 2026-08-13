-- ---------------------------------------------------------------------------
-- Cash Atlas — profiles, institutions, Plaid Items, accounts, balance history
-- ---------------------------------------------------------------------------

-- Shared updated_at trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at is
  'Trigger helper that stamps updated_at on every UPDATE.';

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  -- Base reporting currency. Aggregates are computed in this currency only;
  -- amounts in other currencies are reported separately rather than summed.
  base_currency char(3) not null default 'CAD',
  timezone text not null default 'America/Toronto',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_base_currency_format check (base_currency ~ '^[A-Z]{3}$')
);

comment on table public.profiles is 'Per-user application settings. One row per auth user.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Every authenticated user gets a profile automatically. This is the only row
-- that exists for a brand-new user; all financial tables start empty.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name',
                         new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- institutions
-- ---------------------------------------------------------------------------
create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plaid_institution_id text,
  name text not null,
  -- User-supplied label. Preserved across syncs; never overwritten by Plaid.
  display_name text,
  logo_url text,
  primary_color text,
  website_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint institutions_name_not_blank check (length(trim(name)) > 0)
);

comment on table public.institutions is
  'Financial institutions the user has connected. Scoped per user so that two users connecting the same bank do not share a row.';
comment on column public.institutions.display_name is
  'User override for the displayed institution name. Sync must never overwrite this.';

-- A user connects a given Plaid institution once.
create unique index institutions_user_plaid_institution_key
  on public.institutions (user_id, plaid_institution_id)
  where plaid_institution_id is not null;

create index institutions_user_id_idx on public.institutions (user_id);

create trigger institutions_set_updated_at
  before update on public.institutions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- plaid_items
--
-- One row per authenticated Plaid Item. NOTE: the access token is deliberately
-- NOT stored on this table — see plaid_item_secrets below.
-- ---------------------------------------------------------------------------
create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  institution_id uuid references public.institutions (id) on delete set null,
  plaid_item_id text not null,

  status public.plaid_item_status not null default 'ACTIVE',
  error_code text,
  error_message text,
  -- Set when Plaid reports the Item needs update mode (ITEM_LOGIN_REQUIRED etc).
  requires_reauth_since timestamptz,
  consent_expiration_time timestamptz,
  update_type text,

  -- Incremental /transactions/sync cursor. NULL means "never synced".
  transaction_cursor text,

  available_products text[] not null default '{}',
  billed_products text[] not null default '{}',

  last_accounts_sync_at timestamptz,
  last_transactions_sync_at timestamptz,
  last_successful_sync_at timestamptz,
  last_webhook_at timestamptz,
  disconnected_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint plaid_items_user_item_key unique (user_id, plaid_item_id)
);

comment on table public.plaid_items is
  'An authenticated Plaid Item (one institution connection). Access tokens live in plaid_item_secrets, which is unreachable from the browser.';
comment on column public.plaid_items.transaction_cursor is
  'Cursor from /transactions/sync. Persisted only after a page of updates has been committed, so a failure mid-sync replays rather than skips.';

-- Plaid item ids are globally unique; guard against cross-user collisions too.
create unique index plaid_items_plaid_item_id_key on public.plaid_items (plaid_item_id);
create index plaid_items_user_id_idx on public.plaid_items (user_id);
create index plaid_items_institution_id_idx on public.plaid_items (institution_id);
-- Used by the scheduled sync to find Items worth touching.
create index plaid_items_active_idx on public.plaid_items (status, last_transactions_sync_at)
  where disconnected_at is null;

create trigger plaid_items_set_updated_at
  before update on public.plaid_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- plaid_item_secrets
--
-- SECURITY BOUNDARY.
-- The Plaid access token is stored here, encrypted (AES-256-GCM) with
-- ACCESS_TOKEN_ENCRYPTION_KEY, which only Edge Functions hold.
--
-- This table has RLS enabled and *no policies at all*, and all grants to anon /
-- authenticated are revoked. That makes the token structurally unreachable from
-- the browser rather than merely policy-protected: there is no policy that
-- could be mis-written to expose it, and no column-level grant to forget.
-- Only the service role (Edge Functions) bypasses RLS.
-- ---------------------------------------------------------------------------
create table public.plaid_item_secrets (
  plaid_item_id uuid primary key references public.plaid_items (id) on delete cascade,
  access_token_ciphertext text not null,
  access_token_iv text not null,
  -- Supports key rotation without a destructive migration.
  key_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.plaid_item_secrets is
  'Encrypted Plaid access tokens. RLS enabled with zero policies: service role only. Never expose through a view, RPC or Edge Function response.';

create trigger plaid_item_secrets_set_updated_at
  before update on public.plaid_item_secrets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  institution_id uuid references public.institutions (id) on delete set null,
  plaid_item_id uuid references public.plaid_items (id) on delete set null,
  plaid_account_id text,

  source public.account_source not null default 'plaid',

  -- Plaid-supplied identity. Overwritten on every account sync.
  name text not null,
  official_name text,
  mask text,
  type text not null,
  subtype text,

  -- User-supplied label. Preserved across syncs.
  display_name text,

  current_balance numeric(20, 4),
  available_balance numeric(20, 4),
  credit_limit numeric(20, 4),
  iso_currency_code char(3),
  unofficial_currency_code text,

  -- User-configurable reporting flags. Sync must preserve these.
  include_in_cash boolean not null default false,
  include_in_net_worth boolean not null default true,
  hidden boolean not null default false,

  balances_updated_at timestamptz,
  last_synced_at timestamptz,
  closed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint accounts_name_not_blank check (length(trim(name)) > 0),
  constraint accounts_iso_currency_format
    check (iso_currency_code is null or iso_currency_code ~ '^[A-Z]{3}$'),
  -- A Plaid-sourced account must carry its Plaid identifiers; a manual one must not.
  constraint accounts_plaid_identity check (
    (source = 'plaid' and plaid_account_id is not null and plaid_item_id is not null)
    or (source = 'manual' and plaid_account_id is null and plaid_item_id is null)
  )
);

comment on table public.accounts is
  'Normalised financial accounts from Plaid or entered manually.';
comment on column public.accounts.include_in_cash is
  'Whether this account contributes to Total Cash. Defaulted from type/subtype on first sync, then owned by the user.';
comment on column public.accounts.hidden is
  'Hidden accounts are excluded from every view and report, not merely from lists.';

create unique index accounts_plaid_account_id_key
  on public.accounts (plaid_account_id)
  where plaid_account_id is not null;
create index accounts_user_id_idx on public.accounts (user_id);
create index accounts_institution_id_idx on public.accounts (institution_id);
create index accounts_plaid_item_id_idx on public.accounts (plaid_item_id);
create index accounts_user_visible_idx on public.accounts (user_id, hidden, type);

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- balance_snapshots
--
-- One snapshot per account per calendar day (in UTC). Re-running a sync on the
-- same day updates the existing row instead of creating near-duplicate history.
-- ---------------------------------------------------------------------------
create table public.balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  current_balance numeric(20, 4),
  available_balance numeric(20, 4),
  credit_limit numeric(20, 4),
  iso_currency_code char(3),
  captured_at timestamptz not null default now(),
  captured_date date not null generated always as ((captured_at at time zone 'UTC')::date) stored,
  created_at timestamptz not null default now(),

  constraint balance_snapshots_account_day_key unique (account_id, captured_date)
);

comment on table public.balance_snapshots is
  'Daily balance history powering cash, account and net-worth trends. Unique per account per UTC day to prevent duplicate snapshots seconds apart.';

create index balance_snapshots_user_date_idx
  on public.balance_snapshots (user_id, captured_date desc);
create index balance_snapshots_account_date_idx
  on public.balance_snapshots (account_id, captured_date desc);
