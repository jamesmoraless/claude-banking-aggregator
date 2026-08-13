import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type AnthropicClient,
  type AnthropicMessage,
  type ContentBlock,
  type ToolUseContent,
} from '../anthropic/client.ts';
import { AppError } from '../errors/app-error.ts';
import type { Logger } from '../logging/logger.ts';

import { type ChatBlock, toolResultToBlocks } from './blocks.ts';
import { toAnthropicTools } from './tool-definitions.ts';
import { FinanceToolExecutor, type ToolResult } from './tool-executor.ts';

/**
 * Orchestrates one Chat turn.
 *
 * Claude decides which tools to call; this executes them server-side, feeds the
 * results back, and repeats until the model produces a final answer. The loop
 * is bounded so a model that keeps calling tools cannot run indefinitely.
 *
 * The response the browser receives is deliberately two-part:
 *   - `blocks` — structured, built from tool DATA, never from model output
 *   - prose — Claude's own words, rendered as text
 *
 * Nothing Claude writes can become a metric card or a chart value.
 */

const MAX_ITERATIONS = 6;

export type ChatTurnResult = {
  blocks: ChatBlock[];
  toolsUsed: string[];
  /** Reported so the UI can say how current the answer is. */
  dataAsOf: string;
  usage: { inputTokens: number; outputTokens: number };
};

const SYSTEM_PROMPT = `You are Atlas AI, the assistant inside Cash Atlas — a personal finance application.

You answer questions about the user's own financial data by calling the tools provided. You have no other access to their data: you cannot run queries, and you cannot see anything a tool has not returned.

## How Cash Atlas thinks about money

"Actual spending" excludes money that moved without being spent:
- transfers between the user's own accounts
- payments to credit cards whose purchases are already counted
- contributions to investments
Refunds reduce spending rather than counting as income.

When a user asks what they spent, they mean actual spending. Use get_monthly_cashflow or get_cashflow_range, not raw transaction sums.

## Rules you must follow

1. NEVER state a financial figure you have not obtained from a tool. If you do not have the data, call a tool or say you cannot answer. Do not estimate, extrapolate or reason your way to an amount.

2. The figures you quote are rendered separately as structured cards and charts. Your prose should interpret and explain them — say what the numbers mean, what changed, what stands out. Do not exhaustively restate every number; the user can see them.

3. Data is synchronised from the user's banks on a delay. Never imply it is live. If freshness is relevant — or the user asks about very recent activity — call get_data_freshness and say when the data was last updated.

4. If a tool reports no data, say so plainly. A user with nothing synchronised should be told to connect an institution or refresh, not given a zero.

5. If explain_monthly_spending reports balances: false, tell the user the figures do not reconcile and suggest they report it. Do not paper over it.

6. If transactions could not be classified, mention it: the spending figure is provisional until they are reviewed.

7. refresh_accounts and refresh_transactions contact the user's banks. They are slow and rate-limited. Only use them when the user explicitly asks to refresh, or when data is clearly too stale to answer with.

8. Today's date is provided below. Use it to resolve relative periods like "last month" or "this year".

## Tone

Direct and concise. You are talking to someone about their own money — be precise, never breezy, and never congratulatory about figures you have not been asked to judge.`;

export class ChatService {
  constructor(
    private readonly anthropic: AnthropicClient,
    private readonly userClient: SupabaseClient,
    private readonly adminClient: SupabaseClient,
    private readonly userId: string,
    private readonly logger: Logger,
    private readonly requestId: string,
  ) {}

  async run(history: { role: 'user' | 'assistant'; content: string }[]): Promise<ChatTurnResult> {
    const executor = new FinanceToolExecutor(
      this.userClient,
      this.adminClient,
      this.userId,
      this.logger,
      this.requestId,
    );

    const messages: AnthropicMessage[] = history.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const tools = toAnthropicTools();
    const system = `${SYSTEM_PROMPT}\n\nToday's date is ${new Date().toISOString().slice(0, 10)}.`;

    const blocks: ChatBlock[] = [];
    const toolsUsed: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
      const response = await this.anthropic.createMessage({ system, messages, tools });

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;

      const textParts = response.content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text.trim())
        .filter((part) => part.length > 0);

      const toolCalls = response.content.filter(
        (part): part is ToolUseContent => part.type === 'tool_use',
      );

      // Prose arrives before the blocks it introduces, matching how the model
      // wrote it.
      for (const part of textParts) blocks.push({ type: 'text', text: part });

      if (toolCalls.length === 0 || response.stop_reason !== 'tool_use') {
        return {
          blocks: dedupeAdjacentText(blocks),
          toolsUsed,
          dataAsOf: new Date().toISOString(),
          usage: { inputTokens, outputTokens },
        };
      }

      // Tools within one turn are independent, so they run concurrently.
      const results = await Promise.all(
        toolCalls.map(async (call) => ({
          call,
          result: await executor.execute(call.name, call.input),
        })),
      );

      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: results.map(({ call, result }) => toToolResultContent(call, result)),
      });

      for (const { call, result } of results) {
        toolsUsed.push(call.name);
        blocks.push(...toolResultToBlocks(result));
      }
    }

    // The model kept calling tools without concluding. Everything gathered so
    // far is real, so it is returned with an honest caveat rather than thrown
    // away.
    this.logger.warn('Chat turn hit the iteration limit', { toolsUsed });

    blocks.push({
      type: 'alert',
      variant: 'warning',
      message:
        'This question needed more steps than Atlas AI allows in one turn. The figures above are accurate; try asking something more specific.',
    });

    return {
      blocks: dedupeAdjacentText(blocks),
      toolsUsed,
      dataAsOf: new Date().toISOString(),
      usage: { inputTokens, outputTokens },
    };
  }
}

function toToolResultContent(call: ToolUseContent, result: ToolResult): ContentBlock {
  return {
    type: 'tool_result',
    tool_use_id: call.id,
    content: JSON.stringify(result.ok ? result.data : { error: result.error }),
    ...(result.ok ? {} : { is_error: true }),
  };
}

/** Merges consecutive text blocks so the transcript does not read as fragments. */
function dedupeAdjacentText(blocks: ChatBlock[]): ChatBlock[] {
  const merged: ChatBlock[] = [];

  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (block.type === 'text' && previous?.type === 'text') {
      previous.text = `${previous.text}\n\n${block.text}`;
      continue;
    }
    merged.push(block);
  }

  if (merged.length === 0) {
    throw AppError.internal('Chat produced no content');
  }

  return merged;
}
