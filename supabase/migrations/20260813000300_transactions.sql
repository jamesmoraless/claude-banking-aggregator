-- ---------------------------------------------------------------------------
-- Cash Atlas — transactions, classification rules, transfer matches, sync runs
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- transactions
--
-- Plaid's raw payload and our normalised interpretation are kept side by side.
-- Columns prefixed plaid_ are written only by synchronisation and are never
-- mutated by classification. Columns prefixed system_ hold our automatic
-- classification. Columns prefixed user_ hold explicit user overrides and are
-- never written by any automated process.
-- ---------------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,

  -- ---- Raw Plaid identity -------------------------------------------------
  plaid_transaction_id text,
  -- When a pending transaction posts, Plaid links the new posted transaction
  -- back to the pending one through this id. Used to retire the pending row.
  plaid_pending_transaction_id text,

  posted_date date not null,
  authorized_date date,
  datetime timestamptz,

  name text not null,
  merchant_name text,

  -- Plaid's sign convention, preserved exactly as received:
  -- positive = money leaving the account, negative = money entering it.
  -- Never invert this column. Use the direction/absolute_amount projections.
  amount numeric(20, 4) not null,
  iso_currency_code char(3),
  unofficial_currency_code text,

  pending boolean not null default false,

  -- ---- Raw Plaid classification (immutable to us) -------------------------
  plaid_category_primary text,
  plaid_category_detailed text,
  plaid_category_confidence text,
  plaid_payment_channel text,
  plaid_transaction_code text,
  website_url text,
  logo_url text,

  -- ---- Our automatic classification ---------------------------------------
  system_type public.economic_type not null default 'UNKNOWN',
  system_transfer_subtype public.transfer_subtype,
  -- Human-readable audit trail: which rule or heuristic decided this.
  system_classification_reason text,
  system_classified_at timestamptz,

  -- ---- User override (highest precedence) ---------------------------------
  user_type public.economic_type,
  user_transfer_subtype public.transfer_subtype,
  user_classified_at timestamptz,

  -- Explicit "ignore this transaction in all reporting".
  excluded_from_spending boolean not null default false,

  -- Set by the transfer detection engine (denormalised pointer; the match row
  -- remains the source of truth).
  transfer_match_id uuid,

  -- Links a refund back to the purchase it reverses, when known.
  source_transaction_id uuid references public.transactions (id) on delete set null,

  -- Soft delete. Plaid `removed` events set this rather than destroying
  -- history; every financial view filters removed rows out.
  removed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint transactions_name_not_blank check (length(trim(name)) > 0),
  constraint transactions_iso_currency_format
    check (iso_currency_code is null or iso_currency_code ~ '^[A-Z]{3}$'),
  -- A transfer classification must carry a subtype, and a subtype only makes
  -- sense on a transfer. Enforced independently for system and user columns.
  constraint transactions_system_transfer_subtype_consistent check (
    (system_type = 'TRANSFER') or (system_transfer_subtype is null)
  ),
  constraint transactions_user_transfer_subtype_consistent check (
    (user_type = 'TRANSFER') or (user_transfer_subtype is null)
  ),
  constraint transactions_user_override_stamped check (
    (user_type is null) = (user_classified_at is null)
  ),
  constraint transactions_not_self_refund check (source_transaction_id <> id)
);

comment on table public.transactions is
  'Normalised transactions. Plaid raw data, our system classification and user overrides are stored separately and never overwrite one another.';
comment on column public.transactions.amount is
  'Plaid sign convention, preserved verbatim: positive = outflow from the account, negative = inflow. Do not invert.';
comment on column public.transactions.system_type is
  'Automatic classification. Recomputable at any time; overwritten freely by normalisation.';
comment on column public.transactions.user_type is
  'User override. Takes precedence over system_type. Automated processes must never write this column.';

-- Idempotent synchronisation hinges on this: upserts key off the Plaid id.
create unique index transactions_plaid_transaction_id_key
  on public.transactions (plaid_transaction_id)
  where plaid_transaction_id is not null;

create index transactions_user_date_idx
  on public.transactions (user_id, posted_date desc)
  where removed_at is null;
create index transactions_account_date_idx
  on public.transactions (account_id, posted_date desc)
  where removed_at is null;
create index transactions_pending_link_idx
  on public.transactions (plaid_pending_transaction_id)
  where plaid_pending_transaction_id is not null;
-- Supports the transfer detection candidate scan: same user, near date, similar amount.
create index transactions_transfer_candidate_idx
  on public.transactions (user_id, posted_date, amount)
  where removed_at is null and pending = false;
create index transactions_needs_review_idx
  on public.transactions (user_id, system_type)
  where removed_at is null and system_type = 'UNKNOWN';
create index transactions_merchant_idx
  on public.transactions (user_id, merchant_name)
  where removed_at is null;
create index transactions_transfer_match_idx on public.transactions (transfer_match_id);

-- Case-insensitive substring search over merchant + raw name.
create index transactions_search_idx
  on public.transactions using gin (
    (coalesce(merchant_name, '') || ' ' || name) extensions.gin_trgm_ops
  );

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- transfer_matches
--
-- A detected pairing between an outgoing transaction and the incoming
-- transaction on another of the user's accounts.
-- ---------------------------------------------------------------------------
create table public.transfer_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  outgoing_transaction_id uuid not null references public.transactions (id) on delete cascade,
  incoming_transaction_id uuid not null references public.transactions (id) on delete cascade,

  -- 0.0000 – 1.0000. Above the auto threshold we match automatically; below it
  -- the pair enters review rather than silently altering spending figures.
  confidence numeric(5, 4) not null,
  detection_method text not null,
  -- Structured, human-readable justification: which signals fired and by how
  -- much. Surfaced verbatim in the Transfer Review UI.
  reason jsonb not null default '[]'::jsonb,

  subtype public.transfer_subtype not null default 'ACCOUNT_TO_ACCOUNT',
  status public.transfer_match_status not null default 'NEEDS_REVIEW',
  user_confirmed_at timestamptz,
  user_rejected_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint transfer_matches_confidence_range check (confidence >= 0 and confidence <= 1),
  constraint transfer_matches_distinct_legs check (outgoing_transaction_id <> incoming_transaction_id),
  constraint transfer_matches_pair_key unique (outgoing_transaction_id, incoming_transaction_id)
);

comment on table public.transfer_matches is
  'Outgoing/incoming pairs identified as movement between the user''s own accounts. Deterministic and idempotent: re-running detection updates rows in place.';
comment on column public.transfer_matches.reason is
  'Array of {signal, detail, weight} objects explaining the confidence score.';

-- A transaction may participate in at most one live match. Rejected matches are
-- retained for auditability but do not block a better match being proposed.
create unique index transfer_matches_outgoing_live_key
  on public.transfer_matches (outgoing_transaction_id)
  where status <> 'USER_REJECTED';
create unique index transfer_matches_incoming_live_key
  on public.transfer_matches (incoming_transaction_id)
  where status <> 'USER_REJECTED';
create index transfer_matches_user_status_idx on public.transfer_matches (user_id, status);

create trigger transfer_matches_set_updated_at
  before update on public.transfer_matches
  for each row execute function public.set_updated_at();

-- Deferred: transactions is created before transfer_matches.
alter table public.transactions
  add constraint transactions_transfer_match_id_fkey
  foreign key (transfer_match_id) references public.transfer_matches (id) on delete set null;

-- ---------------------------------------------------------------------------
-- transaction_rules
--
-- A deliberately small, extensible rule foundation: one match criterion plus
-- optional amount/account narrowing. Not a query language.
-- ---------------------------------------------------------------------------
create table public.transaction_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  name text not null,
  enabled boolean not null default true,
  -- Lower number wins. Ties broken by created_at for determinism.
  priority integer not null default 100,

  match_field public.rule_match_field not null default 'MERCHANT_OR_NAME',
  match_operator public.rule_match_operator not null default 'CONTAINS',
  match_value text not null,
  -- Optional narrowing.
  min_amount numeric(20, 4),
  max_amount numeric(20, 4),
  account_id uuid references public.accounts (id) on delete cascade,

  result_type public.economic_type not null,
  result_transfer_subtype public.transfer_subtype,

  -- Operational feedback so the user can see whether a rule actually fires.
  last_applied_at timestamptz,
  match_count integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint transaction_rules_name_not_blank check (length(trim(name)) > 0),
  constraint transaction_rules_match_value_not_blank check (length(trim(match_value)) > 0),
  constraint transaction_rules_priority_range check (priority >= 0 and priority <= 10000),
  constraint transaction_rules_amount_range check (
    min_amount is null or max_amount is null or min_amount <= max_amount
  ),
  constraint transaction_rules_transfer_subtype_consistent check (
    (result_type = 'TRANSFER') or (result_transfer_subtype is null)
  ),
  constraint transaction_rules_result_is_actionable check (result_type <> 'UNKNOWN')
);

comment on table public.transaction_rules is
  'Reusable user classification rules applied during normalisation, ordered by priority then created_at.';

create index transaction_rules_user_priority_idx
  on public.transaction_rules (user_id, priority, created_at)
  where enabled = true;

create trigger transaction_rules_set_updated_at
  before update on public.transaction_rules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- sync_runs — operational visibility. Safe metadata only, never tokens.
-- ---------------------------------------------------------------------------
create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  plaid_item_id uuid references public.plaid_items (id) on delete set null,

  operation public.sync_operation not null,
  status public.sync_status not null default 'RUNNING',
  request_id text,

  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,

  records_added integer not null default 0,
  records_modified integer not null default 0,
  records_removed integer not null default 0,
  records_processed integer not null default 0,

  -- Stable, non-sensitive error code (e.g. PLAID_ITEM_LOGIN_REQUIRED).
  error_code text,
  -- Safe message only. Never a raw exception, payload or token.
  error_message text,
  metadata jsonb not null default '{}'::jsonb,

  constraint sync_runs_duration_non_negative check (duration_ms is null or duration_ms >= 0)
);

comment on table public.sync_runs is
  'One row per synchronisation attempt. Read-only to the user; written by Edge Functions. Must never contain access tokens, public tokens or raw payloads.';

create index sync_runs_user_started_idx on public.sync_runs (user_id, started_at desc);
create index sync_runs_item_started_idx on public.sync_runs (plaid_item_id, started_at desc);
create index sync_runs_status_idx on public.sync_runs (status) where status in ('RUNNING', 'FAILED');
