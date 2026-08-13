import type { TransferSubtype } from '@/lib/financial/classification';
import { requireSupabase } from '@/lib/supabase/client';
import { unwrap } from '@/lib/supabase/errors';
import type { FunctionReturns, Tables } from '@/types/database.types';

/**
 * Transfer review data access.
 *
 * Reads use the transfer_review_queue view, which denormalises both legs.
 * Writes go through RPCs, because confirming or rejecting a match has to update
 * the match row and both transactions atomically, and because the server must
 * verify the caller owns both legs before pairing them.
 */

export type TransferReviewRow = Tables<'transfer_review_queue'>;
export type TransferCandidate = FunctionReturns<'find_transfer_candidates'>[number];

/** Signals behind a confidence score, as recorded by the detection engine. */
export type MatchReason = { signal: string; detail: string; weight: number };

export function parseMatchReasons(reason: unknown): MatchReason[] {
  if (!Array.isArray(reason)) return [];
  return reason.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.signal !== 'string') return [];
    return [
      {
        signal: record.signal,
        detail: typeof record.detail === 'string' ? record.detail : '',
        weight: typeof record.weight === 'number' ? record.weight : 0,
      },
    ];
  });
}

export async function fetchTransferReviewQueue(): Promise<TransferReviewRow[]> {
  const supabase = requireSupabase();
  return unwrap(
    'Load transfer review queue',
    await supabase
      .from('transfer_review_queue')
      .select('*')
      .eq('status', 'NEEDS_REVIEW')
      .order('confidence', { ascending: false })
      .order('outgoing_date', { ascending: false }),
  );
}

export async function fetchMatchesForTransaction(
  transactionId: string,
): Promise<TransferReviewRow[]> {
  const supabase = requireSupabase();
  return unwrap(
    'Load transfer match',
    await supabase
      .from('transfer_review_queue')
      .select('*')
      .or(
        `outgoing_transaction_id.eq.${transactionId},incoming_transaction_id.eq.${transactionId}`,
      ),
  );
}

export async function fetchTransferCandidates(
  transactionId: string,
): Promise<TransferCandidate[]> {
  const supabase = requireSupabase();
  return unwrap(
    'Find transfer candidates',
    await supabase.rpc('find_transfer_candidates', {
      p_transaction_id: transactionId,
      p_day_window: 7,
      p_limit: 20,
    }),
  );
}

export async function confirmTransferMatch(matchId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.rpc('confirm_transfer_match', { p_match_id: matchId });
  if (error) throw error;
}

export async function rejectTransferMatch(matchId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.rpc('reject_transfer_match', { p_match_id: matchId });
  if (error) throw error;
}

export async function createManualTransferMatch(input: {
  outgoingTransactionId: string;
  incomingTransactionId: string;
  subtype?: TransferSubtype;
}): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.rpc('create_manual_transfer_match', {
    p_outgoing_transaction_id: input.outgoingTransactionId,
    p_incoming_transaction_id: input.incomingTransactionId,
    p_subtype: input.subtype ?? 'ACCOUNT_TO_ACCOUNT',
  });
  if (error) throw error;
}
