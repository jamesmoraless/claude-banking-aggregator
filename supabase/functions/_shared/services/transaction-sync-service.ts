import type { SupabaseClient } from '@supabase/supabase-js';

import { AppError } from '../errors/app-error.ts';
import type { Logger } from '../logging/logger.ts';
import { PlaidApiError, PlaidClient } from '../plaid/client.ts';
import type { PlaidTransaction } from '../plaid/types.ts';
import { AccountRepository } from '../repositories/account-repository.ts';
import { ItemRepository, type PlaidItemRecord } from '../repositories/item-repository.ts';
import { SyncRunRepository } from '../repositories/sync-run-repository.ts';
import { TransactionRepository } from '../repositories/transaction-repository.ts';

import { NormalizationService } from './normalization-service.ts';

/**
 * Incremental transaction synchronisation.
 *
 * Uses Plaid's `/transactions/sync` with a persisted cursor. Full date-range
 * downloads are never used: they are slow, expensive, and they make it hard to
 * tell a genuine change from a re-fetch.
 *
 * ## Cursor discipline
 *
 * The cursor is committed only AFTER its page has been written. If the function
 * dies mid-page, the next run replays that page rather than skipping it.
 * Replay is harmless because every write upserts on `plaid_transaction_id`.
 * Committing the cursor first would be faster and would silently lose
 * transactions — the one failure mode that must not exist here.
 */

const MAX_PAGES_PER_RUN = 40;

export type TransactionSyncResult = {
  itemId: string;
  added: number;
  modified: number;
  removed: number;
  pagesFetched: number;
  classified: number;
  transfersDetected: number;
  transfersNeedingReview: number;
  /** True when Plaid still had more pages when we stopped. */
  hasMore: boolean;
};

export class TransactionSyncService {
  private readonly transactions: TransactionRepository;
  private readonly accounts: AccountRepository;
  private readonly items: ItemRepository;
  private readonly syncRuns: SyncRunRepository;
  private readonly normalization: NormalizationService;

  constructor(
    client: SupabaseClient,
    private readonly plaid: PlaidClient,
    private readonly logger: Logger,
  ) {
    this.transactions = new TransactionRepository(client);
    this.accounts = new AccountRepository(client);
    this.items = new ItemRepository(client);
    this.syncRuns = new SyncRunRepository(client, logger);
    this.normalization = new NormalizationService(client, logger);
  }

  async syncItem(input: {
    userId: string;
    item: PlaidItemRecord;
    requestId: string;
    accessToken?: string;
  }): Promise<TransactionSyncResult> {
    const startedAt = Date.now();
    const runId = await this.syncRuns.start({
      userId: input.userId,
      itemId: input.item.id,
      operation: 'TRANSACTIONS_SYNC',
      requestId: input.requestId,
      metadata: { initialSync: input.item.transactionCursor === null },
    });

    let added = 0;
    let modified = 0;
    let removed = 0;
    let pagesFetched = 0;
    let hasMore = true;
    let cursor = input.item.transactionCursor;

    try {
      const accessToken =
        input.accessToken ?? (await this.items.loadWithToken(input.item.id)).accessToken;

      const accountIdByPlaidId = await this.accounts.mapPlaidAccountIds(input.userId);
      const earliestDate = { value: null as string | null };

      while (hasMore && pagesFetched < MAX_PAGES_PER_RUN) {
        const page = await this.plaid.syncTransactions(accessToken, cursor);
        pagesFetched += 1;

        // ---- Apply this page, in an order that cannot double-count ---------
        const upsertable = [...page.added, ...page.modified];

        const written = await this.transactions.upsertFromPlaid({
          userId: input.userId,
          transactions: upsertable,
          accountIdByPlaidId,
        });

        // A posted transaction supersedes its pending version.
        const retired = await this.transactions.retireSupersededPending(input.userId, upsertable);

        const explicitlyRemoved = await this.transactions.markRemoved(
          input.userId,
          page.removed.map((entry) => entry.transaction_id),
        );

        added += page.added.length;
        modified += page.modified.length;
        removed += explicitlyRemoved + retired;

        trackEarliestDate(earliestDate, upsertable);

        if (written.skipped > 0) {
          this.logger.warn('Transactions skipped: account not yet imported', {
            count: written.skipped,
          });
        }

        // ---- Only now is it safe to advance the cursor ---------------------
        cursor = page.next_cursor;
        await this.items.saveCursor(input.item.id, cursor);

        hasMore = page.has_more;
      }

      if (hasMore) {
        // Plaid still has more. The cursor is saved, so the next run — webhook
        // or scheduled — picks up exactly where this one stopped.
        this.logger.info('Stopped before exhausting Plaid pages', {
          itemId: input.item.id,
          pagesFetched,
        });
      }

      const normalization = await this.normalization.run({
        userId: input.userId,
        sinceDate: earliestDate.value ?? defaultSinceDate(),
        requestId: input.requestId,
      });

      await this.items.markSynced(input.item.id, 'transactions');

      await this.syncRuns.finish(runId, {
        status: hasMore ? 'PARTIAL' : 'SUCCESS',
        startedAt,
        counts: { added, modified, removed, processed: added + modified + removed },
        metadata: { pagesFetched, hasMore },
      });

      this.logger.info('Transactions synchronised', {
        itemId: input.item.id,
        added,
        modified,
        removed,
        pagesFetched,
      });

      return {
        itemId: input.item.id,
        added,
        modified,
        removed,
        pagesFetched,
        classified: normalization.classified,
        transfersDetected: normalization.transfersDetected,
        transfersNeedingReview: normalization.transfersNeedingReview,
        hasMore,
      };
    } catch (error) {
      await this.recordFailure(runId, startedAt, input.item.id, error, {
        added,
        modified,
        removed,
      });
      throw error;
    }
  }

  private async recordFailure(
    runId: string | null,
    startedAt: number,
    itemId: string,
    error: unknown,
    counts: { added: number; modified: number; removed: number },
  ): Promise<void> {
    const appError = error instanceof AppError ? error : null;

    if (error instanceof PlaidApiError && error.requiresReauth) {
      await this.items.markError(itemId, {
        status: 'LOGIN_REQUIRED',
        errorCode: error.plaidErrorCode,
        errorMessage: error.message,
      });
    } else if (appError) {
      await this.items.markError(itemId, {
        status: 'ERROR',
        errorCode: appError.code,
        errorMessage: appError.message,
      });
    }

    // Partial when some pages committed before the failure: those transactions
    // are real and the cursor reflects them.
    const committed = counts.added + counts.modified + counts.removed > 0;

    await this.syncRuns.finish(runId, {
      status: committed ? 'PARTIAL' : 'FAILED',
      startedAt,
      counts: { ...counts, processed: counts.added + counts.modified + counts.removed },
      errorCode: appError?.code ?? 'INTERNAL_ERROR',
      errorMessage: appError?.message ?? 'Transaction sync failed.',
    });
  }
}

/**
 * Tracks the earliest date touched, so normalisation only reconsiders
 * transactions this sync could have affected rather than the entire history.
 */
function trackEarliestDate(
  tracker: { value: string | null },
  transactions: PlaidTransaction[],
): void {
  for (const transaction of transactions) {
    if (tracker.value === null || transaction.date < tracker.value) {
      tracker.value = transaction.date;
    }
  }
}

/** When a page contained nothing dated, look back far enough to be useful. */
function defaultSinceDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().slice(0, 10);
}
