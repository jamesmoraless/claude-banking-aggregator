import { createAdminClient, requireServiceRole } from '../_shared/auth/authenticate.ts';
import { AppError } from '../_shared/errors/app-error.ts';
import { createHandler } from '../_shared/http/handler.ts';
import { PlaidClient } from '../_shared/plaid/client.ts';
import { ItemRepository } from '../_shared/repositories/item-repository.ts';
import { SyncRunRepository } from '../_shared/repositories/sync-run-repository.ts';
import { AccountSyncService } from '../_shared/services/account-sync-service.ts';
import { TransactionSyncService } from '../_shared/services/transaction-sync-service.ts';

/**
 * Scheduled synchronisation across every active Item.
 *
 * A safety net, not the primary mechanism — webhooks are. This exists to catch
 * missed webhooks and institutions that go quiet, and runs on a pg_cron
 * schedule (see MANUAL_SETUP.md; it is not configured automatically).
 *
 * Server invocation only. `requireServiceRole` rejects an ordinary user's JWT,
 * so this cannot be triggered from a browser even though the platform accepts
 * the request. It emits no CORS headers either.
 *
 * Partial failure is the expected case at any scale: one bank being down must
 * not stop the other nineteen syncing.
 */

const MAX_ITEMS_PER_RUN = 50;

Deno.serve(
  createHandler(
    { functionName: 'plaid-sync-all', browserAccessible: false },
    async ({ request, requestId, logger }) => {
      await requireServiceRole(request);

      const client = createAdminClient();
      const items = new ItemRepository(client);
      const syncRuns = new SyncRunRepository(client, logger);
      const startedAt = Date.now();

      const runId = await syncRuns.start({
        userId: null,
        itemId: null,
        operation: 'SYNC_ALL',
        requestId,
      });

      // Ordered by least-recently-synced, so a run that hits the cap still
      // makes progress on the stalest Items rather than repeating the same ones.
      const allItems = await items.listAllActive();
      const targets = allItems.slice(0, MAX_ITEMS_PER_RUN);

      logger.info('Scheduled sync starting', {
        totalItems: allItems.length,
        processing: targets.length,
      });

      let succeeded = 0;
      let failed = 0;
      let transactionsAdded = 0;
      const failures: { itemId: string; errorCode: string }[] = [];

      for (const item of targets) {
        const itemLogger = logger.child({ itemId: item.id });

        try {
          const { accessToken } = await items.loadWithToken(item.id);
          const plaid = new PlaidClient(itemLogger);

          const accountSync = new AccountSyncService(client, plaid, itemLogger);
          await accountSync.syncItem({
            userId: item.userId,
            item,
            requestId,
            accessToken,
          });

          const transactionSync = new TransactionSyncService(client, plaid, itemLogger);
          const result = await transactionSync.syncItem({
            userId: item.userId,
            item,
            requestId,
            accessToken,
          });

          transactionsAdded += result.added;
          succeeded += 1;
        } catch (error) {
          // Each Item's own sync run already recorded the detail and marked the
          // Item's health. Here we only tally, and carry on.
          const appError = error instanceof AppError ? error : null;
          failed += 1;
          failures.push({ itemId: item.id, errorCode: appError?.code ?? 'INTERNAL_ERROR' });

          itemLogger.warn('Scheduled sync failed for item', {
            code: appError?.code ?? 'INTERNAL_ERROR',
          });
        }
      }

      const status = failed === 0 ? 'SUCCESS' : succeeded === 0 ? 'FAILED' : 'PARTIAL';

      await syncRuns.finish(runId, {
        status,
        startedAt,
        counts: { added: transactionsAdded, processed: targets.length },
        metadata: {
          itemsSucceeded: succeeded,
          itemsFailed: failed,
          itemsSkipped: allItems.length - targets.length,
        },
        ...(failed > 0
          ? {
              errorCode: 'PARTIAL_SYNC_FAILURE',
              errorMessage: `${failed} of ${targets.length} institutions could not be synchronised.`,
            }
          : {}),
      });

      logger.info('Scheduled sync complete', {
        succeeded,
        failed,
        transactionsAdded,
        durationMs: Date.now() - startedAt,
      });

      return {
        status,
        itemsProcessed: targets.length,
        itemsSucceeded: succeeded,
        itemsFailed: failed,
        itemsSkipped: allItems.length - targets.length,
        transactionsAdded,
        failures,
      };
    },
  ),
);
