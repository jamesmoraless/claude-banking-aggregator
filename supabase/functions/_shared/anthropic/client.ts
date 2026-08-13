import { type AnthropicConfig, getAnthropicConfig } from '../config/env.ts';
import { AppError } from '../errors/app-error.ts';
import type { Logger } from '../logging/logger.ts';

/**
 * Anthropic Messages API client.
 *
 * A thin typed wrapper over the REST API. The key is attached here and nowhere
 * else, and never appears in a response or a log line.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 60_000;

export type TextContent = { type: 'text'; text: string };
export type ToolUseContent = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ToolResultContent = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type ContentBlock = TextContent | ToolUseContent | ToolResultContent;

export type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
};

export type AnthropicResponse = {
  id: string;
  role: 'assistant';
  content: (TextContent | ToolUseContent)[];
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  usage: { input_tokens: number; output_tokens: number };
};

export class AnthropicClient {
  private readonly config: AnthropicConfig;

  constructor(
    private readonly logger: Logger,
    config?: AnthropicConfig,
  ) {
    this.config = config ?? getAnthropicConfig();
  }

  get model(): string {
    return this.config.model;
  }

  async createMessage(input: {
    system: string;
    messages: AnthropicMessage[];
    tools: { name: string; description: string; input_schema: unknown }[];
  }): Promise<AnthropicResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          system: input.system,
          messages: input.messages,
          tools: input.tools,
        }),
        signal: controller.signal,
      });

      const text = await response.text();

      if (!response.ok) {
        // Anthropic's error body can echo request content; it is logged, not
        // returned.
        this.logger.error('Anthropic request failed', {
          status: response.status,
          detail: text.slice(0, 500),
        });

        if (response.status === 429) {
          throw new AppError(
            'ANTHROPIC_RATE_LIMIT',
            'Atlas AI is busy right now. Please try again in a moment.',
          );
        }
        if (response.status === 401 || response.status === 403) {
          throw new AppError(
            'CHAT_UNAVAILABLE',
            'Atlas AI is not configured correctly. Check ANTHROPIC_API_KEY in your Supabase secrets.',
          );
        }
        throw new AppError(
          'ANTHROPIC_ERROR',
          'Atlas AI could not answer that right now. Please try again.',
          `status=${response.status}`,
        );
      }

      return JSON.parse(text) as AnthropicResponse;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError('TIMEOUT', 'Atlas AI took too long to respond. Please try again.');
      }
      throw new AppError(
        'ANTHROPIC_ERROR',
        'Atlas AI could not be reached. Please try again.',
        String(error),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
