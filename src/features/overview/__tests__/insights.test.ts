import { describe, expect, it } from 'vitest';

import { sumCashflow } from '@/lib/financial/cashflow';

import { buildInsights, formatCategoryName } from '../insights-card';

function totals(overrides: Partial<ReturnType<typeof sumCashflow>> = {}) {
  return { ...sumCashflow([]), ...overrides };
}

/**
 * Insights must be derived from the user's own data and nothing else. The
 * specification explicitly rules out peer comparisons — Cash Atlas has no
 * cohort, so "you're in the top 25% of users" would be a fabricated financial
 * claim.
 */
describe('buildInsights', () => {
  it('produces nothing when there is no data', () => {
    expect(
      buildInsights({
        totals: totals(),
        reviewCount: 0,
        currentCategories: [],
        previousCategories: [],
      }),
    ).toEqual([]);
  });

  it('puts actionable review items first', () => {
    const insights = buildInsights({
      totals: totals({ actualIncome: 10450, surplus: 3619, savingsRate: 0.3463 }),
      reviewCount: 3,
      currentCategories: [],
      previousCategories: [],
    });

    expect(insights[0]?.id).toBe('transfer-review');
    expect(insights[0]?.title).toContain('3 possible transfers');
    expect(insights[0]?.to).toBe('/transactions/transfers');
  });

  it('surfaces unclassified transactions with the amount at stake', () => {
    const insights = buildInsights({
      totals: totals({ unclassifiedTransactionCount: 2, unclassifiedOutflows: 340 }),
      reviewCount: 0,
      currentCategories: [],
      previousCategories: [],
    });

    const insight = insights.find((entry) => entry.id === 'unclassified');
    expect(insight?.title).toContain('2 transactions');
    expect(insight?.description).toContain('$340.00');
  });

  it('reports the largest category movement against the previous period', () => {
    const insights = buildInsights({
      totals: totals(),
      reviewCount: 0,
      currentCategories: [
        { category: 'FOOD_AND_DRINK', amount: 1254 },
        { category: 'TRANSPORTATION', amount: 846 },
      ],
      previousCategories: [
        { category: 'FOOD_AND_DRINK', amount: 912 },
        { category: 'TRANSPORTATION', amount: 880 },
      ],
    });

    const insight = insights.find((entry) => entry.id === 'category-move');
    // Food moved by $342; transport by only $34.
    expect(insight?.title).toContain('Food and drink');
    expect(insight?.title).toContain('up');
    expect(insight?.description).toContain('$342.00');
  });

  it('ignores a category with no comparable previous period', () => {
    const insights = buildInsights({
      totals: totals(),
      reviewCount: 0,
      currentCategories: [{ category: 'TRAVEL', amount: 4000 }],
      previousCategories: [],
    });

    expect(insights.find((entry) => entry.id === 'category-move')).toBeUndefined();
  });

  it('ignores movements too small to be worth mentioning', () => {
    const insights = buildInsights({
      totals: totals(),
      reviewCount: 0,
      currentCategories: [{ category: 'FOOD_AND_DRINK', amount: 1020 }],
      previousCategories: [{ category: 'FOOD_AND_DRINK', amount: 1000 }],
    });

    expect(insights.find((entry) => entry.id === 'category-move')).toBeUndefined();
  });

  it('states the savings rate with the figures behind it', () => {
    const insights = buildInsights({
      totals: totals({ actualIncome: 10450, surplus: 3619, savingsRate: 0.3463 }),
      reviewCount: 0,
      currentCategories: [],
      previousCategories: [],
    });

    const insight = insights.find((entry) => entry.id === 'savings-rate');
    expect(insight?.title).toContain('34.6%');
    expect(insight?.description).toContain('$3,619.00');
    expect(insight?.description).toContain('$10,450.00');
  });

  it('omits the savings rate when there is no income', () => {
    const insights = buildInsights({
      totals: totals({ actualIncome: 0, savingsRate: null }),
      reviewCount: 0,
      currentCategories: [],
      previousCategories: [],
    });

    expect(insights.find((entry) => entry.id === 'savings-rate')).toBeUndefined();
  });

  it('never invents a comparison against other users', () => {
    const insights = buildInsights({
      totals: totals({ actualIncome: 10450, surplus: 3619, savingsRate: 0.3463 }),
      reviewCount: 2,
      currentCategories: [{ category: 'FOOD_AND_DRINK', amount: 1254 }],
      previousCategories: [{ category: 'FOOD_AND_DRINK', amount: 912 }],
    });

    const text = insights.map((entry) => `${entry.title} ${entry.description}`).join(' ');
    expect(text).not.toMatch(/top \d+%|other users|average user|compared to (other )?people/i);
  });

  it('caps the list so the card stays readable', () => {
    const insights = buildInsights({
      totals: totals({
        actualIncome: 10450,
        surplus: 3619,
        savingsRate: 0.3463,
        internalTransfers: 2500,
        unclassifiedTransactionCount: 4,
        unclassifiedOutflows: 800,
      }),
      reviewCount: 5,
      currentCategories: [{ category: 'FOOD_AND_DRINK', amount: 1254 }],
      previousCategories: [{ category: 'FOOD_AND_DRINK', amount: 912 }],
    });

    expect(insights.length).toBeLessThanOrEqual(4);
  });
});

describe('formatCategoryName', () => {
  it('turns a Plaid category into readable text', () => {
    expect(formatCategoryName('GENERAL_MERCHANDISE')).toBe('General merchandise');
    expect(formatCategoryName('FOOD_AND_DRINK')).toBe('Food and drink');
  });
});
