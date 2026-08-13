#!/usr/bin/env bash
#
# Validate every migration against a real PostgreSQL server.
#
# `supabase db reset` is the authoritative check, but it needs Docker. This
# script is the Docker-free equivalent: it boots a throwaway PostgreSQL cluster,
# recreates the parts of a Supabase database that our migrations depend on
# (the auth schema, auth.uid(), the anon/authenticated/service_role roles, the
# extensions schema), then applies every migration in order and fails on the
# first error.
#
# It verifies SQL validity, constraint/index definitions, view and function
# bodies, and grants. It does NOT verify runtime RLS behaviour against real
# Supabase auth — `supabase db reset` and the RLS tests cover that.
#
# Usage:  ./scripts/validate-migrations.sh
# Needs:  PostgreSQL 15+ binaries on PATH (or at PG_BIN).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/supabase/migrations"

# Locate PostgreSQL 15+ binaries.
PG_BIN="${PG_BIN:-}"
if [[ -z "$PG_BIN" ]]; then
  for candidate in \
    /opt/homebrew/opt/postgresql@17/bin \
    /opt/homebrew/opt/postgresql@16/bin \
    /opt/homebrew/opt/postgresql@15/bin \
    /usr/lib/postgresql/17/bin \
    /usr/lib/postgresql/16/bin \
    /usr/lib/postgresql/15/bin; do
    if [[ -x "$candidate/initdb" ]]; then PG_BIN="$candidate"; break; fi
  done
fi
if [[ -z "$PG_BIN" ]]; then
  if command -v initdb >/dev/null 2>&1; then
    PG_BIN="$(dirname "$(command -v initdb)")"
  else
    echo "error: PostgreSQL 15+ binaries not found. Set PG_BIN to the bin directory." >&2
    exit 1
  fi
fi

PG_VERSION="$("$PG_BIN/initdb" --version | grep -oE '[0-9]+' | head -1)"
if (( PG_VERSION < 15 )); then
  echo "error: PostgreSQL $PG_VERSION found at $PG_BIN, but 15+ is required" >&2
  echo "       (views use security_invoker, which landed in PostgreSQL 15)." >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
DATADIR="$WORKDIR/data"
SOCKETDIR="$WORKDIR/sock"
mkdir -p "$SOCKETDIR"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$DATADIR" -s -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "==> PostgreSQL $PG_VERSION ($PG_BIN)"
"$PG_BIN/initdb" -D "$DATADIR" -U postgres --no-sync -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$DATADIR" -o "-k $SOCKETDIR -h '' -c fsync=off" -w -s start >/dev/null
echo "==> temporary cluster started"

PSQL=("$PG_BIN/psql" -h "$SOCKETDIR" -U postgres -d postgres -v ON_ERROR_STOP=1 --quiet)

# ---------------------------------------------------------------------------
# Minimal Supabase-compatible scaffolding.
# ---------------------------------------------------------------------------
"${PSQL[@]}" >/dev/null <<'SQL'
create schema if not exists extensions;
create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- Stand-in for Supabase's auth.users. Only the columns our migrations touch.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Stand-ins for GoTrue's request-context helpers.
create or replace function auth.uid() returns uuid
  language sql stable as $fn$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $fn$;

create or replace function auth.role() returns text
  language sql stable as $fn$
    select nullif(current_setting('request.jwt.claim.role', true), '');
  $fn$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- Supabase grants broadly by default; mirroring that here means the migrations'
-- REVOKE statements are exercised rather than silently no-oping.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
SQL

echo "==> Supabase scaffolding created"

# ---------------------------------------------------------------------------
# Apply migrations in filename order.
# ---------------------------------------------------------------------------
shopt -s nullglob
FILES=("$MIGRATIONS_DIR"/*.sql)
if (( ${#FILES[@]} == 0 )); then
  echo "error: no migrations found in $MIGRATIONS_DIR" >&2
  exit 1
fi

for file in "${FILES[@]}"; do
  printf '    %-52s' "$(basename "$file")"
  if "${PSQL[@]}" -f "$file" >/dev/null 2>"$WORKDIR/err.log"; then
    echo "ok"
  else
    echo "FAILED"
    echo
    sed 's/^/      /' "$WORKDIR/err.log" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Post-conditions. These are the assertions that would actually hurt if wrong.
# ---------------------------------------------------------------------------
echo "==> checking invariants"

"${PSQL[@]}" >/dev/null <<'SQL'
do $$
declare
  v_missing text;
  v_count integer;
begin
  -- Every user-owned table must have RLS enabled.
  select string_agg(c.relname, ', ') into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false;
  if v_missing is not null then
    raise exception 'tables without RLS enabled: %', v_missing;
  end if;

  -- The access-token table must be unreachable from browser roles.
  select count(*) into v_count from pg_policies
  where schemaname = 'public' and tablename = 'plaid_item_secrets';
  if v_count <> 0 then
    raise exception 'plaid_item_secrets must have zero RLS policies, found %', v_count;
  end if;

  if has_table_privilege('authenticated', 'public.plaid_item_secrets', 'SELECT') then
    raise exception 'authenticated must not hold SELECT on plaid_item_secrets';
  end if;
  if has_table_privilege('anon', 'public.plaid_item_secrets', 'SELECT') then
    raise exception 'anon must not hold SELECT on plaid_item_secrets';
  end if;

  -- Raw Plaid data and system classification must not be writable by the browser.
  if has_column_privilege('authenticated', 'public.transactions', 'amount', 'UPDATE') then
    raise exception 'authenticated must not be able to UPDATE transactions.amount';
  end if;
  if has_column_privilege('authenticated', 'public.transactions', 'system_type', 'UPDATE') then
    raise exception 'authenticated must not be able to UPDATE transactions.system_type';
  end if;
  if not has_column_privilege('authenticated', 'public.transactions', 'user_type', 'UPDATE') then
    raise exception 'authenticated must be able to UPDATE transactions.user_type';
  end if;

  -- Reporting views must run with the caller's RLS, not the definer's.
  select string_agg(c.relname, ', ') into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=true%';
  if v_missing is not null then
    raise exception 'views missing security_invoker: %', v_missing;
  end if;
end
$$;
SQL

# The exclusion buckets must partition eligible outflows exactly. Proven here
# against real rows rather than asserted in a comment.
"${PSQL[@]}" >/dev/null <<'SQL'
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
set local role postgres;

insert into public.institutions (id, user_id, name)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Test Bank');

insert into public.accounts (id, user_id, institution_id, source, name, type, subtype, include_in_cash, iso_currency_code)
values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222', 'manual', 'Chequing', 'depository', 'checking', true, 'CAD');

insert into public.transactions
  (user_id, account_id, posted_date, name, amount, iso_currency_code, system_type, system_transfer_subtype)
values
  ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','2026-07-03','Groceries', 120.00,'CAD','EXPENSE',null),
  ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','2026-07-04','To savings',500.00,'CAD','TRANSFER','CHECKING_TO_SAVINGS'),
  ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','2026-07-05','Visa payment',300.00,'CAD','TRANSFER','CREDIT_CARD_PAYMENT'),
  ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','2026-07-06','Wealthsimple',200.00,'CAD','TRANSFER','INVESTMENT_TRANSFER'),
  ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','2026-07-07','Mystery debit', 40.00,'CAD','UNKNOWN',null),
  ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','2026-07-08','Payroll',-4000.00,'CAD','INCOME',null),
  ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','2026-07-09','Return', -25.00,'CAD','REFUND',null);

do $$
declare
  r record;
  v_sum numeric;
begin
  select
    sum(absolute_amount) filter (where direction = 'OUTFLOW') as gross,
    sum(absolute_amount) filter (where direction = 'OUTFLOW' and spending_exclusion_bucket is null) as expense,
    sum(absolute_amount) filter (where spending_exclusion_bucket is not null) as excluded
  into r
  from public.transactions_classified
  where is_reportable;

  v_sum := coalesce(r.expense, 0) + coalesce(r.excluded, 0);
  if v_sum <> r.gross then
    raise exception 'exclusion buckets do not partition outflows: gross=% expense+excluded=%', r.gross, v_sum;
  end if;

  -- 120 groceries - 25 refund = 95 actual spending; income 4000.
  if coalesce(r.expense, 0) <> 120.00 then
    raise exception 'expected expense outflows of 120.00, got %', r.expense;
  end if;
end
$$;
SQL

echo "==> all migrations applied and invariants hold"
