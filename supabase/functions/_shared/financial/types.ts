/**
 * Financial domain types shared by the Edge Functions and the test suite.
 *
 * This directory contains PURE TypeScript only: no Deno APIs, no external
 * imports, no I/O. That is what lets the same modules run inside Deno Edge
 * Functions and under Vitest in CI, so the classification and transfer-matching
 * logic that decides what counts as spending is tested by the normal
 * `pnpm test` run rather than by a separate Deno-only path.
 */

export type EconomicType =
  | 'INCOME'
  | 'EXPENSE'
  | 'REFUND'
  | 'TRANSFER'
  | 'ADJUSTMENT'
  | 'UNKNOWN';

export type TransferSubtype =
  | 'ACCOUNT_TO_ACCOUNT'
  | 'CHECKING_TO_SAVINGS'
  | 'SAVINGS_TO_CHECKING'
  | 'CREDIT_CARD_PAYMENT'
  | 'INVESTMENT_TRANSFER'
  | 'OTHER_INTERNAL';

export type TransferMatchStatus =
  | 'AUTO_MATCHED'
  | 'NEEDS_REVIEW'
  | 'USER_CONFIRMED'
  | 'USER_REJECTED';

export type Direction = 'INFLOW' | 'OUTFLOW';

/** The account context a classifier needs. Mirrors public.accounts. */
export type AccountContext = {
  id: string;
  /** Plaid account type: depository, credit, investment, brokerage, loan, other. */
  type: string;
  subtype: string | null;
  institutionId: string | null;
  currency: string | null;
};

/** A transaction as the classifier sees it. Amounts keep Plaid's raw sign. */
export type ClassifiableTransaction = {
  id: string;
  accountId: string;
  /** ISO date, `yyyy-MM-dd`. */
  postedDate: string;
  /** Raw description from the institution. */
  name: string;
  merchantName: string | null;
  /** Plaid convention: positive = money left the account. */
  amount: number;
  currency: string | null;
  pending: boolean;
  plaidCategoryPrimary: string | null;
  plaidCategoryDetailed: string | null;
};

export type RuleMatchField =
  | 'MERCHANT_NAME'
  | 'RAW_NAME'
  | 'MERCHANT_OR_NAME'
  | 'PLAID_CATEGORY_PRIMARY'
  | 'PLAID_CATEGORY_DETAILED';

export type RuleMatchOperator = 'CONTAINS' | 'EQUALS' | 'STARTS_WITH' | 'ENDS_WITH';

/** A user classification rule. Mirrors public.transaction_rules. */
export type TransactionRule = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  createdAt: string;
  matchField: RuleMatchField;
  matchOperator: RuleMatchOperator;
  matchValue: string;
  minAmount: number | null;
  maxAmount: number | null;
  accountId: string | null;
  resultType: EconomicType;
  resultTransferSubtype: TransferSubtype | null;
};

export type ClassificationResult = {
  type: EconomicType;
  transferSubtype: TransferSubtype | null;
  /**
   * Machine-readable audit trail, stored on the transaction. Explains which
   * rule or heuristic produced the classification.
   */
  reason: string;
  /**
   * True when this transaction looks like one leg of a movement between the
   * user's own accounts, but no counterpart has been matched yet. Transfer
   * detection uses this as a prior; the classification itself stays
   * conservative until a match exists.
   */
  isTransferCandidate: boolean;
  /** Subtype to apply if a counterpart is later matched. */
  candidateSubtype: TransferSubtype | null;
  /** The rule that fired, when one did. */
  ruleId: string | null;
};

/** One signal contributing to a transfer match's confidence. */
export type MatchSignal = {
  signal: string;
  detail: string;
  weight: number;
};

export type ProposedMatch = {
  outgoingTransactionId: string;
  incomingTransactionId: string;
  confidence: number;
  subtype: TransferSubtype;
  status: Extract<TransferMatchStatus, 'AUTO_MATCHED' | 'NEEDS_REVIEW'>;
  detectionMethod: string;
  reasons: MatchSignal[];
};

/** An existing match, used to keep detection idempotent. */
export type ExistingMatch = {
  outgoingTransactionId: string;
  incomingTransactionId: string;
  status: TransferMatchStatus;
};
