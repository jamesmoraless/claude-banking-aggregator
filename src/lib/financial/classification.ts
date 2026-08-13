import type { Enums } from '@/types/database.types';

/**
 * Economic classification vocabulary, and the precedence rule that resolves it.
 *
 * Precedence, highest first:
 *   1. user override        — an explicit human decision
 *   2. system classification — our normalisation engine
 *   3. UNKNOWN               — we genuinely do not know
 *
 * Plaid's own categorisation is an INPUT to (2) and is never overwritten by it;
 * both are stored side by side so a classification can always be traced back to
 * what the bank actually said.
 *
 * This mirrors the `effective_type` expression in the transactions_classified
 * SQL view. The database is authoritative for aggregates; this module exists so
 * the UI can resolve a single row consistently without a round trip.
 */

export type EconomicType = Enums<'economic_type'>;
export type TransferSubtype = Enums<'transfer_subtype'>;
export type TransferMatchStatus = Enums<'transfer_match_status'>;

export const ECONOMIC_TYPES: readonly EconomicType[] = [
  'INCOME',
  'EXPENSE',
  'REFUND',
  'TRANSFER',
  'ADJUSTMENT',
  'UNKNOWN',
] as const;

export const TRANSFER_SUBTYPES: readonly TransferSubtype[] = [
  'ACCOUNT_TO_ACCOUNT',
  'CHECKING_TO_SAVINGS',
  'SAVINGS_TO_CHECKING',
  'CREDIT_CARD_PAYMENT',
  'INVESTMENT_TRANSFER',
  'OTHER_INTERNAL',
] as const;

export type ClassificationInput = {
  userType: EconomicType | null | undefined;
  userTransferSubtype: TransferSubtype | null | undefined;
  systemType: EconomicType | null | undefined;
  systemTransferSubtype: TransferSubtype | null | undefined;
};

export type EffectiveClassification = {
  type: EconomicType;
  transferSubtype: TransferSubtype | null;
  /** True when a human decision is what produced `type`. */
  isUserOverridden: boolean;
  source: 'USER' | 'SYSTEM' | 'DEFAULT';
};

/**
 * Resolves the effective classification.
 *
 * The subtype travels with its own layer: if the user says TRANSFER, the
 * subtype comes from the user's record, not from a leftover system guess.
 * Mixing them would attribute a subtype to a decision that never made it.
 */
export function resolveClassification(input: ClassificationInput): EffectiveClassification {
  if (input.userType != null) {
    return {
      type: input.userType,
      transferSubtype: input.userType === 'TRANSFER' ? (input.userTransferSubtype ?? null) : null,
      isUserOverridden: true,
      source: 'USER',
    };
  }

  if (input.systemType != null && input.systemType !== 'UNKNOWN') {
    return {
      type: input.systemType,
      transferSubtype:
        input.systemType === 'TRANSFER' ? (input.systemTransferSubtype ?? null) : null,
      isUserOverridden: false,
      source: 'SYSTEM',
    };
  }

  return {
    type: 'UNKNOWN',
    transferSubtype: null,
    isUserOverridden: false,
    source: input.systemType === 'UNKNOWN' ? 'SYSTEM' : 'DEFAULT',
  };
}

// ---------------------------------------------------------------------------
// Presentation vocabulary
// ---------------------------------------------------------------------------

export const ECONOMIC_TYPE_LABELS: Record<EconomicType, string> = {
  INCOME: 'Income',
  EXPENSE: 'Expense',
  REFUND: 'Refund',
  TRANSFER: 'Transfer',
  ADJUSTMENT: 'Adjustment',
  UNKNOWN: 'Needs review',
};

export const TRANSFER_SUBTYPE_LABELS: Record<TransferSubtype, string> = {
  ACCOUNT_TO_ACCOUNT: 'Between accounts',
  CHECKING_TO_SAVINGS: 'Checking → Savings',
  SAVINGS_TO_CHECKING: 'Savings → Checking',
  CREDIT_CARD_PAYMENT: 'Credit card payment',
  INVESTMENT_TRANSFER: 'Investment transfer',
  OTHER_INTERNAL: 'Other internal',
};

/**
 * Buckets emitted by transactions_classified. Kept in sync with the CASE
 * expressions in supabase/migrations/*_canonical_views.sql.
 */
export const EXCLUSION_BUCKETS = [
  'INTERNAL_TRANSFER',
  'CREDIT_CARD_PAYMENT',
  'INVESTMENT_TRANSFER',
  'REFUND',
  'UNCLASSIFIED',
  'ADJUSTMENT',
  'USER_EXCLUDED',
  'OTHER_NON_EXPENSE',
  'OTHER_NON_INCOME',
] as const;

export type ExclusionBucket = (typeof EXCLUSION_BUCKETS)[number];

export const EXCLUSION_BUCKET_LABELS: Record<ExclusionBucket, string> = {
  INTERNAL_TRANSFER: 'Internal transfers',
  CREDIT_CARD_PAYMENT: 'Credit card payments',
  INVESTMENT_TRANSFER: 'Investment transfers',
  REFUND: 'Refunds',
  UNCLASSIFIED: 'Unclassified',
  ADJUSTMENT: 'Adjustments',
  USER_EXCLUDED: 'Excluded by you',
  OTHER_NON_EXPENSE: 'Other non-expense',
  OTHER_NON_INCOME: 'Other non-income',
};

export const EXCLUSION_BUCKET_DESCRIPTIONS: Record<ExclusionBucket, string> = {
  INTERNAL_TRANSFER: 'Money moved between your own accounts',
  CREDIT_CARD_PAYMENT: 'Payments to cards whose purchases are already counted',
  INVESTMENT_TRANSFER: 'Contributions and transfers to investments',
  REFUND: 'Returns and refunds received',
  UNCLASSIFIED: 'Not yet classified — review to include these',
  ADJUSTMENT: 'Corrections that are not real activity',
  USER_EXCLUDED: 'Transactions you chose to ignore',
  OTHER_NON_EXPENSE: 'Outflows classified as something other than an expense',
  OTHER_NON_INCOME: 'Inflows classified as something other than income',
};

export function isExclusionBucket(value: string | null | undefined): value is ExclusionBucket {
  return value != null && (EXCLUSION_BUCKETS as readonly string[]).includes(value);
}

export function exclusionBucketLabel(value: string | null | undefined): string {
  return isExclusionBucket(value) ? EXCLUSION_BUCKET_LABELS[value] : 'Other';
}

/**
 * Which transfer subtype to assume for a pair of accounts. Deliberately
 * explicit rather than clever: each combination is spelled out.
 */
export function inferTransferSubtype(
  outgoingAccountType: string,
  outgoingAccountSubtype: string | null,
  incomingAccountType: string,
  incomingAccountSubtype: string | null,
): TransferSubtype {
  const isChecking = (type: string, subtype: string | null) =>
    type === 'depository' && (subtype === 'checking' || subtype === 'chequing');
  const isSavings = (type: string, subtype: string | null) =>
    type === 'depository' && (subtype === 'savings' || subtype === 'hsa' || subtype === 'cd');

  if (incomingAccountType === 'credit') return 'CREDIT_CARD_PAYMENT';
  if (incomingAccountType === 'investment' || incomingAccountType === 'brokerage') {
    return 'INVESTMENT_TRANSFER';
  }
  if (
    isChecking(outgoingAccountType, outgoingAccountSubtype) &&
    isSavings(incomingAccountType, incomingAccountSubtype)
  ) {
    return 'CHECKING_TO_SAVINGS';
  }
  if (
    isSavings(outgoingAccountType, outgoingAccountSubtype) &&
    isChecking(incomingAccountType, incomingAccountSubtype)
  ) {
    return 'SAVINGS_TO_CHECKING';
  }
  return 'ACCOUNT_TO_ACCOUNT';
}
