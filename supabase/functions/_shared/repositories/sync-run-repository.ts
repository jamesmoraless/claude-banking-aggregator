import type { SupabaseClient } from '@supabase/supabase-js';

import type { Logger } from '../logging/logger.ts';

/**
 * Operational logging of sync attempts.
 *
 * Deliberately best-effort: a failure to record telemetry must never fail the
 * sync it is describing. Errors here are logged and swallowed, which is the one
 * place in this codebase where swallowing is correct.
 *
 * Rows are user-readable, so they carry stable error codes and safe messages
 * only — never a raw exception, payload or token.
 */

export type SyncOperation =
  | 'ITEM_EXCHANGE'
  | 'ACCOUNTS_SYNC'
  | 'TRANSACTIONS_SYNC'
  | 'ITEM_REMOVE'
  | 'WEBHOOK'
  | 'SYNC_ALL'
  | 'TRANSFER_DETECTION';

export type SyncCounts = {
  added?: number;
  modified?: number;
  removed?: number;
  processed?: number;
};

export class SyncRunRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly logger: Logger,
  ) {}

  async start(input: {
    userId: string | null;
    itemId: string | null;
    operation: SyncOperation;
    requestId: string;
    metadata?: Record<string, unknown>;
  }): Promise<string | null> {
    const { data, error } = await this.client
      .from('sync_runs')
      .insert({
        user_id: input.userId,
        plaid_item_id: input.itemId,
        operation: input.operation,
        status: 'RUNNING',
        request_id: input.requestId,
        metadata: input.metadata ?? {},
      })
      .select('id')
      .single();

    if (error) {
      this.logger.warn('Could not record sync run start', { detail: error.message });
      return null;
    }

    return (data as { id: string }).id;
  }

  async finish(
    runId: string | null,
    input: {
      status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
      counts?: SyncCounts;
      errorCode?: string | null;
      errorMessage?: string | null;
      metadata?: Record<string, unknown>;
      startedAt: number;
    },
  ): Promise<void> {
    if (!runId) return;

    const { error } = await this.client
      .from('sync_runs')
      .update({
        status: input.status,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - input.startedAt,
        records_added: input.counts?.added ?? 0,
        records_modified: input.counts?.modified ?? 0,
        records_removed: input.counts?.removed ?? 0,
        records_processed: input.counts?.processed ?? 0,
        error_code: input.errorCode ?? null,
        // Safe message only. Callers pass our own text, never a raw exception.
        error_message: input.errorMessage ?? null,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      })
      .eq('id', runId);

    if (error) {
      this.logger.warn('Could not record sync run completion', { detail: error.message });
    }
  }
}
