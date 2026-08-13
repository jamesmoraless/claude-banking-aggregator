import { authenticateRequest, createAdminClient } from '../_shared/auth/authenticate.ts';
import { createHandler, parseJsonBody } from '../_shared/http/handler.ts';
import { PlaidClient } from '../_shared/plaid/client.ts';
import { ConnectionService } from '../_shared/services/connection-service.ts';
import { exchangePublicTokenSchema, validate } from '../_shared/validation/schemas.ts';

/**
 * Completes Plaid Link.
 *
 *   public_token → access_token → encrypted storage → account sync →
 *   transaction sync → normalisation
 *
 * The access token never appears in the response. Neither does the public
 * token appear in any log — both are redacted by the logger regardless.
 */
Deno.serve(
  createHandler(
    { functionName: 'plaid-exchange-public-token', browserAccessible: true },
    async ({ request, requestId, logger }) => {
      const user = await authenticateRequest(request);
      const body = validate(exchangePublicTokenSchema, await parseJsonBody(request));

      const scopedLogger = logger.child({ userId: user.id });

      const service = new ConnectionService(
        createAdminClient(),
        new PlaidClient(scopedLogger),
        scopedLogger,
      );

      const result = await service.exchangePublicToken({
        userId: user.id,
        publicToken: body.publicToken,
        institutionId: body.institutionId ?? null,
        institutionName: body.institutionName ?? null,
        requestId,
      });

      scopedLogger.info('Institution connected', {
        accountsAdded: result.accountsAdded,
        transactionsAdded: result.transactionsAdded,
        wasExistingItem: result.wasExistingItem,
      });

      return result;
    },
  ),
);
