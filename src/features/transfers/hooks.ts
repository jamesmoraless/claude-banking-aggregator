import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useUserId } from '@/features/auth/auth-context';
import type { TransferSubtype } from '@/lib/financial/classification';
import { financialDataKeys, queryKeys } from '@/lib/supabase/query-keys';

import {
  confirmTransferMatch,
  createManualTransferMatch,
  fetchMatchesForTransaction,
  fetchTransferCandidates,
  fetchTransferReviewQueue,
  rejectTransferMatch,
} from './api';

export function useTransferReviewQueue() {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.transfers.reviewQueue(userId ?? 'anonymous'),
    queryFn: fetchTransferReviewQueue,
    enabled: Boolean(userId),
  });
}

/**
 * Count of matches awaiting review, surfaced in navigation.
 *
 * Unreviewed matches make spending figures provisional, so this is deliberately
 * visible from every screen rather than only on Transfer Review.
 */
export function useTransferReviewCount(): number {
  const { data } = useTransferReviewQueue();
  return data?.length ?? 0;
}

export function useTransferMatchesForTransaction(transactionId: string | null) {
  const userId = useUserId();
  return useQuery({
    queryKey: [...queryKeys.transfers.all(userId ?? 'anonymous'), 'for-transaction', transactionId],
    queryFn: () => fetchMatchesForTransaction(transactionId!),
    enabled: Boolean(userId && transactionId),
  });
}

export function useTransferCandidates(transactionId: string | null) {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.transfers.candidates(userId ?? 'anonymous', transactionId ?? ''),
    queryFn: () => fetchTransferCandidates(transactionId!),
    enabled: Boolean(userId && transactionId),
  });
}

function useTransferMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<void>) {
  const queryClient = useQueryClient();
  const userId = useUserId();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      if (!userId) return;
      // Confirming or rejecting a transfer moves money in or out of the
      // spending totals, so every derived figure is refreshed.
      for (const key of financialDataKeys(userId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useConfirmTransferMatch() {
  return useTransferMutation((matchId: string) => confirmTransferMatch(matchId));
}

export function useRejectTransferMatch() {
  return useTransferMutation((matchId: string) => rejectTransferMatch(matchId));
}

export function useCreateManualTransferMatch() {
  return useTransferMutation(
    (input: {
      outgoingTransactionId: string;
      incomingTransactionId: string;
      subtype?: TransferSubtype;
    }) => createManualTransferMatch(input),
  );
}
