/** Subset of the Plaid API surface Cash Atlas uses. */

export type PlaidAccount = {
  account_id: string;
  balances: {
    available: number | null;
    current: number | null;
    limit: number | null;
    iso_currency_code: string | null;
    unofficial_currency_code: string | null;
  };
  mask: string | null;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
};

export type PlaidPersonalFinanceCategory = {
  primary: string;
  detailed: string;
  confidence_level?: string | null;
};

export type PlaidTransaction = {
  transaction_id: string;
  account_id: string;
  pending_transaction_id: string | null;
  amount: number;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
  date: string;
  authorized_date: string | null;
  datetime: string | null;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  payment_channel: string | null;
  transaction_code: string | null;
  website: string | null;
  logo_url: string | null;
  personal_finance_category: PlaidPersonalFinanceCategory | null;
};

export type PlaidRemovedTransaction = { transaction_id: string };

export type PlaidItem = {
  item_id: string;
  institution_id: string | null;
  webhook: string | null;
  available_products: string[];
  billed_products: string[];
  consent_expiration_time: string | null;
  update_type: string | null;
  error: PlaidApiErrorBody | null;
};

export type PlaidInstitution = {
  institution_id: string;
  name: string;
  url: string | null;
  primary_color: string | null;
  logo: string | null;
};

export type PlaidApiErrorBody = {
  error_type: string;
  error_code: string;
  error_message: string;
  display_message: string | null;
  request_id?: string;
};

export type LinkTokenResponse = {
  link_token: string;
  expiration: string;
  request_id: string;
};

export type ExchangeResponse = {
  access_token: string;
  item_id: string;
  request_id: string;
};

export type AccountsGetResponse = {
  accounts: PlaidAccount[];
  item: PlaidItem;
  request_id: string;
};

export type TransactionsSyncResponse = {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: PlaidRemovedTransaction[];
  next_cursor: string;
  has_more: boolean;
  request_id: string;
};

export type ItemGetResponse = { item: PlaidItem; request_id: string };

export type InstitutionGetResponse = { institution: PlaidInstitution; request_id: string };

export type WebhookVerificationKeyResponse = {
  key: {
    alg: string;
    created_at: number;
    crv: string;
    kid: string;
    kty: string;
    use: string;
    x: string;
    y: string;
    expired_at: number | null;
  };
  request_id: string;
};
