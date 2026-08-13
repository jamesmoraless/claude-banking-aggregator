import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { useUserId } from '@/features/auth/auth-context';
import { logger } from '@/lib/logger';
import { financialDataKeys } from '@/lib/supabase/query-keys';

import {
  createLinkToken,
  createUpdateLinkToken,
  exchangePublicToken,
  refreshAllConnections,
  refreshConnection,
  removeConnection,
} from './api';

/**
 * Connection mutations.
 *
 * Each one ends by invalidating the entire financial query surface, because
 * connecting, refreshing or disconnecting an institution changes balances,
 * transactions, cash flow and freshness simultaneously. Invalidating a subset
 * would leave two screens showing different truths.
 */
function useInvalidateFinancialData() {
  const queryClient = useQueryClient();
  const userId = useUserId();

  return React.useCallback(() => {
    if (!userId) return;
    for (const key of financialDataKeys(userId)) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }, [queryClient, userId]);
}

export function useCreateLinkToken() {
  return useMutation({ mutationFn: createLinkToken });
}

export function useCreateUpdateLinkToken() {
  return useMutation({ mutationFn: (plaidItemId: string) => createUpdateLinkToken(plaidItemId) });
}

export function useExchangePublicToken() {
  const invalidate = useInvalidateFinancialData();

  return useMutation({
    mutationFn: exchangePublicToken,
    onSuccess: (result) => {
      logger.info('Institution connected', {
        accountsAdded: result.accountsAdded,
        wasExistingItem: result.wasExistingItem,
      });
      invalidate();
    },
  });
}

export function useRefreshConnections() {
  const invalidate = useInvalidateFinancialData();

  return useMutation({
    mutationFn: (plaidItemId?: string) =>
      plaidItemId ? refreshConnection(plaidItemId) : refreshAllConnections(),
    // Even a partial failure updated some institutions, so the cache is
    // refreshed regardless of overall status.
    onSettled: invalidate,
  });
}

export function useRemoveConnection() {
  const invalidate = useInvalidateFinancialData();

  return useMutation({
    mutationFn: (plaidItemId: string) => removeConnection(plaidItemId),
    onSuccess: invalidate,
  });
}
