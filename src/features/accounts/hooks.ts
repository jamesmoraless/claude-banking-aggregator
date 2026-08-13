import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useUserId } from '@/features/auth/auth-context';
import { aggregateFreshness, evaluateFreshness } from '@/lib/financial/freshness';
import { financialDataKeys, queryKeys } from '@/lib/supabase/query-keys';

import {
  type AccountSettingsUpdate,
  createManualAccount,
  deleteManualAccount,
  fetchAccount,
  fetchAccounts,
  fetchCashSummary,
  fetchDataFreshness,
  fetchInstitutions,
  fetchPlaidItems,
  type ManualAccountInput,
  renameInstitution,
  updateAccountSettings,
  updateManualAccount,
} from './api';

/**
 * Account feature hooks.
 *
 * Every query is gated on an authenticated user id, so nothing fires before the
 * session resolves and no request is made that RLS would reject anyway.
 */

export function useAccounts() {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.accounts.list(userId ?? 'anonymous'),
    queryFn: fetchAccounts,
    enabled: Boolean(userId),
  });
}

export function useAccount(accountId: string | null) {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.accounts.detail(userId ?? 'anonymous', accountId ?? ''),
    queryFn: () => fetchAccount(accountId!),
    enabled: Boolean(userId && accountId),
  });
}

export function useInstitutions() {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.institutions(userId ?? 'anonymous'),
    queryFn: fetchInstitutions,
    enabled: Boolean(userId),
  });
}

export function usePlaidItems() {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.plaidItems(userId ?? 'anonymous'),
    queryFn: fetchPlaidItems,
    enabled: Boolean(userId),
  });
}

export function useCashSummary() {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.cashSummary(userId ?? 'anonymous'),
    queryFn: fetchCashSummary,
    enabled: Boolean(userId),
  });
}

export function useDataFreshness() {
  const userId = useUserId();
  const query = useQuery({
    queryKey: queryKeys.freshness(userId ?? 'anonymous'),
    queryFn: fetchDataFreshness,
    enabled: Boolean(userId),
    // Freshness is a clock reading; re-evaluate it periodically so "12 minutes
    // ago" does not sit frozen on a long-lived tab.
    refetchInterval: 60_000,
  });

  const rows = query.data ?? [];

  return {
    ...query,
    rows,
    /** Oldest sync across all institutions — never the most flattering one. */
    overall: aggregateFreshness(rows.map((row) => row.last_successful_sync_at)),
    institutions: rows.map((row) => ({
      name: row.institution_name,
      freshness: evaluateFreshness(row.last_successful_sync_at),
      requiresReauth: row.requires_reauth,
      itemId: row.plaid_item_id,
      status: row.item_status,
    })),
    needsReconnect: rows.filter((row) => row.requires_reauth),
  };
}

/**
 * Whether the user has ever connected anything.
 *
 * Drives the difference between "you have not connected a bank yet" (an
 * onboarding state with a call to action) and "you have banks but no data for
 * this filter" (an empty result). Conflating those is the single most common
 * way an empty state misleads.
 */
export function useHasConnections() {
  const accounts = useAccounts();
  const items = usePlaidItems();

  return {
    isLoading: accounts.isLoading || items.isLoading,
    isError: accounts.isError || items.isError,
    error: accounts.error ?? items.error,
    hasAnyAccount: (accounts.data?.length ?? 0) > 0,
    hasPlaidConnection: (items.data?.length ?? 0) > 0,
    refetch: () => {
      void accounts.refetch();
      void items.refetch();
    },
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useUpdateAccountSettings() {
  const queryClient = useQueryClient();
  const userId = useUserId();

  return useMutation({
    mutationFn: ({ accountId, changes }: { accountId: string; changes: AccountSettingsUpdate }) =>
      updateAccountSettings(accountId, changes),
    onSuccess: () => {
      if (!userId) return;
      // include_in_cash and hidden feed every aggregate, so this invalidates the
      // whole financial surface rather than just the accounts list.
      for (const key of financialDataKeys(userId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useRenameInstitution() {
  const queryClient = useQueryClient();
  const userId = useUserId();

  return useMutation({
    mutationFn: ({ institutionId, displayName }: { institutionId: string; displayName: string | null }) =>
      renameInstitution(institutionId, displayName),
    onSuccess: () => {
      if (!userId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.institutions(userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all(userId) });
    },
  });
}

export function useCreateManualAccount() {
  const queryClient = useQueryClient();
  const userId = useUserId();

  return useMutation({
    mutationFn: (input: ManualAccountInput) => {
      if (!userId) throw new Error('Not signed in');
      return createManualAccount(userId, input);
    },
    onSuccess: () => {
      if (!userId) return;
      for (const key of financialDataKeys(userId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useUpdateManualAccount() {
  const queryClient = useQueryClient();
  const userId = useUserId();

  return useMutation({
    mutationFn: ({ accountId, input }: { accountId: string; input: Partial<ManualAccountInput> }) =>
      updateManualAccount(accountId, input),
    onSuccess: () => {
      if (!userId) return;
      for (const key of financialDataKeys(userId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useDeleteManualAccount() {
  const queryClient = useQueryClient();
  const userId = useUserId();

  return useMutation({
    mutationFn: (accountId: string) => deleteManualAccount(accountId),
    onSuccess: () => {
      if (!userId) return;
      for (const key of financialDataKeys(userId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
