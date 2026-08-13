import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '../_shared/auth/authenticate.ts';
import { AppError } from '../_shared/errors/app-error.ts';
import { createHandler } from '../_shared/http/handler.ts';
import type { Logger } from '../_shared/logging/logger.ts';
import { PlaidClient } from '../_shared/plaid/client.ts';
import { verifyPlaidWebhook } from '../_shared/plaid/webhook-verifier.ts';
import { ItemRepository, type PlaidItemRecord } from '../_shared/repositories/item-repository.ts';
import { SyncRunRepository } from '../_shared/repositories/sync-run-repository.ts';
import { AccountSyncService } from '../_shared/services/account-sync-service.ts';
import { TransactionSyncService } from '../_shared/services/transaction-sync-service.ts';

/**
 * Plaid webhook receiver.
 *
 * The primary mechanism keeping data current: the bank tells Plaid, Plaid tells
 * us, we sync. The scheduled job is only a safety net for missed webhooks.
 *
 * This is the one function with `verify_jwt = false`, because Plaid cannot
 * present a Supabase JWT. Its authentication is signature verification against
 * Plaid's published keys — see webhook-verifier.ts. Nothing in the payload is
 * trusted until that passes.
 *
 * NOT browser-accessible: no CORS headers are emitted, so a page cannot invoke
 * it even if it somehow forged a signature.
 */

type WebhookPayload = {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  error?: { error_code?: string; error_message?: string } | null;
  new_transactions?: number;
  removed_transactions?: string[];
  consent_expiration_time?: string;
};

Deno.serve(
  createHandler(
    { functionName: 'plaid-webhook', browserAccessible: false },
    async ({ request, requestId, logger }) => {
      // The RAW body text is required: the signature covers these exact bytes,
      // and re-serialising a parsed object would not reproduce them.
      const rawBody = await request.text();
      const plaid = new PlaidClient(logger);

      await verifyPlaidWebhook({
        verificationHeader: request.headers.get('Plaid-Verification'),
        rawBody,
        plaid,
        logger,
      });

      let payload: WebhookPayload;
      try {
        payload = JSON.parse(rawBody) as WebhookPayload;
      } catch {
        throw AppError.invalidRequest('Webhook body was not valid JSON.');
      }

      const webhookType = payload.webhook_type ?? 'UNKNOWN';
      const webhookCode = payload.webhook_code ?? 'UNKNOWN';

      // Safe metadata only. The payload can contain transaction identifiers
      // and error text; none of it is logged wholesale.
      logger.info('Webhook received', { webhookType, webhookCode });

      if (!payload.item_id) {
        return { received: true, handled: false, reason: 'NO_ITEM_ID' };
      }

      const client = createAdminClient();
      const items = new ItemRepository(client);
      const item = await items.findByPlaidItemId(payload.item_id);

      if (!item) {
        // An Item we do not know about — most often one already disconnected.
        // Acknowledged so Plaid stops retrying.
        logger.warn('Webhook for unknown item', { webhookType, webhookCode });
        return { received: true, handled: false, reason: 'UNKNOWN_ITEM' };
      }

      await items.markWebhookReceived(item.id);

      const scopedLogger = logger.child({ userId: item.userId, itemId: item.id });
      const syncRuns = new SyncRunRepository(client, scopedLogger);
      const startedAt = Date.now();
      const runId = await syncRuns.start({
        userId: item.userId,
        itemId: item.id,
        operation: 'WEBHOOK',
        requestId,
        metadata: { webhookType, webhookCode },
      });

      try {
        const handled = await handleWebhook({
          webhookType,
          webhookCode,
          payload,
          item,
          items,
          client,
          plaid,
          logger: scopedLogger,
          requestId,
        });

        await syncRuns.finish(runId, {
          status: 'SUCCESS',
          startedAt,
          metadata: { webhookType, webhookCode, handled },
        });

        return { received: true, handled };
      } catch (error) {
        const appError = error instanceof AppError ? error : null;

        await syncRuns.finish(runId, {
          status: 'FAILED',
          startedAt,
          errorCode: appError?.code ?? 'INTERNAL_ERROR',
          errorMessage: appError?.message ?? 'Webhook handling failed.',
          metadata: { webhookType, webhookCode },
        });

        // Acknowledged with a 200 anyway. Plaid retries failures, and a sync
        // error is not something a retry will fix — the next webhook or the
        // scheduled job will pick the work up. Returning 500 here would just
        // produce a retry storm.
        scopedLogger.error('Webhook handling failed', {
          webhookType,
          webhookCode,
          code: appError?.code ?? 'INTERNAL_ERROR',
        });

        return { received: true, handled: false, reason: 'HANDLER_FAILED' };
      }
    },
  ),
);

type HandlerInput = {
  webhookType: string;
  webhookCode: string;
  payload: WebhookPayload;
  item: PlaidItemRecord;
  items: ItemRepository;
  client: SupabaseClient;
  plaid: PlaidClient;
  logger: Logger;
  requestId: string;
};

async function handleWebhook(input: HandlerInput): Promise<boolean> {
  const { webhookType, webhookCode, item } = input;

  if (webhookType === 'TRANSACTIONS') {
    switch (webhookCode) {
      // The modern, cursor-based notification. The legacy codes below are
      // still emitted by some institutions and mean the same thing to us:
      // run an incremental sync.
      case 'SYNC_UPDATES_AVAILABLE':
      case 'INITIAL_UPDATE':
      case 'HISTORICAL_UPDATE':
      case 'DEFAULT_UPDATE':
      case 'TRANSACTIONS_REMOVED': {
        const service = new TransactionSyncService(input.client, input.plaid, input.logger);
        // The cursor is re-read from the database rather than trusting the
        // in-memory copy, so concurrent webhooks converge instead of racing.
        const fresh = await input.items.findByPlaidItemId(item.plaidItemId);
        await service.syncItem({
          userId: item.userId,
          item: fresh ?? item,
          requestId: input.requestId,
        });
        return true;
      }
      default:
        return false;
    }
  }

  if (webhookType === 'ITEM') {
    switch (webhookCode) {
      case 'ERROR': {
        const errorCode = input.payload.error?.error_code ?? 'ITEM_ERROR';
        const requiresReauth =
          errorCode === 'ITEM_LOGIN_REQUIRED' || errorCode === 'ITEM_LOCKED';

        await input.items.markError(item.id, {
          status: requiresReauth ? 'LOGIN_REQUIRED' : 'ERROR',
          errorCode,
          errorMessage: requiresReauth
            ? 'Your bank needs you to sign in again before data can update.'
            : 'Your bank reported a problem with this connection.',
        });
        return true;
      }

      case 'PENDING_EXPIRATION':
      case 'PENDING_DISCONNECT': {
        await input.items.markError(item.id, {
          status: 'PENDING_EXPIRATION',
          errorCode: webhookCode,
          errorMessage: 'Your consent for this connection is expiring. Reconnect to keep it active.',
        });
        return true;
      }

      case 'USER_PERMISSION_REVOKED':
      case 'USER_ACCOUNT_REVOKED': {
        await input.items.markError(item.id, {
          status: 'REVOKED',
          errorCode: webhookCode,
          errorMessage: 'Access to this institution was revoked. Reconnect to resume syncing.',
        });
        return true;
      }

      case 'LOGIN_REPAIRED':
      case 'NEW_ACCOUNTS_AVAILABLE': {
        const service = new AccountSyncService(input.client, input.plaid, input.logger);
        await service.syncItem({ userId: item.userId, item, requestId: input.requestId });
        return true;
      }

      default:
        return false;
    }
  }

  return false;
}
