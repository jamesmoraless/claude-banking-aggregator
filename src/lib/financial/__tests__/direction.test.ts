import { describe, expect, it } from 'vitest';

import {
  absoluteAmount,
  areOpposingDirections,
  displaySignedAmount,
  interpretPlaidAmount,
  isInflow,
  isOutflow,
} from '../direction';

/**
 * Plaid's sign convention is the single easiest thing to get backwards in this
 * codebase, and getting it backwards silently turns income into spending. These
 * tests pin every case named in the specification.
 */
describe('interpretPlaidAmount', () => {
  describe('chequing account', () => {
    it('treats a card purchase as an outflow', () => {
      const result = interpretPlaidAmount(82.14);
      expect(result.direction).toBe('OUTFLOW');
      expect(result.absoluteAmount).toBe(82.14);
    });

    it('treats a direct deposit as an inflow', () => {
      const result = interpretPlaidAmount(-4200);
      expect(result.direction).toBe('INFLOW');
      expect(result.absoluteAmount).toBe(4200);
    });

    it('treats a payment to a credit card as an outflow from chequing', () => {
      expect(interpretPlaidAmount(500).direction).toBe('OUTFLOW');
    });
  });

  describe('credit card account', () => {
    it('treats a purchase as an outflow, because the balance owed grows', () => {
      expect(interpretPlaidAmount(82.14).direction).toBe('OUTFLOW');
    });

    it('treats a payment received as an inflow, because the balance owed shrinks', () => {
      const result = interpretPlaidAmount(-500);
      expect(result.direction).toBe('INFLOW');
      expect(result.absoluteAmount).toBe(500);
    });

    it('treats a merchant refund as an inflow', () => {
      expect(interpretPlaidAmount(-24.99).direction).toBe('INFLOW');
    });
  });

  it('preserves the raw amount untouched', () => {
    expect(interpretPlaidAmount(-4200).rawAmount).toBe(-4200);
    expect(interpretPlaidAmount(82.14).rawAmount).toBe(82.14);
  });

  it('treats zero as an outflow of zero magnitude', () => {
    const result = interpretPlaidAmount(0);
    expect(result.direction).toBe('OUTFLOW');
    expect(result.absoluteAmount).toBe(0);
  });

  it('rejects values that are not finite numbers', () => {
    expect(() => interpretPlaidAmount(Number.NaN)).toThrow(TypeError);
    expect(() => interpretPlaidAmount(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('direction predicates', () => {
  it('classifies outflows and inflows consistently', () => {
    expect(isOutflow(100)).toBe(true);
    expect(isInflow(100)).toBe(false);
    expect(isOutflow(-100)).toBe(false);
    expect(isInflow(-100)).toBe(true);
  });

  it('returns magnitudes without sign', () => {
    expect(absoluteAmount(-4200)).toBe(4200);
    expect(absoluteAmount(4200)).toBe(4200);
  });
});

describe('displaySignedAmount', () => {
  /**
   * Display flips Plaid's convention: people read "-$82.14" as money spent.
   * This must never feed back into a calculation.
   */
  it('shows money leaving an account as negative', () => {
    expect(displaySignedAmount(82.14)).toBe(-82.14);
  });

  it('shows money arriving as positive', () => {
    expect(displaySignedAmount(-4200)).toBe(4200);
  });
});

describe('areOpposingDirections', () => {
  it('detects the two legs of a transfer', () => {
    // $2,000 leaves chequing (+2000) and arrives in savings (-2000).
    expect(areOpposingDirections(2000, -2000)).toBe(true);
  });

  it('rejects two outflows', () => {
    expect(areOpposingDirections(2000, 2000)).toBe(false);
  });

  it('rejects two inflows', () => {
    expect(areOpposingDirections(-2000, -2000)).toBe(false);
  });
});
