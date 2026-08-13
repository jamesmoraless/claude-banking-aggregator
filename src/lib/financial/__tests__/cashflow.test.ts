import { describe, expect, it } from 'vitest';

import {
  buildSpendingExplanation,
  calculateSavingsRate,
  type MonthlyCashflowRow,
  sumCashflow,
} from '../cashflow';

/**
 * Cash flow arithmetic.
 *
 * The scenario below is the one from the specification: gross debits of
 * $15,842 reduced by internal transfers, credit-card payments and investment
 * transfers, against $10,450 of income.
 */
function monthRow(overrides: Partial<MonthlyCashflowRow> = {}): MonthlyCashflowRow {
  return {
    month_start: '2026-07-01',
    currency: 'CAD',
    gross_debits: 0,
    gross_credits: 0,
    expense_outflows: 0,
    refunds: 0,
    actual_spending: 0,
    actual_income: 0,
    internal_transfers: 0,
    credit_card_payments: 0,
    investment_transfers: 0,
    unclassified_outflows: 0,
    adjustment_outflows: 0,
    user_excluded_outflows: 0,
    other_non_expense_outflows: 0,
    income_internal_transfers: 0,
    income_unclassified: 0,
    surplus: 0,
    savings_rate: null,
    transaction_count: 0,
    unclassified_transaction_count: 0,
    foreign_currency_transaction_count: 0,
    ...overrides,
  };
}

const JULY = monthRow({
  gross_debits: 15842,
  gross_credits: 13660,
  internal_transfers: 3210,
  credit_card_payments: 4712,
  investment_transfers: 1089,
  expense_outflows: 6831,
  refunds: 0,
  actual_spending: 6831,
  actual_income: 10450,
  surplus: 3619,
  savings_rate: 0.3463,
  transaction_count: 214,
});

describe('sumCashflow', () => {
  it('reproduces the headline figures for a single month', () => {
    const totals = sumCashflow([JULY]);

    expect(totals.grossDebits).toBe(15842);
    expect(totals.actualSpending).toBe(6831);
    expect(totals.actualIncome).toBe(10450);
    expect(totals.surplus).toBe(3619);
    expect(totals.savingsRate).toBeCloseTo(0.3463, 4);
  });

  it('subtracts refunds from expense outflows', () => {
    const totals = sumCashflow([
      monthRow({ expense_outflows: 7076, refunds: 245, actual_income: 10450 }),
    ]);

    // 7,076 spent less 245 returned = 6,831 actually spent.
    expect(totals.actualSpending).toBe(6831);
    expect(totals.surplus).toBe(3619);
  });

  it('lets a refund-dominated month net negative rather than clamping to zero', () => {
    const totals = sumCashflow([monthRow({ expense_outflows: 100, refunds: 400 })]);
    expect(totals.actualSpending).toBe(-300);
  });

  /**
   * Averaging monthly savings rates weights a month with $100 of income the
   * same as one with $10,000. The period rate must be recomputed from summed
   * components instead.
   */
  it('recomputes the savings rate for a period rather than averaging monthly rates', () => {
    const totals = sumCashflow([
      monthRow({ actual_income: 100, expense_outflows: 50, savings_rate: 0.5 }),
      monthRow({ month_start: '2026-08-01', actual_income: 10000, expense_outflows: 10000, savings_rate: 0 }),
    ]);

    // Naive average would be 25%. Correct answer: 50 / 10,100.
    expect(totals.actualIncome).toBe(10100);
    expect(totals.actualSpending).toBe(10050);
    expect(totals.savingsRate).toBeCloseTo(50 / 10100, 6);
    expect(totals.savingsRate).not.toBeCloseTo(0.25, 2);
  });

  it('returns zeroed totals for an empty period', () => {
    const totals = sumCashflow([]);
    expect(totals.actualSpending).toBe(0);
    expect(totals.actualIncome).toBe(0);
    expect(totals.savingsRate).toBeNull();
  });

  it('carries data-quality counts through the sum', () => {
    const totals = sumCashflow([
      monthRow({ unclassified_transaction_count: 3, foreign_currency_transaction_count: 2 }),
      monthRow({ month_start: '2026-08-01', unclassified_transaction_count: 1 }),
    ]);

    expect(totals.unclassifiedTransactionCount).toBe(4);
    expect(totals.foreignCurrencyTransactionCount).toBe(2);
  });
});

describe('calculateSavingsRate', () => {
  it('divides surplus by income', () => {
    expect(calculateSavingsRate(10450, 3619)).toBeCloseTo(0.3463, 4);
  });

  /**
   * Zero income has no savings rate. Returning 0 would claim the user saved
   * nothing; returning Infinity would render as garbage.
   */
  it('returns null when there is no income', () => {
    expect(calculateSavingsRate(0, 0)).toBeNull();
    expect(calculateSavingsRate(0, 500)).toBeNull();
  });

  it('returns null for negative income', () => {
    expect(calculateSavingsRate(-100, 50)).toBeNull();
  });

  it('returns a negative rate when spending exceeds income', () => {
    expect(calculateSavingsRate(1000, -500)).toBe(-0.5);
  });

  it('returns null for non-finite inputs', () => {
    expect(calculateSavingsRate(Number.NaN, 100)).toBeNull();
    expect(calculateSavingsRate(100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('buildSpendingExplanation', () => {
  it('produces a breakdown whose components sum to actual spending', () => {
    const explanation = buildSpendingExplanation(sumCashflow([JULY]));

    expect(explanation.balances).toBe(true);
    expect(explanation.actualSpending).toBe(6831);

    const deductions = explanation.lines
      .filter((line) => line.operator === 'SUBTRACT')
      .reduce((sum, line) => sum + line.amount, 0);

    // 15,842 − (3,210 + 4,712 + 1,089) = 6,831
    expect(deductions).toBe(15842 - 6831);
  });

  it('lists every exclusion category the specification requires', () => {
    const explanation = buildSpendingExplanation(sumCashflow([JULY]));
    const keys = explanation.lines.map((line) => line.key);

    expect(keys).toContain('gross_debits');
    expect(keys).toContain('internal_transfers');
    expect(keys).toContain('credit_card_payments');
    expect(keys).toContain('investment_transfers');
    expect(keys).toContain('refunds');
    expect(keys).toContain('actual_spending');
  });

  it('flags unclassified outflows for attention', () => {
    const withUnknown = buildSpendingExplanation(
      sumCashflow([monthRow({ gross_debits: 500, unclassified_outflows: 500 })]),
    );
    const line = withUnknown.lines.find((entry) => entry.key === 'unclassified_outflows');

    expect(line?.needsAttention).toBe(true);
    expect(line?.amount).toBe(500);
    // Unclassified money is excluded from spending, and the breakdown still balances.
    expect(withUnknown.actualSpending).toBe(0);
    expect(withUnknown.balances).toBe(true);
  });

  it('does not flag unclassified outflows when there are none', () => {
    const explanation = buildSpendingExplanation(sumCashflow([JULY]));
    const line = explanation.lines.find((entry) => entry.key === 'unclassified_outflows');
    expect(line?.needsAttention).toBe(false);
  });

  it('reports an imbalance rather than presenting an unexplainable figure', () => {
    // A hand-built total whose components do not add up: gross debits do not
    // account for the stated spending.
    const broken = buildSpendingExplanation({
      ...sumCashflow([JULY]),
      grossDebits: 1000,
      actualSpending: 6831,
    });

    expect(broken.balances).toBe(false);
  });
});
