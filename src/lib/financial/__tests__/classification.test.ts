import { describe, expect, it } from 'vitest';

import { inferTransferSubtype, resolveClassification } from '../classification';

/**
 * Classification precedence: user override → system classification → UNKNOWN.
 *
 * These tests mirror the effective_type expression in the
 * transactions_classified SQL view. If the two ever diverge, a figure shown in
 * a transaction row would disagree with the total it contributes to.
 */
describe('resolveClassification', () => {
  it('prefers a user override over the system classification', () => {
    const result = resolveClassification({
      userType: 'TRANSFER',
      userTransferSubtype: 'CHECKING_TO_SAVINGS',
      systemType: 'EXPENSE',
      systemTransferSubtype: null,
    });

    expect(result.type).toBe('TRANSFER');
    expect(result.transferSubtype).toBe('CHECKING_TO_SAVINGS');
    expect(result.isUserOverridden).toBe(true);
    expect(result.source).toBe('USER');
  });

  it('falls back to the system classification when there is no override', () => {
    const result = resolveClassification({
      userType: null,
      userTransferSubtype: null,
      systemType: 'INCOME',
      systemTransferSubtype: null,
    });

    expect(result.type).toBe('INCOME');
    expect(result.isUserOverridden).toBe(false);
    expect(result.source).toBe('SYSTEM');
  });

  it('reports UNKNOWN when nothing has classified the transaction', () => {
    const result = resolveClassification({
      userType: null,
      userTransferSubtype: null,
      systemType: 'UNKNOWN',
      systemTransferSubtype: null,
    });

    expect(result.type).toBe('UNKNOWN');
    expect(result.isUserOverridden).toBe(false);
  });

  it('respects an override that deliberately marks a transaction UNKNOWN', () => {
    const result = resolveClassification({
      userType: 'UNKNOWN',
      userTransferSubtype: null,
      systemType: 'EXPENSE',
      systemTransferSubtype: null,
    });

    expect(result.type).toBe('UNKNOWN');
    expect(result.isUserOverridden).toBe(true);
  });

  /**
   * A leftover system subtype must not attach itself to a user decision. If the
   * user says "this is an expense", the fact that our classifier previously
   * guessed CREDIT_CARD_PAYMENT is irrelevant and must not leak through.
   */
  it('drops the system subtype when the user reclassifies away from TRANSFER', () => {
    const result = resolveClassification({
      userType: 'EXPENSE',
      userTransferSubtype: null,
      systemType: 'TRANSFER',
      systemTransferSubtype: 'CREDIT_CARD_PAYMENT',
    });

    expect(result.type).toBe('EXPENSE');
    expect(result.transferSubtype).toBeNull();
  });

  it('drops a subtype on a system classification that is not a transfer', () => {
    const result = resolveClassification({
      userType: null,
      userTransferSubtype: null,
      systemType: 'EXPENSE',
      systemTransferSubtype: 'CREDIT_CARD_PAYMENT',
    });

    expect(result.transferSubtype).toBeNull();
  });

  it('treats undefined the same as null', () => {
    const result = resolveClassification({
      userType: undefined,
      userTransferSubtype: undefined,
      systemType: 'REFUND',
      systemTransferSubtype: undefined,
    });

    expect(result.type).toBe('REFUND');
  });
});

describe('inferTransferSubtype', () => {
  it('identifies a credit card payment by the destination account', () => {
    expect(inferTransferSubtype('depository', 'checking', 'credit', 'credit card')).toBe(
      'CREDIT_CARD_PAYMENT',
    );
  });

  it('identifies an investment contribution', () => {
    expect(inferTransferSubtype('depository', 'checking', 'investment', 'tfsa')).toBe(
      'INVESTMENT_TRANSFER',
    );
    expect(inferTransferSubtype('depository', 'checking', 'brokerage', null)).toBe(
      'INVESTMENT_TRANSFER',
    );
  });

  it('distinguishes the direction between chequing and savings', () => {
    expect(inferTransferSubtype('depository', 'checking', 'depository', 'savings')).toBe(
      'CHECKING_TO_SAVINGS',
    );
    expect(inferTransferSubtype('depository', 'savings', 'depository', 'checking')).toBe(
      'SAVINGS_TO_CHECKING',
    );
  });

  it('accepts the Canadian spelling of chequing', () => {
    expect(inferTransferSubtype('depository', 'chequing', 'depository', 'savings')).toBe(
      'CHECKING_TO_SAVINGS',
    );
  });

  it('falls back to a generic account-to-account transfer', () => {
    expect(inferTransferSubtype('depository', 'checking', 'depository', 'checking')).toBe(
      'ACCOUNT_TO_ACCOUNT',
    );
  });
});
