import type {
  AccountContext,
  ClassifiableTransaction,
  ClassificationResult,
  Direction,
  TransactionRule,
  TransferSubtype,
} from './types.ts';

/**
 * Automatic transaction classification.
 *
 * Precedence: user rules → Plaid's categorisation → direction fallback.
 * The result is written to `system_type`; it never touches `user_type`, so an
 * explicit user decision always outranks whatever this concludes.
 *
 * ## The rule that matters most
 *
 * Plaid labelling a transaction `TRANSFER_OUT` does NOT make it a transfer
 * between the user's own accounts. An Interac e-transfer to a friend, a rent
 * payment to a landlord and a move to one's own savings all land in
 * `TRANSFER_OUT`. Excluding all of them from spending would hide real money
 * going out the door — the exact failure this application exists to fix, in
 * reverse.
 *
 * So a Plaid transfer label makes a transaction a *candidate*. It becomes an
 * actual TRANSFER only when transfer detection matches it to a counterpart on
 * another account the user owns. Until then it is classified conservatively,
 * and conservative means different things by direction:
 *
 *   OUTFLOW candidate → EXPENSE   (never understate spending)
 *   INFLOW  candidate → UNKNOWN   (never overstate income)
 *
 * The asymmetry is deliberate. An unmatched outflow may genuinely be money
 * spent, so it counts. An unmatched inflow that Plaid thinks is a transfer is
 * very unlikely to be earnings, so it does not inflate income — it goes to the
 * review queue instead, where it is visible rather than silently binned.
 */

const CREDIT_ACCOUNT_TYPES = new Set(['credit']);
const INVESTMENT_ACCOUNT_TYPES = new Set(['investment', 'brokerage']);
const CHECKING_SUBTYPES = new Set(['checking', 'chequing']);
const SAVINGS_SUBTYPES = new Set(['savings', 'hsa', 'cd', 'money market']);

export function directionOf(amount: number): Direction {
  return amount >= 0 ? 'OUTFLOW' : 'INFLOW';
}

/**
 * Classifies one transaction.
 *
 * `rules` must already be filtered to enabled rules for this user; they are
 * evaluated in priority order (lower number first, then oldest first) and the
 * first match wins.
 */
export function classifyTransaction(
  transaction: ClassifiableTransaction,
  account: AccountContext,
  rules: readonly TransactionRule[] = [],
): ClassificationResult {
  const rule = findMatchingRule(transaction, rules);
  if (rule) {
    return {
      type: rule.resultType,
      transferSubtype: rule.resultType === 'TRANSFER' ? rule.resultTransferSubtype : null,
      reason: `rule:${rule.id}:${rule.name}`,
      // A user rule saying TRANSFER is an instruction, not a hypothesis.
      isTransferCandidate: rule.resultType === 'TRANSFER',
      candidateSubtype: rule.resultTransferSubtype,
      ruleId: rule.id,
    };
  }

  return classifyFromPlaidCategory(transaction, account);
}

/** Ordering is fixed so that classification is reproducible. */
export function sortRules(rules: readonly TransactionRule[]): TransactionRule[] {
  return [...rules]
    .filter((rule) => rule.enabled)
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
}

export function findMatchingRule(
  transaction: ClassifiableTransaction,
  rules: readonly TransactionRule[],
): TransactionRule | null {
  for (const rule of sortRules(rules)) {
    if (ruleMatches(rule, transaction)) return rule;
  }
  return null;
}

export function ruleMatches(
  rule: TransactionRule,
  transaction: ClassifiableTransaction,
): boolean {
  if (rule.accountId && rule.accountId !== transaction.accountId) return false;

  // Amount narrowing compares magnitudes, so a rule for "over $500" catches
  // both a $600 purchase and a $600 deposit.
  const magnitude = Math.abs(transaction.amount);
  if (rule.minAmount != null && magnitude < rule.minAmount) return false;
  if (rule.maxAmount != null && magnitude > rule.maxAmount) return false;

  const haystack = fieldValue(rule.matchField, transaction);
  if (haystack === null) return false;

  const needle = rule.matchValue.trim().toLowerCase();
  if (needle.length === 0) return false;
  const value = haystack.toLowerCase();

  switch (rule.matchOperator) {
    case 'CONTAINS':
      return value.includes(needle);
    case 'EQUALS':
      return value === needle;
    case 'STARTS_WITH':
      return value.startsWith(needle);
    case 'ENDS_WITH':
      return value.endsWith(needle);
  }
}

function fieldValue(
  field: TransactionRule['matchField'],
  transaction: ClassifiableTransaction,
): string | null {
  switch (field) {
    case 'MERCHANT_NAME':
      return transaction.merchantName;
    case 'RAW_NAME':
      return transaction.name;
    case 'MERCHANT_OR_NAME':
      return `${transaction.merchantName ?? ''} ${transaction.name}`.trim();
    case 'PLAID_CATEGORY_PRIMARY':
      return transaction.plaidCategoryPrimary;
    case 'PLAID_CATEGORY_DETAILED':
      return transaction.plaidCategoryDetailed;
  }
}

/**
 * Maps Plaid's Personal Finance Category onto our economic vocabulary.
 *
 * Plaid's raw values are never modified — this reads them and writes a separate
 * column, so the bank's own opinion stays available for inspection.
 */
function classifyFromPlaidCategory(
  transaction: ClassifiableTransaction,
  account: AccountContext,
): ClassificationResult {
  const direction = directionOf(transaction.amount);
  const primary = transaction.plaidCategoryPrimary ?? '';
  const detailed = transaction.plaidCategoryDetailed ?? '';

  const isTransferCategory = primary === 'TRANSFER_IN' || primary === 'TRANSFER_OUT';
  const isCreditCardPayment =
    primary === 'LOAN_PAYMENTS' && detailed === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';

  if (isTransferCategory || isCreditCardPayment) {
    const candidateSubtype = inferCandidateSubtype(detailed, account, direction, isCreditCardPayment);

    if (direction === 'OUTFLOW') {
      // Counts as spending until a counterpart proves it was internal.
      return {
        type: 'EXPENSE',
        transferSubtype: null,
        reason: `plaid:${detailed || primary}:unmatched_transfer_candidate_counts_as_spending`,
        isTransferCandidate: true,
        candidateSubtype,
        ruleId: null,
      };
    }

    // An unmatched inflow that Plaid calls a transfer is not earnings. Left
    // UNKNOWN so it is excluded from income and surfaced for review.
    return {
      type: 'UNKNOWN',
      transferSubtype: null,
      reason: `plaid:${detailed || primary}:unmatched_transfer_candidate_awaiting_review`,
      isTransferCandidate: true,
      candidateSubtype,
      ruleId: null,
    };
  }

  if (primary === 'INCOME') {
    if (direction === 'INFLOW') {
      return {
        type: 'INCOME',
        transferSubtype: null,
        reason: `plaid:${detailed || primary}`,
        isTransferCandidate: false,
        candidateSubtype: null,
        ruleId: null,
      };
    }
    // Income flowing outward is a clawback or correction, not spending.
    return {
      type: 'ADJUSTMENT',
      transferSubtype: null,
      reason: `plaid:${detailed || primary}:income_reversal`,
      isTransferCandidate: false,
      candidateSubtype: null,
      ruleId: null,
    };
  }

  if (direction === 'INFLOW') {
    /*
     * Money arriving under a spending category is a refund: a returned
     * purchase, a reversed fee, a corrected charge. Refunds reduce spending
     * rather than counting as income, which is handled downstream by the
     * exclusion buckets.
     */
    return {
      type: 'REFUND',
      transferSubtype: null,
      reason: `plaid:${detailed || primary || 'uncategorized'}:inflow_treated_as_refund`,
      isTransferCandidate: false,
      candidateSubtype: null,
      ruleId: null,
    };
  }

  return {
    type: 'EXPENSE',
    transferSubtype: null,
    reason: primary ? `plaid:${detailed || primary}` : 'fallback:outflow_is_expense',
    isTransferCandidate: false,
    candidateSubtype: null,
    ruleId: null,
  };
}

/**
 * What kind of transfer this would be, if a counterpart is found.
 *
 * Uses Plaid's detailed category plus the account it landed on. The definitive
 * answer comes from the pair once matched — this is the single-sided guess.
 */
function inferCandidateSubtype(
  detailed: string,
  account: AccountContext,
  direction: Direction,
  isCreditCardPayment: boolean,
): TransferSubtype {
  if (isCreditCardPayment) return 'CREDIT_CARD_PAYMENT';
  if (CREDIT_ACCOUNT_TYPES.has(account.type)) return 'CREDIT_CARD_PAYMENT';
  if (INVESTMENT_ACCOUNT_TYPES.has(account.type)) return 'INVESTMENT_TRANSFER';

  if (detailed.includes('INVESTMENT') || detailed.includes('RETIREMENT')) {
    return 'INVESTMENT_TRANSFER';
  }

  if (detailed.includes('SAVINGS')) {
    return direction === 'OUTFLOW' ? 'CHECKING_TO_SAVINGS' : 'SAVINGS_TO_CHECKING';
  }

  if (detailed.includes('ACCOUNT_TRANSFER')) return 'ACCOUNT_TO_ACCOUNT';

  return 'OTHER_INTERNAL';
}

/**
 * The definitive subtype for a matched pair, derived from both accounts.
 *
 * Preferred over the single-sided guess whenever a match exists, because the
 * destination account is what actually determines the kind of movement.
 */
export function resolveMatchedSubtype(
  fromAccount: AccountContext,
  toAccount: AccountContext,
): TransferSubtype {
  if (CREDIT_ACCOUNT_TYPES.has(toAccount.type)) return 'CREDIT_CARD_PAYMENT';
  if (INVESTMENT_ACCOUNT_TYPES.has(toAccount.type)) return 'INVESTMENT_TRANSFER';

  const fromChecking = isChecking(fromAccount);
  const toChecking = isChecking(toAccount);
  const fromSavings = isSavings(fromAccount);
  const toSavings = isSavings(toAccount);

  if (fromChecking && toSavings) return 'CHECKING_TO_SAVINGS';
  if (fromSavings && toChecking) return 'SAVINGS_TO_CHECKING';

  return 'ACCOUNT_TO_ACCOUNT';
}

export function isChecking(account: AccountContext): boolean {
  return account.type === 'depository' && CHECKING_SUBTYPES.has(account.subtype ?? '');
}

export function isSavings(account: AccountContext): boolean {
  return account.type === 'depository' && SAVINGS_SUBTYPES.has(account.subtype ?? '');
}

export function isCreditAccount(account: AccountContext): boolean {
  return CREDIT_ACCOUNT_TYPES.has(account.type);
}

/**
 * Whether an account should count toward Total Cash by default.
 *
 * Applied once, when an account is first synced. After that the flag belongs to
 * the user and sync must preserve whatever they set.
 */
export function defaultIncludeInCash(account: AccountContext): boolean {
  return account.type === 'depository';
}
