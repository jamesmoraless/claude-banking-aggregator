import type { FunctionReturns } from '@/types/database.types';

import { roundToCents } from './money';

/**
 * Cash flow arithmetic.
 *
 * The database computes every monthly figure; this module derives period totals
 * from those rows and builds the explanation structure the UI renders. It never
 * recomputes a monthly number from raw transactions — doing that would create a
 * second calculation path that could disagree with the first.
 */

export type MonthlyCashflowRow = FunctionReturns<'monthly_cashflow'>[number];

export type CashflowTotals = {
  currency: string;
  grossDebits: number;
  grossCredits: number;
  expenseOutflows: number;
  refunds: number;
  actualSpending: number;
  actualIncome: number;
  internalTransfers: number;
  creditCardPayments: number;
  investmentTransfers: number;
  unclassifiedOutflows: number;
  adjustmentOutflows: number;
  userExcludedOutflows: number;
  otherNonExpenseOutflows: number;
  surplus: number;
  savingsRate: number | null;
  transactionCount: number;
  unclassifiedTransactionCount: number;
  foreignCurrencyTransactionCount: number;
};

const EMPTY_TOTALS: Omit<CashflowTotals, 'currency'> = {
  grossDebits: 0,
  grossCredits: 0,
  expenseOutflows: 0,
  refunds: 0,
  actualSpending: 0,
  actualIncome: 0,
  internalTransfers: 0,
  creditCardPayments: 0,
  investmentTransfers: 0,
  unclassifiedOutflows: 0,
  adjustmentOutflows: 0,
  userExcludedOutflows: 0,
  otherNonExpenseOutflows: 0,
  surplus: 0,
  savingsRate: null,
  transactionCount: 0,
  unclassifiedTransactionCount: 0,
  foreignCurrencyTransactionCount: 0,
};

/**
 * Sums monthly rows into a period total.
 *
 * Surplus and savings rate are RECOMPUTED from the summed components rather
 * than averaged across months. Averaging a ratio is wrong: three months at 50%
 * on $100 income and one month at 0% on $10,000 income is not a 37.5% savings
 * rate. The rate for a period is that period's surplus over its income.
 */
export function sumCashflow(rows: readonly MonthlyCashflowRow[]): CashflowTotals {
  const currency = rows[0]?.currency ?? 'CAD';
  if (rows.length === 0) return { currency, ...EMPTY_TOTALS };

  const totals = rows.reduce(
    (acc, row) => ({
      grossDebits: acc.grossDebits + row.gross_debits,
      grossCredits: acc.grossCredits + row.gross_credits,
      expenseOutflows: acc.expenseOutflows + row.expense_outflows,
      refunds: acc.refunds + row.refunds,
      actualIncome: acc.actualIncome + row.actual_income,
      internalTransfers: acc.internalTransfers + row.internal_transfers,
      creditCardPayments: acc.creditCardPayments + row.credit_card_payments,
      investmentTransfers: acc.investmentTransfers + row.investment_transfers,
      unclassifiedOutflows: acc.unclassifiedOutflows + row.unclassified_outflows,
      adjustmentOutflows: acc.adjustmentOutflows + row.adjustment_outflows,
      userExcludedOutflows: acc.userExcludedOutflows + row.user_excluded_outflows,
      otherNonExpenseOutflows: acc.otherNonExpenseOutflows + row.other_non_expense_outflows,
      transactionCount: acc.transactionCount + row.transaction_count,
      unclassifiedTransactionCount:
        acc.unclassifiedTransactionCount + row.unclassified_transaction_count,
      foreignCurrencyTransactionCount:
        acc.foreignCurrencyTransactionCount + row.foreign_currency_transaction_count,
    }),
    {
      grossDebits: 0,
      grossCredits: 0,
      expenseOutflows: 0,
      refunds: 0,
      actualIncome: 0,
      internalTransfers: 0,
      creditCardPayments: 0,
      investmentTransfers: 0,
      unclassifiedOutflows: 0,
      adjustmentOutflows: 0,
      userExcludedOutflows: 0,
      otherNonExpenseOutflows: 0,
      transactionCount: 0,
      unclassifiedTransactionCount: 0,
      foreignCurrencyTransactionCount: 0,
    },
  );

  const actualSpending = roundToCents(totals.expenseOutflows - totals.refunds);
  const actualIncome = roundToCents(totals.actualIncome);
  const surplus = roundToCents(actualIncome - actualSpending);

  return {
    currency,
    ...totals,
    grossDebits: roundToCents(totals.grossDebits),
    grossCredits: roundToCents(totals.grossCredits),
    expenseOutflows: roundToCents(totals.expenseOutflows),
    refunds: roundToCents(totals.refunds),
    actualSpending,
    actualIncome,
    surplus,
    savingsRate: calculateSavingsRate(actualIncome, surplus),
  };
}

/**
 * Savings rate = surplus / actual income.
 *
 * Returns null — never 0, never Infinity — when income is zero or negative.
 * A month with no income has no savings rate, and rendering "0%" would imply
 * the user saved nothing when in fact the question does not apply.
 */
export function calculateSavingsRate(actualIncome: number, surplus: number): number | null {
  if (!Number.isFinite(actualIncome) || !Number.isFinite(surplus)) return null;
  if (actualIncome <= 0) return null;
  return surplus / actualIncome;
}

// ---------------------------------------------------------------------------
// The calculation explanation
// ---------------------------------------------------------------------------

export type ExplanationLine = {
  key: string;
  label: string;
  description: string;
  amount: number;
  /** How the line combines with the running total. */
  operator: 'BASE' | 'SUBTRACT' | 'ADD' | 'RESULT';
  /** Lines the user can click through to the underlying transactions. */
  drillDownBucket?: string;
  /** Draws attention when non-zero: money we could not confidently classify. */
  needsAttention?: boolean;
};

export type SpendingExplanation = {
  currency: string;
  lines: ExplanationLine[];
  actualSpending: number;
  /** True when the components sum exactly to the result. Always true in practice;
   *  asserted so a schema change that breaks the invariant is caught loudly. */
  balances: boolean;
};

/**
 * Builds the "how we calculated your actual spending" breakdown.
 *
 * Every eligible outflow lands in exactly one line, so the arithmetic closes:
 * gross debits minus each exclusion, minus refunds, equals actual spending.
 * If it ever fails to close, `balances` is false and the UI says so rather than
 * quietly presenting a number that cannot be reconstructed.
 */
export function buildSpendingExplanation(totals: CashflowTotals): SpendingExplanation {
  const lines: ExplanationLine[] = [
    {
      key: 'gross_debits',
      label: 'Gross debits',
      description: 'All money that left your accounts',
      amount: totals.grossDebits,
      operator: 'BASE',
    },
    {
      key: 'internal_transfers',
      label: 'Internal transfers',
      description: 'Between your own accounts',
      amount: totals.internalTransfers,
      operator: 'SUBTRACT',
      drillDownBucket: 'INTERNAL_TRANSFER',
    },
    {
      key: 'credit_card_payments',
      label: 'Credit card payments',
      description: 'Payments to cards whose purchases are already counted',
      amount: totals.creditCardPayments,
      operator: 'SUBTRACT',
      drillDownBucket: 'CREDIT_CARD_PAYMENT',
    },
    {
      key: 'investment_transfers',
      label: 'Investment transfers',
      description: 'Contributions to investments, not consumption',
      amount: totals.investmentTransfers,
      operator: 'SUBTRACT',
      drillDownBucket: 'INVESTMENT_TRANSFER',
    },
    {
      key: 'adjustment_outflows',
      label: 'Adjustments',
      description: 'Corrections that are not real activity',
      amount: totals.adjustmentOutflows,
      operator: 'SUBTRACT',
      drillDownBucket: 'ADJUSTMENT',
    },
    {
      key: 'user_excluded_outflows',
      label: 'Excluded by you',
      description: 'Transactions you chose to ignore',
      amount: totals.userExcludedOutflows,
      operator: 'SUBTRACT',
      drillDownBucket: 'USER_EXCLUDED',
    },
    {
      key: 'other_non_expense_outflows',
      label: 'Other non-expense',
      description: 'Outflows classified as something other than an expense',
      amount: totals.otherNonExpenseOutflows,
      operator: 'SUBTRACT',
      drillDownBucket: 'OTHER_NON_EXPENSE',
    },
    {
      key: 'unclassified_outflows',
      label: 'Unclassified',
      description: 'Not yet classified — review these to include them',
      amount: totals.unclassifiedOutflows,
      operator: 'SUBTRACT',
      drillDownBucket: 'UNCLASSIFIED',
      needsAttention: totals.unclassifiedOutflows > 0,
    },
    {
      key: 'refunds',
      label: 'Applicable refunds',
      description: 'Returns received, which reduce spending',
      amount: totals.refunds,
      operator: 'SUBTRACT',
      drillDownBucket: 'REFUND',
    },
    {
      key: 'actual_spending',
      label: 'Actual spending',
      description: 'What you really spent',
      amount: totals.actualSpending,
      operator: 'RESULT',
    },
  ];

  const deductions = lines
    .filter((line) => line.operator === 'SUBTRACT')
    .reduce((sum, line) => sum + line.amount, 0);
  const derived = roundToCents(totals.grossDebits - deductions);

  return {
    currency: totals.currency,
    lines,
    actualSpending: totals.actualSpending,
    balances: Math.abs(derived - totals.actualSpending) < 0.02,
  };
}

export type IncomeExplanation = {
  currency: string;
  lines: ExplanationLine[];
  actualIncome: number;
};

export function buildIncomeExplanation(totals: CashflowTotals): IncomeExplanation {
  return {
    currency: totals.currency,
    actualIncome: totals.actualIncome,
    lines: [
      {
        key: 'gross_credits',
        label: 'Gross credits',
        description: 'All money that arrived in your accounts',
        amount: totals.grossCredits,
        operator: 'BASE',
      },
      {
        key: 'income_internal_transfers',
        label: 'Internal transfers in',
        description: 'The receiving side of your own transfers',
        amount: roundToCents(totals.grossCredits - totals.actualIncome - totals.refunds),
        operator: 'SUBTRACT',
        drillDownBucket: 'INTERNAL_TRANSFER',
      },
      {
        key: 'refunds_in',
        label: 'Refunds',
        description: 'Refunds reduce spending rather than count as earnings',
        amount: totals.refunds,
        operator: 'SUBTRACT',
        drillDownBucket: 'REFUND',
      },
      {
        key: 'actual_income',
        label: 'Actual income',
        description: 'What you really earned',
        amount: totals.actualIncome,
        operator: 'RESULT',
      },
    ],
  };
}

/** Whether a period's figures should be presented with a completeness caveat. */
export function hasDataQualityCaveats(totals: CashflowTotals): boolean {
  return totals.unclassifiedTransactionCount > 0 || totals.foreignCurrencyTransactionCount > 0;
}
