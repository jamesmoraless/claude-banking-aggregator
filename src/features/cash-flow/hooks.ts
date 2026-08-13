import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { useUserId } from '@/features/auth/auth-context';
import { buildSpendingExplanation, sumCashflow } from '@/lib/financial/cashflow';
import { type DateRange, previousPeriod } from '@/lib/financial/dates';
import { percentChange } from '@/lib/financial/money';
import { queryKeys } from '@/lib/supabase/query-keys';

import {
  fetchCashTrend,
  fetchIncomeBySource,
  fetchMonthlyCashflow,
  fetchSpendingByCategory,
  fetchTopMerchants,
  fetchTransferSummary,
} from './api';

export function useMonthlyCashflow(range: DateRange) {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.cashflow.monthly(userId ?? 'anonymous', range),
    queryFn: () => fetchMonthlyCashflow(range),
    enabled: Boolean(userId),
  });
}

/**
 * Period totals plus the comparison against the preceding equal-length period.
 *
 * The comparison is fetched as a separate query rather than derived from a
 * wider range, so the "vs last 6 months" figure is computed by the same RPC
 * with the same rules as the headline number.
 */
export function useCashflowSummary(range: DateRange) {
  const current = useMonthlyCashflow(range);
  const comparisonRange = React.useMemo(() => previousPeriod(range), [range]);
  const previous = useMonthlyCashflow(comparisonRange);

  const totals = React.useMemo(() => sumCashflow(current.data ?? []), [current.data]);
  const previousTotals = React.useMemo(() => sumCashflow(previous.data ?? []), [previous.data]);

  const hasComparison = (previous.data?.length ?? 0) > 0 && previousTotals.transactionCount > 0;

  return {
    isLoading: current.isLoading,
    isFetching: current.isFetching,
    isError: current.isError,
    error: current.error,
    refetch: current.refetch,
    months: current.data ?? [],
    totals,
    previousTotals,
    explanation: buildSpendingExplanation(totals),
    comparison: {
      available: hasComparison,
      range: comparisonRange,
      income: hasComparison ? percentChange(totals.actualIncome, previousTotals.actualIncome) : null,
      spending: hasComparison
        ? percentChange(totals.actualSpending, previousTotals.actualSpending)
        : null,
      surplus: hasComparison ? percentChange(totals.surplus, previousTotals.surplus) : null,
      // Savings rate is already a ratio; the difference is in percentage points.
      savingsRatePoints:
        hasComparison && totals.savingsRate != null && previousTotals.savingsRate != null
          ? totals.savingsRate - previousTotals.savingsRate
          : null,
    },
    /** True when the period contains no activity at all — a real zero. */
    isEmpty: totals.transactionCount === 0,
  };
}

export function useSpendingByCategory(range: DateRange) {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.cashflow.spendingByCategory(userId ?? 'anonymous', range),
    queryFn: () => fetchSpendingByCategory(range),
    enabled: Boolean(userId),
  });
}

export function useIncomeBySource(range: DateRange) {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.cashflow.incomeBySource(userId ?? 'anonymous', range),
    queryFn: () => fetchIncomeBySource(range),
    enabled: Boolean(userId),
  });
}

export function useTopMerchants(range: DateRange, limit = 10) {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.cashflow.topMerchants(userId ?? 'anonymous', range, limit),
    queryFn: () => fetchTopMerchants(range, limit),
    enabled: Boolean(userId),
  });
}

export function useTransferSummary(range: DateRange) {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.cashflow.transferSummary(userId ?? 'anonymous', range),
    queryFn: () => fetchTransferSummary(range),
    enabled: Boolean(userId),
  });
}

export function useCashTrend(range: DateRange) {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.cashTrend(userId ?? 'anonymous', range),
    queryFn: () => fetchCashTrend(range),
    enabled: Boolean(userId),
  });
}
