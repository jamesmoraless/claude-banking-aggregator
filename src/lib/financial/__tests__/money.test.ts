import { describe, expect, it } from 'vitest';

import {
  amountsEqual,
  formatMoney,
  formatMoneyWithCurrencyCode,
  formatPercent,
  formatPercentagePoints,
  percentChange,
  roundToCents,
} from '../money';

describe('formatMoney', () => {
  it('formats an amount with two decimal places', () => {
    expect(formatMoney(6831, { currency: 'CAD' })).toBe('$6,831.00');
  });

  it('renders a missing value as an em dash rather than zero', () => {
    // A user with no connected accounts has an unknown balance, not $0.00.
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney(Number.NaN)).toBe('—');
  });

  it('renders a genuine zero as zero', () => {
    expect(formatMoney(0, { currency: 'CAD' })).toBe('$0.00');
  });

  it('uses a proper minus sign for negatives', () => {
    expect(formatMoney(-1200, { currency: 'CAD' })).toBe('−$1,200.00');
  });

  it('drops decimals in compact mode', () => {
    expect(formatMoney(6831.42, { currency: 'CAD', compact: true })).toBe('$6,831');
  });
});

describe('formatMoneyWithCurrencyCode', () => {
  /**
   * Mixed-currency lists are the reason this exists: an unlabelled "$5,000"
   * beside another "$5,000" invites adding them together when one is USD.
   */
  it('appends the ISO code when the currency differs from the base currency', () => {
    expect(formatMoneyWithCurrencyCode(5000, 'USD', 'CAD')).toBe('$5,000.00 USD');
  });

  it('omits the code when the currency matches the base currency', () => {
    expect(formatMoneyWithCurrencyCode(5000, 'CAD', 'CAD')).toBe('$5,000.00');
  });

  it('omits the code when the currency is unknown', () => {
    expect(formatMoneyWithCurrencyCode(5000, null, 'CAD')).toBe('$5,000.00');
  });
});

describe('formatPercent', () => {
  it('formats a ratio to one decimal place', () => {
    expect(formatPercent(0.3463)).toBe('34.6%');
  });

  it('renders an undefined rate as an em dash, not 0%', () => {
    expect(formatPercent(null)).toBe('—');
  });

  it('formats a negative rate with a minus sign', () => {
    expect(formatPercent(-0.12)).toBe('−12.0%');
  });
});

describe('formatPercentagePoints', () => {
  it('expresses a change in savings rate as points, not percent', () => {
    expect(formatPercentagePoints(0.067)).toBe('+6.7 pp');
    expect(formatPercentagePoints(-0.021)).toBe('−2.1 pp');
  });
});

describe('percentChange', () => {
  it('computes relative change', () => {
    expect(percentChange(110, 100)).toBeCloseTo(0.1, 6);
    expect(percentChange(90, 100)).toBeCloseTo(-0.1, 6);
  });

  it('returns null when the base is zero, rather than dividing by zero', () => {
    expect(percentChange(100, 0)).toBeNull();
  });

  it('uses the magnitude of the base so a negative baseline behaves sensibly', () => {
    expect(percentChange(-50, -100)).toBeCloseTo(0.5, 6);
  });
});

describe('amountsEqual', () => {
  it('treats amounts within half a cent as equal', () => {
    expect(amountsEqual(2000, 2000.001)).toBe(true);
  });

  it('treats a one-cent difference as different', () => {
    expect(amountsEqual(2000, 2000.01)).toBe(false);
  });

  it('absorbs floating point noise', () => {
    expect(amountsEqual(0.1 + 0.2, 0.3)).toBe(true);
  });
});

describe('roundToCents', () => {
  it('rounds to two decimal places', () => {
    expect(roundToCents(6831.004)).toBe(6831);
    expect(roundToCents(6831.005)).toBe(6831.01);
    expect(roundToCents(0.1 + 0.2)).toBe(0.3);
  });
});
