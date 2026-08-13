import { authenticateRequest, createAdminClient } from '../_shared/auth/authenticate.ts';
import { createHandler, parseJsonBody } from '../_shared/http/handler.ts';
import { PlaidClient } from '../_shared/plaid/client.ts';
import { ConnectionService } from '../_shared/services/connection-service.ts';
import { optionalItemIdSchema, validate } from '../_shared/validation/schemas.ts';

/**
 * User-triggered refresh.
 *
 * Refreshes accounts then transactions for one Item, or for all of them.
 * Reports per-Item outcomes so the UI can show "TD synced, RBC needs
 * reconnecting" instead of collapsing everything into a single failure.
 */
Deno.serve(
  createHandler(
    { functionName: 'plaid-refresh', browserAccessible: true },
    async ({ request, requestId, logger }) => {
      const user = await authenticateRequest(request);
      const body = validate(optionalItemIdSchema, await parseJsonBody(request));

      const scopedLogger = logger.child({ userId: user.id });
      const service = new ConnectionService(
        createAdminClient(),
        new PlaidClient(scopedLogger),
        scopedLogger,
      );

      return await service.refresh({
        userId: user.id,
        itemId: body.plaidItemId ?? null,
        requestId,
      });
    },
  ),
);
