import { authenticateRequest, createAdminClient } from '../_shared/auth/authenticate.ts';
import { createHandler, parseJsonBody } from '../_shared/http/handler.ts';
import { PlaidClient } from '../_shared/plaid/client.ts';
import { ConnectionService } from '../_shared/services/connection-service.ts';
import { itemIdSchema, validate } from '../_shared/validation/schemas.ts';

/**
 * Disconnects an institution.
 *
 * Releases the Item at Plaid and destroys the stored credential. Accounts and
 * transactions are retained — a disconnect is not a request to erase the
 * user's financial history.
 */
Deno.serve(
  createHandler(
    { functionName: 'plaid-remove-item', browserAccessible: true },
    async ({ request, requestId, logger }) => {
      const user = await authenticateRequest(request);
      const body = validate(itemIdSchema, await parseJsonBody(request));

      const scopedLogger = logger.child({ userId: user.id });
      const service = new ConnectionService(
        createAdminClient(),
        new PlaidClient(scopedLogger),
        scopedLogger,
      );

      return await service.removeItem({
        userId: user.id,
        itemId: body.plaidItemId,
        requestId,
      });
    },
  ),
);
