import { describe, expect, it } from 'vitest';

import {
  classifyTransaction,
  defaultIncludeInCash,
  resolveMatchedSubtype,
  ruleMatches,
  sortRules,
} from '../classification.ts';
import type { AccountContext, ClassifiableTransaction, TransactionRule } from '../types.ts';

const CHEQUING: AccountContext = {
  id: 'acct-chequing',
  type: 'depository',
  subtype: 'checking',
  institutionId: 'inst-td',
  currency: 'CAD',
};

const SAVINGS: AccountContext = {
  id: 'acct-savings',
  type: 'depository',
  subtype: 'savings',
  institutionId: 'inst-td',
  currency: 'CAD',
};

const VISA: AccountContext = {
  id: 'acct-visa',
  type: 'credit',
  subtype: 'credit card',
  institutionId: 'inst-rbc',
  currency: 'CAD',
};

const INVESTMENT: AccountContext = {
  id: 'acct-wealthsimple',
  type: 'investment',
  subtype: 'tfsa',
  institutionId: 'inst-ws',
  currency: 'CAD',
};

function tx(overrides: Partial<ClassifiableTransaction> = {}): ClassifiableTransaction {
  return {
    id: 'tx-1',
    accountId: CHEQUING.id,
    postedDate: '2026-07-15',
    name: 'TEST TRANSACTION',
    merchantName: null,
    amount: 100,
    currency: 'CAD',
    pending: false,
    plaidCategoryPrimary: null,
    plaidCategoryDetailed: null,
    ...overrides,
  };
}

function rule(overrides: Partial<TransactionRule> = {}): TransactionRule {
  return {
    id: 'rule-1',
    name: 'Test rule',
    enabled: true,
    priority: 100,
    createdAt: '2026-01-01T00:00:00Z',
    matchField: 'MERCHANT_OR_NAME',
    matchOperator: 'CONTAINS',
    matchValue: 'PAYROLL',
    minAmount: null,
    maxAmount: null,
    accountId: null,
    resultType: 'INCOME',
    resultTransferSubtype: null,
    ...overrides,
  };
}

describe('classifyTransaction — Plaid categories', () => {
  it('classifies a payroll deposit as income', () => {
    const result = classifyTransaction(
      tx({ amount: -4200, plaidCategoryPrimary: 'INCOME', plaidCategoryDetailed: 'INCOME_WAGES' }),
      CHEQUING,
    );

    expect(result.type).toBe('INCOME');
    expect(result.isTransferCandidate).toBe(false);
  });

  it('classifies a purchase as an expense', () => {
    const result = classifyTransaction(
      tx({
        amount: 82.14,
        plaidCategoryPrimary: 'FOOD_AND_DRINK',
        plaidCategoryDetailed: 'FOOD_AND_DRINK_GROCERIES',
      }),
      CHEQUING,
    );

    expect(result.type).toBe('EXPENSE');
  });

  it('treats money coming back under a spending category as a refund', () => {
    const result = classifyTransaction(
      tx({
        amount: -24.99,
        plaidCategoryPrimary: 'GENERAL_MERCHANDISE',
        plaidCategoryDetailed: 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES',
      }),
      CHEQUING,
    );

    // Refunds reduce spending; they must not inflate income.
    expect(result.type).toBe('REFUND');
  });

  it('treats an outgoing income transaction as an adjustment, not spending', () => {
    const result = classifyTransaction(
      tx({ amount: 500, plaidCategoryPrimary: 'INCOME', plaidCategoryDetailed: 'INCOME_WAGES' }),
      CHEQUING,
    );

    expect(result.type).toBe('ADJUSTMENT');
  });

  it('falls back to expense for an uncategorised outflow', () => {
    const result = classifyTransaction(tx({ amount: 50 }), CHEQUING);
    expect(result.type).toBe('EXPENSE');
    expect(result.reason).toContain('fallback');
  });
});

/**
 * The behaviour that separates this app from a naive aggregator: a Plaid
 * transfer label is a hypothesis, not a verdict.
 */
describe('classifyTransaction — unmatched transfer candidates', () => {
  it('still counts an unmatched outgoing transfer as spending', () => {
    const result = classifyTransaction(
      tx({
        amount: 2000,
        plaidCategoryPrimary: 'TRANSFER_OUT',
        plaidCategoryDetailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
      }),
      CHEQUING,
    );

    // An e-transfer to a friend also lands in TRANSFER_OUT. Excluding it here
    // would hide real money leaving the account.
    expect(result.type).toBe('EXPENSE');
    expect(result.isTransferCandidate).toBe(true);
    expect(result.candidateSubtype).toBe('ACCOUNT_TO_ACCOUNT');
  });

  it('does not count an unmatched incoming transfer as income', () => {
    const result = classifyTransaction(
      tx({
        amount: -2000,
        plaidCategoryPrimary: 'TRANSFER_IN',
        plaidCategoryDetailed: 'TRANSFER_IN_ACCOUNT_TRANSFER',
      }),
      SAVINGS,
    );

    // UNKNOWN keeps it out of income and puts it in the review queue.
    expect(result.type).toBe('UNKNOWN');
    expect(result.isTransferCandidate).toBe(true);
  });

  it('counts an unmatched credit card payment as spending', () => {
    const result = classifyTransaction(
      tx({
        amount: 500,
        name: 'PAYMENT - THANK YOU',
        plaidCategoryPrimary: 'LOAN_PAYMENTS',
        plaidCategoryDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
      }),
      CHEQUING,
    );

    // If the card is not connected, its purchases were never counted, so the
    // payment is the only spending record there is.
    expect(result.type).toBe('EXPENSE');
    expect(result.isTransferCandidate).toBe(true);
    expect(result.candidateSubtype).toBe('CREDIT_CARD_PAYMENT');
  });

  it('recognises an investment contribution as a candidate', () => {
    const result = classifyTransaction(
      tx({
        amount: 1000,
        plaidCategoryPrimary: 'TRANSFER_OUT',
        plaidCategoryDetailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
      }),
      CHEQUING,
    );

    expect(result.candidateSubtype).toBe('INVESTMENT_TRANSFER');
  });

  it('infers savings direction from the detailed category', () => {
    expect(
      classifyTransaction(
        tx({
          amount: 500,
          plaidCategoryPrimary: 'TRANSFER_OUT',
          plaidCategoryDetailed: 'TRANSFER_OUT_SAVINGS',
        }),
        CHEQUING,
      ).candidateSubtype,
    ).toBe('CHECKING_TO_SAVINGS');

    expect(
      classifyTransaction(
        tx({
          amount: -500,
          plaidCategoryPrimary: 'TRANSFER_IN',
          plaidCategoryDetailed: 'TRANSFER_IN_SAVINGS',
        }),
        CHEQUING,
      ).candidateSubtype,
    ).toBe('SAVINGS_TO_CHECKING');
  });

  it('does not treat a mortgage payment as a credit card payment', () => {
    const result = classifyTransaction(
      tx({
        amount: 2400,
        name: 'MORTGAGE PAYMENT',
        plaidCategoryPrimary: 'LOAN_PAYMENTS',
        plaidCategoryDetailed: 'LOAN_PAYMENTS_MORTGAGE_PAYMENT',
      }),
      CHEQUING,
    );

    expect(result.type).toBe('EXPENSE');
    expect(result.isTransferCandidate).toBe(false);
  });
});

describe('classifyTransaction — user rules', () => {
  it('applies a matching rule ahead of the Plaid category', () => {
    const result = classifyTransaction(
      tx({
        name: 'ACME CORP PAYROLL DEP',
        amount: -4200,
        plaidCategoryPrimary: 'TRANSFER_IN',
        plaidCategoryDetailed: 'TRANSFER_IN_DEPOSIT',
      }),
      CHEQUING,
      [rule()],
    );

    expect(result.type).toBe('INCOME');
    expect(result.ruleId).toBe('rule-1');
    expect(result.reason).toContain('rule:rule-1');
  });

  it('applies the lowest-priority-number rule when several match', () => {
    const result = classifyTransaction(
      tx({ name: 'WEALTHSIMPLE TRANSFER', amount: 1000 }),
      CHEQUING,
      [
        rule({ id: 'low', priority: 200, matchValue: 'WEALTHSIMPLE', resultType: 'EXPENSE' }),
        rule({
          id: 'high',
          priority: 10,
          matchValue: 'WEALTHSIMPLE',
          resultType: 'TRANSFER',
          resultTransferSubtype: 'INVESTMENT_TRANSFER',
        }),
      ],
    );

    expect(result.ruleId).toBe('high');
    expect(result.type).toBe('TRANSFER');
    expect(result.transferSubtype).toBe('INVESTMENT_TRANSFER');
  });

  it('breaks priority ties deterministically by creation time', () => {
    const ordered = sortRules([
      rule({ id: 'newer', priority: 100, createdAt: '2026-06-01T00:00:00Z' }),
      rule({ id: 'older', priority: 100, createdAt: '2026-01-01T00:00:00Z' }),
    ]);

    expect(ordered.map((entry) => entry.id)).toEqual(['older', 'newer']);
  });

  it('ignores disabled rules', () => {
    const result = classifyTransaction(
      tx({ name: 'ACME PAYROLL', amount: -4200 }),
      CHEQUING,
      [rule({ enabled: false })],
    );

    expect(result.ruleId).toBeNull();
  });
});

describe('ruleMatches', () => {
  it('supports each operator', () => {
    const transaction = tx({ name: 'METRO GROCERY STORE', merchantName: 'Metro' });

    expect(ruleMatches(rule({ matchOperator: 'CONTAINS', matchValue: 'grocery' }), transaction)).toBe(true);
    expect(ruleMatches(rule({ matchOperator: 'STARTS_WITH', matchValue: 'metro' }), transaction)).toBe(true);
    expect(ruleMatches(rule({ matchOperator: 'ENDS_WITH', matchValue: 'store' }), transaction)).toBe(true);
    expect(
      ruleMatches(
        rule({ matchField: 'MERCHANT_NAME', matchOperator: 'EQUALS', matchValue: 'metro' }),
        transaction,
      ),
    ).toBe(true);
  });

  it('is case insensitive', () => {
    expect(ruleMatches(rule({ matchValue: 'payroll' }), tx({ name: 'ACME PAYROLL' }))).toBe(true);
  });

  it('respects amount narrowing using magnitude, not sign', () => {
    const inflow = tx({ name: 'BIG DEPOSIT', amount: -600 });
    expect(ruleMatches(rule({ matchValue: 'DEPOSIT', minAmount: 500 }), inflow)).toBe(true);
    expect(ruleMatches(rule({ matchValue: 'DEPOSIT', minAmount: 700 }), inflow)).toBe(false);
    expect(ruleMatches(rule({ matchValue: 'DEPOSIT', maxAmount: 500 }), inflow)).toBe(false);
  });

  it('respects account narrowing', () => {
    const transaction = tx({ name: 'PAYROLL', accountId: 'acct-chequing' });
    expect(ruleMatches(rule({ matchValue: 'PAYROLL', accountId: 'acct-chequing' }), transaction)).toBe(true);
    expect(ruleMatches(rule({ matchValue: 'PAYROLL', accountId: 'acct-other' }), transaction)).toBe(false);
  });

  it('does not match when the field is absent', () => {
    expect(
      ruleMatches(
        rule({ matchField: 'MERCHANT_NAME', matchValue: 'metro' }),
        tx({ merchantName: null }),
      ),
    ).toBe(false);
  });

  it('does not match on an empty pattern', () => {
    expect(ruleMatches(rule({ matchValue: '   ' }), tx({ name: 'ANYTHING' }))).toBe(false);
  });
});

describe('resolveMatchedSubtype', () => {
  it('uses the destination account to decide the kind of movement', () => {
    expect(resolveMatchedSubtype(CHEQUING, VISA)).toBe('CREDIT_CARD_PAYMENT');
    expect(resolveMatchedSubtype(CHEQUING, INVESTMENT)).toBe('INVESTMENT_TRANSFER');
    expect(resolveMatchedSubtype(CHEQUING, SAVINGS)).toBe('CHECKING_TO_SAVINGS');
    expect(resolveMatchedSubtype(SAVINGS, CHEQUING)).toBe('SAVINGS_TO_CHECKING');
  });

  it('falls back to a generic account transfer', () => {
    const other: AccountContext = { ...CHEQUING, id: 'acct-other' };
    expect(resolveMatchedSubtype(CHEQUING, other)).toBe('ACCOUNT_TO_ACCOUNT');
  });
});

describe('defaultIncludeInCash', () => {
  it('counts depository accounts as cash by default', () => {
    expect(defaultIncludeInCash(CHEQUING)).toBe(true);
    expect(defaultIncludeInCash(SAVINGS)).toBe(true);
  });

  it('does not count credit or investment accounts as cash', () => {
    expect(defaultIncludeInCash(VISA)).toBe(false);
    expect(defaultIncludeInCash(INVESTMENT)).toBe(false);
  });
});
