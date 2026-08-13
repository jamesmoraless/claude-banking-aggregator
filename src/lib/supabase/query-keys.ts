import type { DateRange } from '@/lib/financial/dates';

/**
 * Centralised query keys.
 *
 * Every key is namespaced by user id. Two consequences follow, both deliberate:
 * signing out and back in as a different user cannot surface the previous
 * user's cached figures, and invalidation can be scoped precisely.
 *
 * Keys are declared here rather than inline at call sites so that an
 * invalidation after a mutation cannot miss a query it should have refreshed.
 */
export const queryKeys = {
  all: (userId: string) => ['cash-atlas', userId] as const,

  profile: (userId: string) => [...queryKeys.all(userId), 'profile'] as const,

  institutions: (userId: string) => [...queryKeys.all(userId), 'institutions'] as const,

  plaidItems: (userId: string) => [...queryKeys.all(userId), 'plaid-items'] as const,

  accounts: {
    all: (userId: string) => [...queryKeys.all(userId), 'accounts'] as const,
    list: (userId: string, filters?: Record<string, unknown>) =>
      [...queryKeys.accounts.all(userId), 'list', filters ?? {}] as const,
    detail: (userId: string, accountId: string) =>
      [...queryKeys.accounts.all(userId), 'detail', accountId] as const,
  },

  cashSummary: (userId: string) => [...queryKeys.all(userId), 'cash-summary'] as const,

  cashTrend: (userId: string, range: DateRange) =>
    [...queryKeys.all(userId), 'cash-trend', range.from, range.to] as const,

  cashflow: {
    all: (userId: string) => [...queryKeys.all(userId), 'cashflow'] as const,
    monthly: (userId: string, range: DateRange) =>
      [...queryKeys.cashflow.all(userId), 'monthly', range.from, range.to] as const,
    spendingByCategory: (userId: string, range: DateRange) =>
      [...queryKeys.cashflow.all(userId), 'spending-by-category', range.from, range.to] as const,
    incomeBySource: (userId: string, range: DateRange) =>
      [...queryKeys.cashflow.all(userId), 'income-by-source', range.from, range.to] as const,
    topMerchants: (userId: string, range: DateRange, limit: number) =>
      [...queryKeys.cashflow.all(userId), 'top-merchants', range.from, range.to, limit] as const,
    transferSummary: (userId: string, range: DateRange) =>
      [...queryKeys.cashflow.all(userId), 'transfer-summary', range.from, range.to] as const,
  },

  transactions: {
    all: (userId: string) => [...queryKeys.all(userId), 'transactions'] as const,
    list: (userId: string, filters: Record<string, unknown>) =>
      [...queryKeys.transactions.all(userId), 'list', filters] as const,
    detail: (userId: string, transactionId: string) =>
      [...queryKeys.transactions.all(userId), 'detail', transactionId] as const,
    recent: (userId: string, limit: number) =>
      [...queryKeys.transactions.all(userId), 'recent', limit] as const,
  },

  transfers: {
    all: (userId: string) => [...queryKeys.all(userId), 'transfers'] as const,
    reviewQueue: (userId: string) => [...queryKeys.transfers.all(userId), 'review-queue'] as const,
    candidates: (userId: string, transactionId: string) =>
      [...queryKeys.transfers.all(userId), 'candidates', transactionId] as const,
  },

  rules: (userId: string) => [...queryKeys.all(userId), 'transaction-rules'] as const,

  freshness: (userId: string) => [...queryKeys.all(userId), 'data-freshness'] as const,

  syncRuns: (userId: string, limit: number) =>
    [...queryKeys.all(userId), 'sync-runs', limit] as const,
} as const;

/**
 * Query families invalidated after a successful sync or connection change.
 *
 * Everything derived from transactions or balances lands here. Listed centrally
 * because forgetting one after a mutation produces the worst possible bug in a
 * finance app: a screen that quietly disagrees with the one beside it.
 */
export function financialDataKeys(userId: string): readonly (readonly unknown[])[] {
  return [
    queryKeys.accounts.all(userId),
    queryKeys.institutions(userId),
    queryKeys.plaidItems(userId),
    queryKeys.cashSummary(userId),
    queryKeys.cashflow.all(userId),
    queryKeys.transactions.all(userId),
    queryKeys.transfers.all(userId),
    queryKeys.freshness(userId),
  ];
}
