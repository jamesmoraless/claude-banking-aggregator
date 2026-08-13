import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useUserId } from '@/features/auth/auth-context';
import type { EconomicType, TransferSubtype } from '@/lib/financial/classification';
import { financialDataKeys, queryKeys } from '@/lib/supabase/query-keys';

import {
  clearTransactionClassification,
  fetchAvailableCategories,
  fetchRecentTransactions,
  fetchTransaction,
  fetchTransactions,
  setTransactionClassification,
  setTransactionExcluded,
  type TransactionFilters,
  TRANSACTIONS_PAGE_SIZE,
} from './api';

export function useTransactions(filters: TransactionFilters, page: number) {
  const userId = useUserId();

  return useQuery({
    queryKey: queryKeys.transactions.list(userId ?? 'anonymous', { ...filters, page }),
    queryFn: () => fetchTransactions(filters, page, TRANSACTIONS_PAGE_SIZE),
    enabled: Boolean(userId),
    // Keeps the previous page rendered while the next loads, so paging and
    // filtering do not blank the table on every keystroke.
    placeholderData: keepPreviousData,
  });
}

export function useTransaction(transactionId: string | null) {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.transactions.detail(userId ?? 'anonymous', transactionId ?? ''),
    queryFn: () => fetchTransaction(transactionId!),
    enabled: Boolean(userId && transactionId),
  });
}

export function useRecentTransactions(limit = 5) {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.transactions.recent(userId ?? 'anonymous', limit),
    queryFn: () => fetchRecentTransactions(limit),
    enabled: Boolean(userId),
  });
}

export function useAvailableCategories() {
  const userId = useUserId();
  return useQuery({
    queryKey: [...queryKeys.transactions.all(userId ?? 'anonymous'), 'categories'],
    queryFn: fetchAvailableCategories,
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });
}

/**
 * Reclassification.
 *
 * Every classification change alters spending and income totals, so the whole
 * financial query surface is invalidated. Doing anything narrower risks the
 * Cash Flow screen disagreeing with the Transactions screen the user just
 * edited — precisely the class of bug this app exists to avoid.
 */
export function useClassifyTransaction() {
  const queryClient = useQueryClient();
  const userId = useUserId();

  return useMutation({
    mutationFn: ({
      transactionId,
      type,
      transferSubtype,
    }: {
      transactionId: string;
      type: EconomicType;
      transferSubtype?: TransferSubtype | null;
    }) => setTransactionClassification(transactionId, type, transferSubtype ?? null),
    onSuccess: () => {
      if (!userId) return;
      for (const key of financialDataKeys(userId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useRestoreAutomaticClassification() {
  const queryClient = useQueryClient();
  const userId = useUserId();

  return useMutation({
    mutationFn: (transactionId: string) => clearTransactionClassification(transactionId),
    onSuccess: () => {
      if (!userId) return;
      for (const key of financialDataKeys(userId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useSetTransactionExcluded() {
  const queryClient = useQueryClient();
  const userId = useUserId();

  return useMutation({
    mutationFn: ({ transactionId, excluded }: { transactionId: string; excluded: boolean }) =>
      setTransactionExcluded(transactionId, excluded),
    onSuccess: () => {
      if (!userId) return;
      for (const key of financialDataKeys(userId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
