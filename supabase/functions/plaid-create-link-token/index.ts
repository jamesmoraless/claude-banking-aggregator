import { authenticateRequest, createAdminClient } from '../_shared/auth/authenticate.ts';
import { createHandler } from '../_shared/http/handler.ts';
import { PlaidClient } from '../_shared/plaid/client.ts';
import { ConnectionService } from '../_shared/services/connection-service.ts';

/**
 * Creates a Plaid Link token.
 *
 * The browser cannot do this: it requires PLAID_SECRET. The response contains
 * the short-lived link token and nothing else.
 */
Deno.serve(
  createHandler(
    { functionName: 'plaid-create-link-token', browserAccessible: true },
    async ({ request, requestId, logger }) => {
      const user = await authenticateRequest(request);

      const service = new ConnectionService(
        createAdminClient(),
        new PlaidClient(logger),
        logger.child({ userId: user.id }),
      );

      const result = await service.createLinkToken(user.id);

      logger.info('Link token created', { userId: user.id, requestId });
      return result;
    },
  ),
);
