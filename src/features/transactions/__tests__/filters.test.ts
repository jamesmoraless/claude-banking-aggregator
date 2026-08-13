import { describe, expect, it } from 'vitest';

import {
  filtersFromSearchParams,
  isFiltered,
  searchParamsFromFilters,
} from '../transactions-page';

const DEFAULT_RANGE = { from: '2026-06-01', to: '2026-08-31' };

/**
 * Filter state lives in the URL so that a figure in the Cash Flow calculation
 * panel can link straight to the transactions behind it. These tests pin the
 * round trip, because a mismatch would send the user to a view that does not
 * show what they clicked.
 */
describe('filtersFromSearchParams', () => {
  it('falls back to the default range when none is given', () => {
    const filters = filtersFromSearchParams(new URLSearchParams(), DEFAULT_RANGE);
    expect(filters.from).toBe(DEFAULT_RANGE.from);
    expect(filters.to).toBe(DEFAULT_RANGE.to);
  });

  it('reads a drill-down link from the calculation panel', () => {
    const filters = filtersFromSearchParams(
      new URLSearchParams('from=2026-07-01&to=2026-07-31&bucket=CREDIT_CARD_PAYMENT'),
      DEFAULT_RANGE,
    );

    expect(filters.from).toBe('2026-07-01');
    expect(filters.to).toBe('2026-07-31');
    expect(filters.exclusionBucket).toBe('CREDIT_CARD_PAYMENT');
  });

  it('parses comma-separated lists', () => {
    const filters = filtersFromSearchParams(
      new URLSearchParams('accounts=a1,a2&types=INCOME,EXPENSE'),
      DEFAULT_RANGE,
    );

    expect(filters.accountIds).toEqual(['a1', 'a2']);
    expect(filters.economicTypes).toEqual(['INCOME', 'EXPENSE']);
  });

  it('parses numeric amounts and ignores unparseable ones', () => {
    expect(filtersFromSearchParams(new URLSearchParams('min=50.5'), DEFAULT_RANGE).minAmount).toBe(
      50.5,
    );
    expect(
      filtersFromSearchParams(new URLSearchParams('min=abc'), DEFAULT_RANGE).minAmount,
    ).toBeUndefined();
    expect(
      filtersFromSearchParams(new URLSearchParams('min='), DEFAULT_RANGE).minAmount,
    ).toBeUndefined();
  });

  it('reads the review flag used by the Overview link', () => {
    expect(filtersFromSearchParams(new URLSearchParams('review=1'), DEFAULT_RANGE).needsReviewOnly)
      .toBe(true);
    expect(filtersFromSearchParams(new URLSearchParams(), DEFAULT_RANGE).needsReviewOnly).toBe(false);
  });
});

describe('searchParamsFromFilters', () => {
  it('omits values equal to the defaults, keeping URLs short', () => {
    const params = searchParamsFromFilters(
      { from: DEFAULT_RANGE.from, to: DEFAULT_RANGE.to, status: 'ALL', transferStatus: 'ALL' },
      DEFAULT_RANGE,
    );

    expect(params).toEqual({});
  });

  it('round-trips a fully populated filter set', () => {
    const original = {
      from: '2026-07-01',
      to: '2026-07-31',
      accountIds: ['a1'],
      institutionIds: ['i1'],
      categories: ['FOOD_AND_DRINK'],
      economicTypes: ['EXPENSE' as const],
      search: 'metro',
      minAmount: 10,
      maxAmount: 500,
      status: 'POSTED' as const,
      transferStatus: 'EXCLUDING_TRANSFERS' as const,
      needsReviewOnly: true,
      exclusionBucket: 'INTERNAL_TRANSFER',
    };

    const params = new URLSearchParams(searchParamsFromFilters(original, DEFAULT_RANGE));
    const restored = filtersFromSearchParams(params, DEFAULT_RANGE);

    expect(restored).toMatchObject(original);
  });

  it('trims whitespace from the search term', () => {
    const params = searchParamsFromFilters({ search: '  metro  ' }, DEFAULT_RANGE);
    expect(params.q).toBe('metro');
  });

  it('omits a blank search term entirely', () => {
    expect(searchParamsFromFilters({ search: '   ' }, DEFAULT_RANGE)).toEqual({});
  });
});

describe('isFiltered', () => {
  /**
   * Selecting a transaction opens a drawer; it is not a filter. Treating it as
   * one would show "no transactions match these filters" with a Clear button
   * that does nothing useful.
   */
  it('does not treat an open transaction drawer as a filter', () => {
    expect(isFiltered(new URLSearchParams('transaction=abc'))).toBe(false);
  });

  it('detects a real filter', () => {
    expect(isFiltered(new URLSearchParams('q=metro'))).toBe(true);
    expect(isFiltered(new URLSearchParams('transaction=abc&q=metro'))).toBe(true);
  });

  it('reports no filters for an empty query string', () => {
    expect(isFiltered(new URLSearchParams())).toBe(false);
  });
});
