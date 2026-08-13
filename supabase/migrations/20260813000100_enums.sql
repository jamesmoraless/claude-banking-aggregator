-- ---------------------------------------------------------------------------
-- Cash Atlas — enumerated domains
--
-- These enums encode the financial vocabulary used across the database, the
-- Edge Functions and the React client. They are additive-friendly: new values
-- can be appended with ALTER TYPE ... ADD VALUE in a later migration without
-- rewriting rows, which keeps schema evolution rollback-friendly.
-- ---------------------------------------------------------------------------

-- Where an account's data comes from.
create type public.account_source as enum ('plaid', 'manual');

-- Economic meaning of a transaction. This is *our* classification and is kept
-- strictly separate from Plaid's own categorisation, which is never mutated.
create type public.economic_type as enum (
  'INCOME',
  'EXPENSE',
  'REFUND',
  'TRANSFER',
  'ADJUSTMENT',
  'UNKNOWN'
);

-- When a transaction is a TRANSFER, what kind of movement it represents.
create type public.transfer_subtype as enum (
  'ACCOUNT_TO_ACCOUNT',
  'CHECKING_TO_SAVINGS',
  'SAVINGS_TO_CHECKING',
  'CREDIT_CARD_PAYMENT',
  'INVESTMENT_TRANSFER',
  'OTHER_INTERNAL'
);

-- Lifecycle of a detected transfer pair.
create type public.transfer_match_status as enum (
  'AUTO_MATCHED',
  'NEEDS_REVIEW',
  'USER_CONFIRMED',
  'USER_REJECTED'
);

-- Health of a Plaid Item connection.
create type public.plaid_item_status as enum (
  'ACTIVE',            -- healthy
  'LOGIN_REQUIRED',    -- needs Plaid Link update mode
  'PENDING_EXPIRATION',-- consent expiring soon (EU/UK style consent windows)
  'ERROR',             -- Plaid reported a non-auth error
  'REVOKED',           -- user or institution revoked access
  'DISCONNECTED'       -- removed by the user from Cash Atlas
);

-- Operations recorded in sync_runs for operational visibility.
create type public.sync_operation as enum (
  'ITEM_EXCHANGE',
  'ACCOUNTS_SYNC',
  'TRANSACTIONS_SYNC',
  'ITEM_REMOVE',
  'WEBHOOK',
  'SYNC_ALL',
  'TRANSFER_DETECTION'
);

create type public.sync_status as enum ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- Which field a user classification rule inspects.
create type public.rule_match_field as enum (
  'MERCHANT_NAME',
  'RAW_NAME',
  'MERCHANT_OR_NAME',
  'PLAID_CATEGORY_PRIMARY',
  'PLAID_CATEGORY_DETAILED'
);

-- Deliberately small operator set. Extensible without becoming a query language.
create type public.rule_match_operator as enum ('CONTAINS', 'EQUALS', 'STARTS_WITH', 'ENDS_WITH');
