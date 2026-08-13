import { authenticateRequest, createAdminClient } from '../_shared/auth/authenticate.ts';
import { AppError } from '../_shared/errors/app-error.ts';
import { createHandler, parseJsonBody } from '../_shared/http/handler.ts';
import { PlaidClient } from '../_shared/plaid/client.ts';
import { ItemRepository } from '../_shared/repositories/item-repository.ts';
import { TransactionSyncService } from '../_shared/services/transaction-sync-service.ts';
import { syncAccountsSchema, validate } from '../_shared/validation/schemas.ts';

/**
 * Incrementally synchronises transactions.
 *
 * Loads the persisted cursor, fetches pages until Plaid has no more (or the
 * per-run page cap is reached), applies additions, modifications and removals,
 * commits the cursor only after each page lands, then runs normalisation and
 * transfer detection.
 */
Deno.serve(
  createHandler(
    { functionName: 'plaid-sync-transactions', browserAccessible: true },
    async ({ request, requestId, logger }) => {
      const user = await authenticateRequest(request);
      const body = validate(syncAccountsSchema, await parseJsonBody(request));

      const client = createAdminClient();
      const scopedLogger = logger.child({ userId: user.id });
      const items = new ItemRepository(client);
      const service = new TransactionSyncService(client, new PlaidClient(scopedLogger), scopedLogger);

      const targets = body.plaidItemId
        ? [await requireItem(items, user.id, body.plaidItemId)]
        : await items.listActive(user.id);

      const results = [];
      const failures = [];

      for (const item of targets) {
        try {
          results.push(await service.syncItem({ userId: user.id, item, requestId }));
        } catch (error) {
          const appError = error instanceof AppError ? error : null;
          failures.push({
            plaidItemId: item.id,
            errorCode: appError?.code ?? 'INTERNAL_ERROR',
            errorMessage: appError?.message ?? 'Transactions could not be synchronised.',
          });
        }
      }

      return {
        results,
        failures,
        overallStatus:
          failures.length === 0 ? 'SUCCESS' : results.length === 0 ? 'FAILED' : 'PARTIAL',
      };
    },
  ),
);

async function requireItem(items: ItemRepository, userId: string, itemId: string) {
  const item = await items.findById(userId, itemId);
  if (!item) throw AppError.notFound('That connection could not be found.');
  return item;
}
