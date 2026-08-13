-- ---------------------------------------------------------------------------
-- Cash Atlas — reporting RPCs
--
-- These functions are the ONLY place monthly figures are computed. The React
-- dashboard, the Cash Flow screen and the Atlas AI finance tools all call them,
-- so a number shown on one screen is byte-identical to the number the assistant
-- quotes.
--
-- All functions are SECURITY INVOKER: Row Level Security on the underlying
-- tables scopes every result to the calling user. None of them accept a
-- user_id argument, so a caller cannot ask about somebody else's money.
--
-- Currency: aggregates are computed strictly in the profile's base currency.
-- Rows in other currencies are counted and reported separately rather than
-- being summed into an incorrect total.
-- ---------------------------------------------------------------------------

create or replace function public.current_base_currency()
returns char(3)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select p.base_currency from public.profiles p where p.id = (select auth.uid())),
    'CAD'::char(3)
  );
$$;

comment on function public.current_base_currency is
  'Base reporting currency for the calling user. Defaults to CAD.';

-- ---------------------------------------------------------------------------
-- dashboard_cash_summary — "how much liquid cash do I have?"
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_cash_summary()
returns table (
  currency char(3),
  total_cash numeric,
  checking_total numeric,
  savings_total numeric,
  other_cash_total numeric,
  credit_owed_total numeric,
  cash_account_count integer,
  checking_account_count integer,
  savings_account_count integer,
  credit_account_count integer,
  institution_count integer,
  excluded_account_count integer,
  excluded_currencies text[],
  last_accounts_sync_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (select public.current_base_currency() as cur),
  visible as (
    select ab.*
    from public.account_balances ab
    where ab.hidden = false and ab.closed_at is null
  ),
  cash as (
    select v.* from visible v, base b
    where v.include_in_cash = true and v.currency is not distinct from b.cur
  )
  select
    b.cur,
    round(coalesce((select sum(c.current_balance) from cash c), 0), 2),
    round(coalesce((select sum(c.current_balance) from cash c where c.cash_bucket = 'CHECKING'), 0), 2),
    round(coalesce((select sum(c.current_balance) from cash c where c.cash_bucket = 'SAVINGS'), 0), 2),
    round(coalesce((select sum(c.current_balance) from cash c where c.cash_bucket = 'OTHER_CASH'), 0), 2),
    round(coalesce((
      select sum(v.current_balance) from visible v
      where v.cash_bucket = 'CREDIT' and v.currency is not distinct from b.cur
    ), 0), 2),
    (select count(*) from cash c)::integer,
    (select count(*) from cash c where c.cash_bucket = 'CHECKING')::integer,
    (select count(*) from cash c where c.cash_bucket = 'SAVINGS')::integer,
    (select count(*) from visible v where v.cash_bucket = 'CREDIT')::integer,
    (select count(distinct v.institution_id) from visible v where v.institution_id is not null)::integer,
    -- Accounts the user marked as cash but which we cannot safely add to the
    -- base-currency total. Surfaced so a total is never quietly incomplete.
    (select count(*) from visible v
      where v.include_in_cash = true and v.currency is distinct from b.cur)::integer,
    coalesce((select array_agg(distinct v.currency) from visible v
      where v.include_in_cash = true and v.currency is distinct from b.cur), '{}'),
    (select max(v.last_synced_at) from visible v)
  from base b;
$$;

comment on function public.dashboard_cash_summary is
  'Total cash, checking and savings in the base currency, plus an explicit count of accounts excluded for currency reasons.';

-- ---------------------------------------------------------------------------
-- monthly_cashflow — the canonical income/spending computation.
--
-- Returns one row per calendar month in [p_from, p_to], including months with
-- no activity, so a genuine zero renders as zero rather than as a gap.
--
-- The exclusion components sum exactly:
--   gross_debits = expense_outflows
--                + internal_transfers + credit_card_payments
--                + investment_transfers + unclassified_outflows
--                + adjustment_outflows + user_excluded_outflows
--                + other_non_expense_outflows
-- ---------------------------------------------------------------------------
create or replace function public.monthly_cashflow(p_from date, p_to date)
returns table (
  month_start date,
  currency char(3),
  gross_debits numeric,
  gross_credits numeric,
  expense_outflows numeric,
  refunds numeric,
  actual_spending numeric,
  actual_income numeric,
  internal_transfers numeric,
  credit_card_payments numeric,
  investment_transfers numeric,
  unclassified_outflows numeric,
  adjustment_outflows numeric,
  user_excluded_outflows numeric,
  other_non_expense_outflows numeric,
  income_internal_transfers numeric,
  income_unclassified numeric,
  surplus numeric,
  savings_rate numeric,
  transaction_count integer,
  unclassified_transaction_count integer,
  foreign_currency_transaction_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      date_trunc('month', p_from)::date as from_month,
      date_trunc('month', p_to)::date   as to_month,
      public.current_base_currency()    as cur
  ),
  months as (
    select generate_series(p.from_month, p.to_month, interval '1 month')::date as month_start
    from params p
  ),
  tx as (
    select
      date_trunc('month', t.posted_date)::date as month_start,
      t.direction,
      t.absolute_amount,
      t.currency,
      t.spending_exclusion_bucket,
      t.income_exclusion_bucket,
      (t.currency is not distinct from p.cur) as in_base_currency
    from public.transactions_classified t, params p
    where t.is_reportable
      and t.posted_date >= p.from_month
      and t.posted_date < (p.to_month + interval '1 month')
  ),
  agg as (
    select
      tx.month_start,
      sum(tx.absolute_amount) filter (where tx.in_base_currency and tx.direction = 'OUTFLOW') as gross_debits,
      sum(tx.absolute_amount) filter (where tx.in_base_currency and tx.direction = 'INFLOW')  as gross_credits,
      sum(tx.absolute_amount) filter (
        where tx.in_base_currency and tx.direction = 'OUTFLOW' and tx.spending_exclusion_bucket is null
      ) as expense_outflows,
      sum(tx.absolute_amount) filter (
        where tx.in_base_currency and tx.income_exclusion_bucket = 'REFUND'
      ) as refunds,
      sum(tx.absolute_amount) filter (
        where tx.in_base_currency and tx.direction = 'INFLOW' and tx.income_exclusion_bucket is null
      ) as actual_income,
      sum(tx.absolute_amount) filter (where tx.in_base_currency and tx.spending_exclusion_bucket = 'INTERNAL_TRANSFER')   as internal_transfers,
      sum(tx.absolute_amount) filter (where tx.in_base_currency and tx.spending_exclusion_bucket = 'CREDIT_CARD_PAYMENT') as credit_card_payments,
      sum(tx.absolute_amount) filter (where tx.in_base_currency and tx.spending_exclusion_bucket = 'INVESTMENT_TRANSFER') as investment_transfers,
      sum(tx.absolute_amount) filter (where tx.in_base_currency and tx.spending_exclusion_bucket = 'UNCLASSIFIED')        as unclassified_outflows,
      sum(tx.absolute_amount) filter (where tx.in_base_currency and tx.spending_exclusion_bucket = 'ADJUSTMENT')          as adjustment_outflows,
      sum(tx.absolute_amount) filter (where tx.in_base_currency and tx.spending_exclusion_bucket = 'USER_EXCLUDED')       as user_excluded_outflows,
      sum(tx.absolute_amount) filter (where tx.in_base_currency and tx.spending_exclusion_bucket = 'OTHER_NON_EXPENSE')   as other_non_expense_outflows,
      sum(tx.absolute_amount) filter (where tx.in_base_currency and tx.income_exclusion_bucket = 'INTERNAL_TRANSFER')     as income_internal_transfers,
      sum(tx.absolute_amount) filter (where tx.in_base_currency and tx.income_exclusion_bucket = 'UNCLASSIFIED')          as income_unclassified,
      count(*) filter (where tx.in_base_currency)                                      as transaction_count,
      count(*) filter (where tx.in_base_currency
        and (tx.spending_exclusion_bucket = 'UNCLASSIFIED' or tx.income_exclusion_bucket = 'UNCLASSIFIED')) as unclassified_transaction_count,
      count(*) filter (where not tx.in_base_currency)                                  as foreign_currency_transaction_count
    from tx
    group by tx.month_start
  )
  select
    m.month_start,
    p.cur,
    round(coalesce(a.gross_debits, 0), 2),
    round(coalesce(a.gross_credits, 0), 2),
    round(coalesce(a.expense_outflows, 0), 2),
    round(coalesce(a.refunds, 0), 2),
    -- Actual spending = eligible expense outflows less applicable refunds.
    -- Not clamped at zero: a month dominated by refunds legitimately nets
    -- negative, and hiding that would be a fabricated number.
    round(coalesce(a.expense_outflows, 0) - coalesce(a.refunds, 0), 2),
    round(coalesce(a.actual_income, 0), 2),
    round(coalesce(a.internal_transfers, 0), 2),
    round(coalesce(a.credit_card_payments, 0), 2),
    round(coalesce(a.investment_transfers, 0), 2),
    round(coalesce(a.unclassified_outflows, 0), 2),
    round(coalesce(a.adjustment_outflows, 0), 2),
    round(coalesce(a.user_excluded_outflows, 0), 2),
    round(coalesce(a.other_non_expense_outflows, 0), 2),
    round(coalesce(a.income_internal_transfers, 0), 2),
    round(coalesce(a.income_unclassified, 0), 2),
    round(coalesce(a.actual_income, 0) - (coalesce(a.expense_outflows, 0) - coalesce(a.refunds, 0)), 2),
    -- Savings rate is undefined without positive income; NULL, never 0 or ∞.
    case
      when coalesce(a.actual_income, 0) > 0 then round(
        (coalesce(a.actual_income, 0) - (coalesce(a.expense_outflows, 0) - coalesce(a.refunds, 0)))
        / a.actual_income, 4)
      else null
    end,
    coalesce(a.transaction_count, 0)::integer,
    coalesce(a.unclassified_transaction_count, 0)::integer,
    coalesce(a.foreign_currency_transaction_count, 0)::integer
  from months m
  cross join params p
  left join agg a on a.month_start = m.month_start
  order by m.month_start;
$$;

comment on function public.monthly_cashflow is
  'Canonical monthly income/spending with every exclusion component broken out. Components sum exactly to gross_debits, which is what makes the calculation panel auditable.';

-- ---------------------------------------------------------------------------
-- spending_by_category — net of refunds within the same category.
-- ---------------------------------------------------------------------------
create or replace function public.spending_by_category(p_from date, p_to date)
returns table (
  category text,
  amount numeric,
  transaction_count integer,
  refund_amount numeric,
  share numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (select public.current_base_currency() as cur),
  rows_in_scope as (
    select
      coalesce(nullif(t.plaid_category_primary, ''), 'UNCATEGORIZED') as category,
      t.absolute_amount,
      t.spending_exclusion_bucket,
      t.income_exclusion_bucket
    from public.transactions_classified t, params p
    where t.is_reportable
      and t.currency is not distinct from p.cur
      and t.posted_date between p_from and p_to
      and (t.spending_exclusion_bucket is null or t.income_exclusion_bucket = 'REFUND')
  ),
  grouped as (
    select
      r.category,
      coalesce(sum(r.absolute_amount) filter (where r.spending_exclusion_bucket is null), 0) as gross,
      coalesce(sum(r.absolute_amount) filter (where r.income_exclusion_bucket = 'REFUND'), 0) as refunds,
      count(*) filter (where r.spending_exclusion_bucket is null) as tx_count
    from rows_in_scope r
    group by r.category
  ),
  totalled as (
    select g.*, (g.gross - g.refunds) as net from grouped g
  )
  select
    t.category,
    round(t.net, 2),
    t.tx_count::integer,
    round(t.refunds, 2),
    case
      when (select sum(x.net) from totalled x where x.net > 0) > 0
        then round(t.net / (select sum(x.net) from totalled x where x.net > 0), 4)
      else null
    end
  from totalled t
  where t.tx_count > 0 or t.refunds > 0
  order by t.net desc;
$$;

comment on function public.spending_by_category is
  'Spending grouped by Plaid primary category, net of refunds booked to the same category.';

-- ---------------------------------------------------------------------------
-- income_by_source
-- ---------------------------------------------------------------------------
create or replace function public.income_by_source(p_from date, p_to date)
returns table (
  source text,
  category text,
  amount numeric,
  transaction_count integer,
  share numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (select public.current_base_currency() as cur),
  income as (
    select
      t.display_name as source,
      coalesce(nullif(t.plaid_category_primary, ''), 'UNCATEGORIZED') as category,
      t.absolute_amount
    from public.transactions_classified t, params p
    where t.is_reportable
      and t.currency is not distinct from p.cur
      and t.posted_date between p_from and p_to
      and t.direction = 'INFLOW'
      and t.income_exclusion_bucket is null
  ),
  grouped as (
    select i.source, min(i.category) as category, sum(i.absolute_amount) as amount, count(*) as tx_count
    from income i group by i.source
  )
  select
    g.source,
    g.category,
    round(g.amount, 2),
    g.tx_count::integer,
    case when (select sum(x.amount) from grouped x) > 0
      then round(g.amount / (select sum(x.amount) from grouped x), 4)
      else null end
  from grouped g
  order by g.amount desc;
$$;

-- ---------------------------------------------------------------------------
-- top_merchants — spending by merchant, net of refunds from that merchant.
-- ---------------------------------------------------------------------------
create or replace function public.top_merchants(p_from date, p_to date, p_limit integer default 10)
returns table (
  merchant text,
  amount numeric,
  transaction_count integer,
  refund_amount numeric,
  logo_url text,
  last_transaction_date date
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (select public.current_base_currency() as cur),
  rows_in_scope as (
    select
      t.display_name as merchant,
      t.absolute_amount,
      t.spending_exclusion_bucket,
      t.income_exclusion_bucket,
      t.logo_url,
      t.posted_date
    from public.transactions_classified t, params p
    where t.is_reportable
      and t.currency is not distinct from p.cur
      and t.posted_date between p_from and p_to
      and (t.spending_exclusion_bucket is null or t.income_exclusion_bucket = 'REFUND')
  )
  select
    r.merchant,
    round(coalesce(sum(r.absolute_amount) filter (where r.spending_exclusion_bucket is null), 0)
        - coalesce(sum(r.absolute_amount) filter (where r.income_exclusion_bucket = 'REFUND'), 0), 2) as amount,
    count(*) filter (where r.spending_exclusion_bucket is null)::integer,
    round(coalesce(sum(r.absolute_amount) filter (where r.income_exclusion_bucket = 'REFUND'), 0), 2),
    (array_agg(r.logo_url) filter (where r.logo_url is not null))[1],
    max(r.posted_date)
  from rows_in_scope r
  group by r.merchant
  having count(*) filter (where r.spending_exclusion_bucket is null) > 0
  order by amount desc
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

-- ---------------------------------------------------------------------------
-- transfer_summary — what was excluded from spending, and why.
-- ---------------------------------------------------------------------------
create or replace function public.transfer_summary(p_from date, p_to date)
returns table (
  bucket text,
  amount numeric,
  transaction_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (select public.current_base_currency() as cur),
  outflows as (
    select t.spending_exclusion_bucket as bucket, t.absolute_amount
    from public.transactions_classified t, params p
    where t.is_reportable
      and t.currency is not distinct from p.cur
      and t.posted_date between p_from and p_to
      and t.spending_exclusion_bucket is not null
  ),
  refunds as (
    select 'REFUND'::text as bucket, t.absolute_amount
    from public.transactions_classified t, params p
    where t.is_reportable
      and t.currency is not distinct from p.cur
      and t.posted_date between p_from and p_to
      and t.income_exclusion_bucket = 'REFUND'
  ),
  combined as (
    select * from outflows
    union all
    select * from refunds
  )
  select c.bucket, round(sum(c.absolute_amount), 2), count(*)::integer
  from combined c
  group by c.bucket
  order by 2 desc;
$$;

comment on function public.transfer_summary is
  'Everything deliberately kept out of Actual Spending for a period, grouped by reason.';

-- ---------------------------------------------------------------------------
-- data_freshness — per-institution sync state. Never implies data is live.
-- ---------------------------------------------------------------------------
create or replace function public.data_freshness()
returns table (
  institution_id uuid,
  institution_name text,
  plaid_item_id uuid,
  item_status public.plaid_item_status,
  error_code text,
  requires_reauth boolean,
  account_count integer,
  last_accounts_sync_at timestamptz,
  last_transactions_sync_at timestamptz,
  last_successful_sync_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    i.id,
    coalesce(i.display_name, i.name),
    pi.id,
    pi.status,
    pi.error_code,
    (pi.status in ('LOGIN_REQUIRED', 'PENDING_EXPIRATION', 'REVOKED')),
    (select count(*) from public.accounts a
      where a.plaid_item_id = pi.id and a.hidden = false)::integer,
    pi.last_accounts_sync_at,
    pi.last_transactions_sync_at,
    pi.last_successful_sync_at
  from public.plaid_items pi
  join public.institutions i on i.id = pi.institution_id
  where pi.disconnected_at is null
  order by coalesce(i.display_name, i.name);
$$;

-- ---------------------------------------------------------------------------
-- cash_trend — total cash at each month end, from balance snapshots.
--
-- Accounts are not guaranteed to be snapshotted every day, so each month takes
-- the most recent snapshot at or before the month end. is_complete reports
-- whether every included account actually had one, so a partial month is
-- visibly partial instead of looking like a dip.
-- ---------------------------------------------------------------------------
create or replace function public.cash_trend(p_from date, p_to date)
returns table (
  month_start date,
  total_cash numeric,
  currency char(3),
  accounts_with_data integer,
  accounts_expected integer,
  is_complete boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (select public.current_base_currency() as cur),
  months as (
    select
      generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as month_start
  ),
  cash_accounts as (
    select ab.id
    from public.account_balances ab, params p
    where ab.include_in_cash = true
      and ab.hidden = false
      and ab.currency is not distinct from p.cur
  ),
  point_in_time as (
    select
      m.month_start,
      ca.id as account_id,
      (
        select bs.current_balance
        from public.balance_snapshots bs
        where bs.account_id = ca.id
          and bs.captured_date <= (m.month_start + interval '1 month' - interval '1 day')::date
        order by bs.captured_date desc
        limit 1
      ) as balance
    from months m
    cross join cash_accounts ca
  )
  select
    pit.month_start,
    round(coalesce(sum(pit.balance), 0), 2),
    p.cur,
    count(pit.balance)::integer,
    count(*)::integer,
    (count(pit.balance) = count(*))
  from point_in_time pit
  cross join params p
  group by pit.month_start, p.cur
  order by pit.month_start;
$$;

-- ---------------------------------------------------------------------------
-- Grants — authenticated users may execute reporting functions.
-- ---------------------------------------------------------------------------
grant execute on function public.current_base_currency() to authenticated;
grant execute on function public.dashboard_cash_summary() to authenticated;
grant execute on function public.monthly_cashflow(date, date) to authenticated;
grant execute on function public.spending_by_category(date, date) to authenticated;
grant execute on function public.income_by_source(date, date) to authenticated;
grant execute on function public.top_merchants(date, date, integer) to authenticated;
grant execute on function public.transfer_summary(date, date) to authenticated;
grant execute on function public.data_freshness() to authenticated;
grant execute on function public.cash_trend(date, date) to authenticated;
