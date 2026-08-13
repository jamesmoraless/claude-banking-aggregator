import { describe, expect, it } from 'vitest';

import { daysBetween, detectTransfers } from '../transfer-detection.ts';
import type { AccountContext, ClassifiableTransaction, ExistingMatch } from '../types.ts';

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
const USD_ACCOUNT: AccountContext = {
  id: 'acct-usd',
  type: 'depository',
  subtype: 'checking',
  institutionId: 'inst-td',
  currency: 'USD',
};

const ACCOUNTS = [CHEQUING, SAVINGS, VISA, USD_ACCOUNT];

function tx(overrides: Partial<ClassifiableTransaction> & { id: string }): ClassifiableTransaction {
  return {
    accountId: CHEQUING.id,
    postedDate: '2026-08-07',
    name: 'TRANSFER',
    merchantName: null,
    amount: 2000,
    currency: 'CAD',
    pending: false,
    plaidCategoryPrimary: null,
    plaidCategoryDetailed: null,
    ...overrides,
  };
}

function run(
  transactions: ClassifiableTransaction[],
  existingMatches: ExistingMatch[] = [],
  candidateIds: string[] = [],
) {
  return detectTransfers({
    transactions,
    accounts: ACCOUNTS,
    existingMatches,
    transferCandidateIds: new Set(candidateIds),
  });
}

describe('detectTransfers — the canonical case', () => {
  const OUT = tx({
    id: 'out',
    accountId: CHEQUING.id,
    amount: 2000,
    postedDate: '2026-08-07',
    name: 'TRANSFER TO SAVINGS',
  });
  const IN = tx({
    id: 'in',
    accountId: SAVINGS.id,
    amount: -2000,
    postedDate: '2026-08-08',
    name: 'TRANSFER FROM CHEQUING',
  });

  it('matches an equal, opposite pair across two of the user’s accounts', () => {
    const matches = run([OUT, IN], [], ['out', 'in']);

    expect(matches).toHaveLength(1);
    expect(matches[0]!.outgoingTransactionId).toBe('out');
    expect(matches[0]!.incomingTransactionId).toBe('in');
    expect(matches[0]!.subtype).toBe('CHECKING_TO_SAVINGS');
    expect(matches[0]!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(matches[0]!.status).toBe('AUTO_MATCHED');
  });

  it('explains the score with named signals', () => {
    const [match] = run([OUT, IN], [], ['out', 'in']);
    const signals = match!.reasons.map((reason) => reason.signal);

    expect(signals).toContain('AMOUNT_EXACT');
    expect(signals).toContain('TIMING');
    expect(signals).toContain('PLAID_TRANSFER_BOTH');
    // Every signal carries a human-readable explanation for the review UI.
    for (const reason of match!.reasons) {
      expect(reason.detail.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic across runs', () => {
    const first = run([OUT, IN], [], ['out', 'in']);
    const second = run([IN, OUT], [], ['out', 'in']);
    expect(first).toEqual(second);
  });
});

describe('detectTransfers — disqualifiers', () => {
  it('never pairs two transactions on the same account', () => {
    const matches = run([
      tx({ id: 'out', accountId: CHEQUING.id, amount: 2000 }),
      tx({ id: 'in', accountId: CHEQUING.id, amount: -2000 }),
    ]);

    expect(matches).toHaveLength(0);
  });

  it('never pairs across currencies', () => {
    // $2,000 CAD and $2,000 USD are not the same movement of money, and we
    // have no FX rate to prove otherwise.
    const matches = run([
      tx({ id: 'out', accountId: CHEQUING.id, amount: 2000, currency: 'CAD' }),
      tx({ id: 'in', accountId: USD_ACCOUNT.id, amount: -2000, currency: 'USD' }),
    ]);

    expect(matches).toHaveLength(0);
  });

  it('rejects amounts that differ by more than 2%', () => {
    const matches = run([
      tx({ id: 'out', accountId: CHEQUING.id, amount: 2000 }),
      tx({ id: 'in', accountId: SAVINGS.id, amount: -1900 }),
    ]);

    expect(matches).toHaveLength(0);
  });

  it('rejects legs further apart than the window', () => {
    const matches = run([
      tx({ id: 'out', accountId: CHEQUING.id, amount: 2000, postedDate: '2026-08-01' }),
      tx({ id: 'in', accountId: SAVINGS.id, amount: -2000, postedDate: '2026-08-20' }),
    ]);

    expect(matches).toHaveLength(0);
  });

  it('ignores pending transactions', () => {
    // A pending row is replaced by a posted one; matching it produces a pair
    // that disappears on the next sync.
    const matches = run([
      tx({ id: 'out', accountId: CHEQUING.id, amount: 2000, pending: true }),
      tx({ id: 'in', accountId: SAVINGS.id, amount: -2000 }),
    ]);

    expect(matches).toHaveLength(0);
  });

  it('ignores transactions on accounts it was not given', () => {
    const matches = run([
      tx({ id: 'out', accountId: 'acct-unknown', amount: 2000 }),
      tx({ id: 'in', accountId: SAVINGS.id, amount: -2000 }),
    ]);

    expect(matches).toHaveLength(0);
  });
});

describe('detectTransfers — confidence thresholds', () => {
  /**
   * Middling evidence must NOT silently alter spending. Exact amounts but
   * three days apart, with only one leg flagged by the bank, is suggestive
   * rather than conclusive — so it goes to review and keeps counting as
   * spending until a human agrees.
   */
  it('sends a moderately-evidenced pair to review rather than matching it', () => {
    const matches = run(
      [
        tx({
          id: 'out',
          accountId: CHEQUING.id,
          amount: 2000,
          postedDate: '2026-08-04',
          name: 'WITHDRAWAL 4821',
        }),
        tx({
          id: 'in',
          accountId: SAVINGS.id,
          amount: -2000,
          postedDate: '2026-08-07',
          name: 'DEPOSIT 9930',
        }),
      ],
      [],
      ['out'],
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]!.status).toBe('NEEDS_REVIEW');
    expect(matches[0]!.confidence).toBeGreaterThanOrEqual(0.55);
    expect(matches[0]!.confidence).toBeLessThan(0.9);
  });

  it('proposes nothing when the evidence is too thin', () => {
    // Amounts differ, six days apart, nothing flagged, descriptions unrelated.
    const matches = run([
      tx({
        id: 'out',
        accountId: CHEQUING.id,
        amount: 1000,
        postedDate: '2026-08-01',
        name: 'WITHDRAWAL 4821',
      }),
      tx({
        id: 'in',
        accountId: SAVINGS.id,
        amount: -1005,
        postedDate: '2026-08-07',
        name: 'DEPOSIT 9930',
      }),
    ]);

    expect(matches).toHaveLength(0);
  });

  it('honours a caller-supplied threshold', () => {
    const strict = detectTransfers({
      transactions: [
        tx({ id: 'out', accountId: CHEQUING.id, amount: 2000, postedDate: '2026-08-04' }),
        tx({ id: 'in', accountId: SAVINGS.id, amount: -2000, postedDate: '2026-08-07' }),
      ],
      accounts: ACCOUNTS,
      existingMatches: [],
      options: { reviewThreshold: 0.95 },
    });

    expect(strict).toHaveLength(0);
  });
});

describe('detectTransfers — credit card payments', () => {
  it('matches a payment from chequing into a connected card', () => {
    const matches = run(
      [
        tx({
          id: 'out',
          accountId: CHEQUING.id,
          amount: 4712,
          name: 'RBC VISA PAYMENT',
          postedDate: '2026-07-15',
        }),
        tx({
          id: 'in',
          accountId: VISA.id,
          amount: -4712,
          name: 'PAYMENT - THANK YOU',
          postedDate: '2026-07-15',
        }),
      ],
      [],
      ['out', 'in'],
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]!.subtype).toBe('CREDIT_CARD_PAYMENT');
    expect(matches[0]!.reasons.map((reason) => reason.signal)).toContain('CREDIT_CARD_PAYMENT');
  });

  /**
   * The guard the specification calls out explicitly: a payment to a card that
   * is NOT connected has no counterpart, so no match is produced, so the
   * payment stays in spending. Its purchases were never imported, so the
   * payment is the only record of that money leaving.
   */
  it('produces no match when the card is not connected', () => {
    const matches = run([
      tx({
        id: 'out',
        accountId: CHEQUING.id,
        amount: 4712,
        name: 'AMEX PAYMENT',
        postedDate: '2026-07-15',
      }),
    ]);

    expect(matches).toHaveLength(0);
  });

  it('does not match a payment merely because the description says PAYMENT', () => {
    // A mortgage payment and an unrelated inflow of a different size.
    const matches = run([
      tx({
        id: 'out',
        accountId: CHEQUING.id,
        amount: 2400,
        name: 'MORTGAGE PAYMENT',
        postedDate: '2026-07-01',
      }),
      tx({
        id: 'in',
        accountId: SAVINGS.id,
        amount: -800,
        name: 'PAYMENT RECEIVED',
        postedDate: '2026-07-02',
      }),
    ]);

    expect(matches).toHaveLength(0);
  });
});

describe('detectTransfers — idempotency', () => {
  const OUT = tx({ id: 'out', accountId: CHEQUING.id, amount: 2000 });
  const IN = tx({ id: 'in', accountId: SAVINGS.id, amount: -2000, postedDate: '2026-08-08' });

  it('does not re-propose a pair that already exists', () => {
    const matches = run([OUT, IN], [
      { outgoingTransactionId: 'out', incomingTransactionId: 'in', status: 'AUTO_MATCHED' },
    ]);

    expect(matches).toHaveLength(0);
  });

  it('does not re-propose a pair the user rejected', () => {
    // Retaining rejections is what makes a rejection stick across syncs.
    const matches = run([OUT, IN], [
      { outgoingTransactionId: 'out', incomingTransactionId: 'in', status: 'USER_REJECTED' },
    ]);

    expect(matches).toHaveLength(0);
  });

  it('leaves a transaction already in a live match alone', () => {
    const other = tx({ id: 'in-2', accountId: SAVINGS.id, amount: -2000, postedDate: '2026-08-08' });

    const matches = run([OUT, IN, other], [
      { outgoingTransactionId: 'out', incomingTransactionId: 'in', status: 'USER_CONFIRMED' },
    ]);

    expect(matches).toHaveLength(0);
  });

  it('allows a rejected transaction to be paired with a different counterpart', () => {
    const better = tx({ id: 'in-2', accountId: SAVINGS.id, amount: -2000, postedDate: '2026-08-07' });

    const matches = run(
      [OUT, IN, better],
      [{ outgoingTransactionId: 'out', incomingTransactionId: 'in', status: 'USER_REJECTED' }],
      ['out', 'in-2'],
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]!.incomingTransactionId).toBe('in-2');
  });
});

describe('detectTransfers — competing candidates', () => {
  it('assigns each transaction to at most one match, best first', () => {
    // Two $500 transfers on the same day; each outflow must claim one inflow.
    const matches = run(
      [
        tx({ id: 'out-a', accountId: CHEQUING.id, amount: 500, postedDate: '2026-08-07' }),
        tx({ id: 'out-b', accountId: CHEQUING.id, amount: 500, postedDate: '2026-08-09' }),
        tx({ id: 'in-a', accountId: SAVINGS.id, amount: -500, postedDate: '2026-08-07' }),
        tx({ id: 'in-b', accountId: SAVINGS.id, amount: -500, postedDate: '2026-08-09' }),
      ],
      [],
      ['out-a', 'out-b', 'in-a', 'in-b'],
    );

    expect(matches).toHaveLength(2);

    const outgoingIds = matches.map((match) => match.outgoingTransactionId);
    const incomingIds = matches.map((match) => match.incomingTransactionId);
    expect(new Set(outgoingIds).size).toBe(2);
    expect(new Set(incomingIds).size).toBe(2);

    // Same-day pairs score higher than two-day-apart ones, so they win.
    const pairs = matches.map((m) => `${m.outgoingTransactionId}->${m.incomingTransactionId}`).sort();
    expect(pairs).toEqual(['out-a->in-a', 'out-b->in-b']);
  });
});

describe('daysBetween', () => {
  it('counts whole days regardless of order', () => {
    expect(daysBetween('2026-08-07', '2026-08-08')).toBe(1);
    expect(daysBetween('2026-08-08', '2026-08-07')).toBe(1);
    expect(daysBetween('2026-08-07', '2026-08-07')).toBe(0);
  });

  it('spans month boundaries', () => {
    expect(daysBetween('2026-07-31', '2026-08-02')).toBe(2);
  });

  it('returns null for an unparseable date', () => {
    expect(daysBetween('not-a-date', '2026-08-07')).toBeNull();
  });
});
