import { authenticateRequest, createAdminClient } from '../_shared/auth/authenticate.ts';
import { createHandler, parseJsonBody } from '../_shared/http/handler.ts';
import { PlaidClient } from '../_shared/plaid/client.ts';
import { ConnectionService } from '../_shared/services/connection-service.ts';
import { itemIdSchema, validate } from '../_shared/validation/schemas.ts';

/**
 * Creates an update-mode Link token, used when an Item needs re-authentication.
 *
 * Update mode re-authenticates the existing Item, preserving account ids,
 * transaction history and the sync cursor.
 */
Deno.serve(
  createHandler(
    { functionName: 'plaid-create-update-link-token', browserAccessible: true },
    async ({ request, logger }) => {
      const user = await authenticateRequest(request);
      const body = validate(itemIdSchema, await parseJsonBody(request));

      const service = new ConnectionService(
        createAdminClient(),
        new PlaidClient(logger),
        logger.child({ userId: user.id }),
      );

      // Ownership of the Item is verified inside the service before its access
      // token is ever loaded.
      return await service.createUpdateLinkToken(user.id, body.plaidItemId);
    },
  ),
);
