-- ---------------------------------------------------------------------------
-- Cash Atlas — the canonical calculation layer
--
-- transactions_classified is THE definition of what a transaction economically
-- means. The dashboard, the Cash Flow screen and the Atlas AI tools all read
-- through it, which is what makes it impossible for them to disagree.
--
-- Two invariants make every headline number explainable:
--
--   1. Exclusion buckets are MUTUALLY EXCLUSIVE. Every eligible outflow lands
--      in exactly one bucket, or in none (in which case it is spending).
--      Therefore, exactly:
--         gross_debits = actual expense outflows + sum(every exclusion bucket)
--      The "how we calculated this" panel is arithmetic, not a narrative.
--
--   2. Views are SECURITY INVOKER, so Row Level Security on the base tables
--      applies to every read through them. A view cannot become a data leak.
-- ---------------------------------------------------------------------------

create or replace view public.transactions_classified
with (security_invoker = true) as
select
  t.id,
  t.user_id,
  t.account_id,
  a.institution_id,
  coalesce(a.display_name, a.name)            as account_name,
  a.mask                                      as account_mask,
  a.type                                      as account_type,
  a.subtype                                   as account_subtype,
  a.source                                    as account_source,
  coalesce(i.display_name, i.name)            as institution_name,

  t.posted_date,
  t.authorized_date,
  t.datetime,
  t.name,
  t.merchant_name,
  coalesce(nullif(trim(t.merchant_name), ''), t.name) as display_name,

  -- Raw Plaid values, untouched.
  t.amount,
  t.pending,
  t.plaid_transaction_id,
  t.plaid_category_primary,
  t.plaid_category_detailed,
  t.plaid_category_confidence,
  t.plaid_payment_channel,
  t.logo_url,
  t.website_url,

  coalesce(t.iso_currency_code, t.unofficial_currency_code) as currency,

  -- ---- Effective classification: user override > system > UNKNOWN ---------
  coalesce(t.user_type, t.system_type)        as effective_type,
  case
    when t.user_type is not null then t.user_transfer_subtype
    else t.system_transfer_subtype
  end                                         as effective_transfer_subtype,
  (t.user_type is not null)                   as is_user_overridden,
  t.system_type,
  t.system_transfer_subtype,
  t.system_classification_reason,
  t.user_type,

  -- ---- Direction, free of Plaid sign conventions -------------------------
  -- Plaid: positive amount = money leaving the account.
  -- Zero-amount rows are degenerate; they carry no magnitude either way.
  case when t.amount >= 0 then 'OUTFLOW' else 'INFLOW' end as direction,
  abs(t.amount)                               as absolute_amount,

  t.excluded_from_spending,
  t.transfer_match_id,
  t.source_transaction_id,
  t.removed_at,
  t.created_at,
  t.updated_at,

  -- Eligible for financial reporting at all. Pending rows are excluded from
  -- every aggregate: Plaid replaces a pending transaction with a posted one, so
  -- counting both would double-count a single purchase.
  (t.removed_at is null and t.pending = false and a.hidden = false) as is_reportable,

  -- ---- Mutually exclusive spending exclusion bucket -----------------------
  case
    when t.removed_at is not null or t.pending or a.hidden then null
    when t.amount < 0 then null                              -- inflow
    when t.excluded_from_spending then 'USER_EXCLUDED'
    when coalesce(t.user_type, t.system_type) = 'TRANSFER'
      and (case when t.user_type is not null then t.user_transfer_subtype
                else t.system_transfer_subtype end) = 'CREDIT_CARD_PAYMENT'
      then 'CREDIT_CARD_PAYMENT'
    when coalesce(t.user_type, t.system_type) = 'TRANSFER'
      and (case when t.user_type is not null then t.user_transfer_subtype
                else t.system_transfer_subtype end) = 'INVESTMENT_TRANSFER'
      then 'INVESTMENT_TRANSFER'
    when coalesce(t.user_type, t.system_type) = 'TRANSFER' then 'INTERNAL_TRANSFER'
    when coalesce(t.user_type, t.system_type) = 'ADJUSTMENT' then 'ADJUSTMENT'
    when coalesce(t.user_type, t.system_type) = 'UNKNOWN' then 'UNCLASSIFIED'
    when coalesce(t.user_type, t.system_type) in ('INCOME', 'REFUND') then 'OTHER_NON_EXPENSE'
    else null                                                -- EXPENSE → spending
  end as spending_exclusion_bucket,

  -- ---- Mutually exclusive income exclusion bucket -------------------------
  case
    when t.removed_at is not null or t.pending or a.hidden then null
    when t.amount >= 0 then null                             -- outflow
    when t.excluded_from_spending then 'USER_EXCLUDED'
    when coalesce(t.user_type, t.system_type) = 'TRANSFER'
      and (case when t.user_type is not null then t.user_transfer_subtype
                else t.system_transfer_subtype end) = 'CREDIT_CARD_PAYMENT'
      then 'CREDIT_CARD_PAYMENT'
    when coalesce(t.user_type, t.system_type) = 'TRANSFER'
      and (case when t.user_type is not null then t.user_transfer_subtype
                else t.system_transfer_subtype end) = 'INVESTMENT_TRANSFER'
      then 'INVESTMENT_TRANSFER'
    when coalesce(t.user_type, t.system_type) = 'TRANSFER' then 'INTERNAL_TRANSFER'
    when coalesce(t.user_type, t.system_type) = 'REFUND' then 'REFUND'
    when coalesce(t.user_type, t.system_type) = 'ADJUSTMENT' then 'ADJUSTMENT'
    when coalesce(t.user_type, t.system_type) = 'UNKNOWN' then 'UNCLASSIFIED'
    when coalesce(t.user_type, t.system_type) = 'EXPENSE' then 'OTHER_NON_INCOME'
    else null                                                -- INCOME → earnings
  end as income_exclusion_bucket

from public.transactions t
join public.accounts a on a.id = t.account_id
left join public.institutions i on i.id = a.institution_id;

comment on view public.transactions_classified is
  'Canonical transaction projection: effective classification, direction, and mutually exclusive exclusion buckets. Every financial figure in Cash Atlas derives from this view.';

grant select on public.transactions_classified to authenticated;

-- ---------------------------------------------------------------------------
-- account_balances — accounts enriched with institution and connection health.
-- ---------------------------------------------------------------------------
create or replace view public.account_balances
with (security_invoker = true) as
select
  a.id,
  a.user_id,
  a.institution_id,
  a.plaid_item_id,
  a.source,
  a.name,
  a.display_name,
  coalesce(a.display_name, a.name) as effective_name,
  a.official_name,
  a.mask,
  a.type,
  a.subtype,
  a.current_balance,
  a.available_balance,
  a.credit_limit,
  coalesce(a.iso_currency_code, a.unofficial_currency_code) as currency,
  a.include_in_cash,
  a.include_in_net_worth,
  a.hidden,
  a.balances_updated_at,
  a.last_synced_at,
  a.closed_at,
  i.name                            as institution_name,
  i.display_name                    as institution_display_name,
  coalesce(i.display_name, i.name)  as institution_effective_name,
  i.logo_url                        as institution_logo_url,
  i.primary_color                   as institution_primary_color,
  pi.status                         as item_status,
  pi.error_code                     as item_error_code,
  pi.requires_reauth_since,
  pi.last_successful_sync_at,
  -- Classifies an account for cash reporting without scattering the rule.
  case
    when a.type = 'depository' and a.subtype in ('checking', 'chequing') then 'CHECKING'
    when a.type = 'depository' and a.subtype in ('savings', 'hsa', 'cd', 'money market') then 'SAVINGS'
    when a.type = 'depository' then 'OTHER_CASH'
    when a.type = 'credit' then 'CREDIT'
    when a.type in ('investment', 'brokerage') then 'INVESTMENT'
    when a.type = 'loan' then 'LOAN'
    else 'OTHER'
  end as cash_bucket
from public.accounts a
left join public.institutions i on i.id = a.institution_id
left join public.plaid_items pi on pi.id = a.plaid_item_id;

comment on view public.account_balances is
  'Accounts joined to institution metadata and Plaid connection health, with a derived cash_bucket used by the cash summary.';

grant select on public.account_balances to authenticated;

-- ---------------------------------------------------------------------------
-- transfer_review_queue — uncertain matches with both legs resolved for the UI.
-- ---------------------------------------------------------------------------
create or replace view public.transfer_review_queue
with (security_invoker = true) as
select
  m.id,
  m.user_id,
  m.confidence,
  m.detection_method,
  m.reason,
  m.subtype,
  m.status,
  m.created_at,

  m.outgoing_transaction_id,
  o.posted_date                       as outgoing_date,
  o.display_name                      as outgoing_name,
  o.absolute_amount                   as outgoing_amount,
  o.currency                          as outgoing_currency,
  o.account_name                      as outgoing_account_name,
  o.institution_name                  as outgoing_institution_name,

  m.incoming_transaction_id,
  n.posted_date                       as incoming_date,
  n.display_name                      as incoming_name,
  n.absolute_amount                   as incoming_amount,
  n.currency                          as incoming_currency,
  n.account_name                      as incoming_account_name,
  n.institution_name                  as incoming_institution_name
from public.transfer_matches m
join public.transactions_classified o on o.id = m.outgoing_transaction_id
join public.transactions_classified n on n.id = m.incoming_transaction_id;

comment on view public.transfer_review_queue is
  'Transfer matches with both legs denormalised for the Transfer Review screen.';

grant select on public.transfer_review_queue to authenticated;
