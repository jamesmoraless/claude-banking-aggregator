import { AnthropicClient } from '../_shared/anthropic/client.ts';
import {
  authenticateRequest,
  createAdminClient,
  createUserScopedClient,
} from '../_shared/auth/authenticate.ts';
import { isAnthropicConfigured } from '../_shared/config/env.ts';
import { AppError } from '../_shared/errors/app-error.ts';
import { ChatService } from '../_shared/finance/chat-service.ts';
import { createHandler, parseJsonBody } from '../_shared/http/handler.ts';
import { chatRequestSchema, validate } from '../_shared/validation/schemas.ts';

/**
 * Atlas AI.
 *
 * Claude answers questions about the user's finances using a fixed set of
 * server-executed tools. It receives no database access, no SQL capability and
 * no credentials — see _shared/finance/tool-definitions.ts for the complete
 * list of what it can do.
 *
 * Reads run on a client scoped to the caller, so Row Level Security applies to
 * every tool query. The service-role client is passed separately and used only
 * by the refresh tools, which need the encrypted Plaid credentials.
 */
Deno.serve(
  createHandler(
    { functionName: 'finance-chat', browserAccessible: true },
    async ({ request, requestId, logger }) => {
      const user = await authenticateRequest(request);

      // Checked before doing any work, so a missing key produces a clear
      // configuration state rather than a generic failure mid-conversation.
      if (!isAnthropicConfigured()) {
        throw new AppError(
          'CHAT_UNAVAILABLE',
          'Atlas AI is not configured yet. Add ANTHROPIC_API_KEY to your Supabase Edge Function secrets — see MANUAL_SETUP.md.',
        );
      }

      const body = validate(chatRequestSchema, await parseJsonBody(request));
      const scopedLogger = logger.child({ userId: user.id });

      const service = new ChatService(
        new AnthropicClient(scopedLogger),
        createUserScopedClient(request),
        createAdminClient(),
        user.id,
        scopedLogger,
        requestId,
      );

      const result = await service.run(body.messages);

      scopedLogger.info('Chat turn complete', {
        toolsUsed: result.toolsUsed,
        blockCount: result.blocks.length,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });

      return {
        blocks: result.blocks,
        toolsUsed: result.toolsUsed,
        dataAsOf: result.dataAsOf,
      };
    },
  ),
);
