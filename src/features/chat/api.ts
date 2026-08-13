import { EdgeFunctionError } from '@/features/connections/api';
import { requireSupabase } from '@/lib/supabase/client';

import type { ChatResponse } from './types';

/**
 * Chat data access.
 *
 * One call to the `finance-chat` Edge Function. Everything else — Anthropic,
 * tool execution, database queries — happens server-side. The browser never
 * holds the Anthropic key and never sees a tool definition.
 */
export async function sendChatMessage(
  messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<ChatResponse> {
  const supabase = requireSupabase();

  const response = (await supabase.functions.invoke<ChatResponse>('finance-chat', {
    body: { messages },
  })) as { data: ChatResponse | null; error: Error | null };

  if (response.error) {
    const context = (response.error as { context?: Response }).context;

    if (context && typeof context.json === 'function') {
      try {
        const envelope = (await context.clone().json()) as {
          error?: { code?: string; message?: string; requestId?: string };
        };
        if (envelope.error) {
          throw new EdgeFunctionError(
            envelope.error.code ?? 'CHAT_ERROR',
            envelope.error.message ?? 'Atlas AI could not answer that.',
            envelope.error.requestId,
          );
        }
      } catch (parseError) {
        if (parseError instanceof EdgeFunctionError) throw parseError;
      }
    }

    if (context?.status === 404) {
      throw new EdgeFunctionError(
        'EDGE_FUNCTION_NOT_DEPLOYED',
        'The finance-chat function is not deployed. Run "supabase functions deploy finance-chat" — see MANUAL_SETUP.md.',
      );
    }

    throw new EdgeFunctionError('CHAT_ERROR', response.error.message);
  }

  if (!response.data) {
    throw new EdgeFunctionError('EMPTY_RESPONSE', 'Atlas AI returned an empty response.');
  }

  return response.data;
}
