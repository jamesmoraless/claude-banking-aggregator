import { z } from 'zod';

/**
 * The complete set of capabilities Atlas AI has.
 *
 * Claude receives this list and nothing else. It has no database connection, no
 * SQL capability, no Plaid credentials and no way to reach anything not
 * enumerated here. Every tool is implemented server-side and scoped to the
 * authenticated user, so a tool call cannot reach another user's data even if
 * the model asked it to.
 *
 * Each tool carries two schemas:
 *   - `inputSchema`, the JSON Schema Anthropic needs to construct calls
 *   - `argsSchema`, a Zod schema that validates what actually arrives
 *
 * They are written separately on purpose. The JSON Schema is a hint to the
 * model; the Zod schema is the enforcement. Deriving one from the other would
 * blur that line, and the model's arguments are untrusted input.
 */

export type ToolCategory = 'READ' | 'PRIVILEGED';

export type ToolDefinition = {
  name: string;
  description: string;
  /**
   * READ tools are cheap and side-effect free. PRIVILEGED tools call Plaid and
   * cost real time and rate limit, so the executor caps how often the model may
   * invoke them in a single conversation.
   */
  category: ToolCategory;
  inputSchema: Record<string, unknown>;
  argsSchema: z.ZodType<unknown>;
};

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in yyyy-MM-dd format');

const emptyObject = { type: 'object', properties: {}, additionalProperties: false } as const;

const dateRangeProperties = {
  from: { type: 'string', description: 'Start date, inclusive, as yyyy-MM-dd' },
  to: { type: 'string', description: 'End date, inclusive, as yyyy-MM-dd' },
} as const;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_cash_summary',
    description:
      'Total liquid cash, split into checking and savings, with account counts and when the balances were last synced. Use for "how much cash do I have?".',
    category: 'READ',
    inputSchema: emptyObject,
    argsSchema: z.object({}).passthrough(),
  },
  {
    name: 'get_accounts',
    description:
      'Lists the user\'s accounts with balances, institution and connection status. Use for "which accounts do I have?" or to find an account id for another tool.',
    category: 'READ',
    inputSchema: {
      type: 'object',
      properties: {
        institutionName: { type: 'string', description: 'Filter to one institution by name' },
        accountType: {
          type: 'string',
          enum: ['depository', 'credit', 'investment', 'loan', 'other'],
          description: 'Filter by Plaid account type',
        },
        includeHidden: { type: 'boolean', description: 'Include accounts the user hid' },
      },
      additionalProperties: false,
    },
    argsSchema: z.object({
      institutionName: z.string().max(200).optional(),
      accountType: z.enum(['depository', 'credit', 'investment', 'loan', 'other']).optional(),
      includeHidden: z.boolean().optional(),
    }),
  },
  {
    name: 'get_account_details',
    description: 'Full detail for one account, including available balance and last sync time.',
    category: 'READ',
    inputSchema: {
      type: 'object',
      properties: { accountId: { type: 'string', description: 'Account id from get_accounts' } },
      required: ['accountId'],
      additionalProperties: false,
    },
    argsSchema: z.object({ accountId: z.string().uuid() }),
  },
  {
    name: 'get_monthly_cashflow',
    description:
      'Actual income, actual spending, surplus and savings rate for one month, with every exclusion broken out. This is the canonical monthly figure — the same one the dashboard shows.',
    category: 'READ',
    inputSchema: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: 'Four-digit year' },
        month: { type: 'integer', description: 'Month number, 1-12' },
      },
      required: ['year', 'month'],
      additionalProperties: false,
    },
    argsSchema: z.object({
      year: z.number().int().min(2000).max(2100),
      month: z.number().int().min(1).max(12),
    }),
  },
  {
    name: 'get_cashflow_range',
    description:
      'Monthly income and spending across a date range. Use for trends, or for "how has my spending changed over six months?".',
    category: 'READ',
    inputSchema: {
      type: 'object',
      properties: dateRangeProperties,
      required: ['from', 'to'],
      additionalProperties: false,
    },
    argsSchema: z.object({ from: dateSchema, to: dateSchema }),
  },
  {
    name: 'get_spending_by_category',
    description: 'Spending grouped by category for a date range, net of refunds in that category.',
    category: 'READ',
    inputSchema: {
      type: 'object',
      properties: dateRangeProperties,
      required: ['from', 'to'],
      additionalProperties: false,
    },
    argsSchema: z.object({ from: dateSchema, to: dateSchema }),
  },
  {
    name: 'get_income_breakdown',
    description: 'Income grouped by source for a date range.',
    category: 'READ',
    inputSchema: {
      type: 'object',
      properties: dateRangeProperties,
      required: ['from', 'to'],
      additionalProperties: false,
    },
    argsSchema: z.object({ from: dateSchema, to: dateSchema }),
  },
  {
    name: 'get_transfer_summary',
    description:
      'Everything deliberately excluded from spending in a period, grouped by reason: internal transfers, credit card payments, investment transfers, refunds.',
    category: 'READ',
    inputSchema: {
      type: 'object',
      properties: dateRangeProperties,
      required: ['from', 'to'],
      additionalProperties: false,
    },
    argsSchema: z.object({ from: dateSchema, to: dateSchema }),
  },
  {
    name: 'search_transactions',
    description:
      'Finds transactions using structured filters. Does NOT accept SQL. Use for "what did I spend at X?" or "show me transactions over $500".',
    category: 'READ',
    inputSchema: {
      type: 'object',
      properties: {
        ...dateRangeProperties,
        searchText: { type: 'string', description: 'Matches merchant name or description' },
        category: { type: 'string', description: 'Plaid primary category, e.g. FOOD_AND_DRINK' },
        minAmount: { type: 'number', description: 'Minimum transaction size, unsigned' },
        maxAmount: { type: 'number', description: 'Maximum transaction size, unsigned' },
        accountId: { type: 'string', description: 'Restrict to one account' },
        classification: {
          type: 'string',
          enum: ['INCOME', 'EXPENSE', 'REFUND', 'TRANSFER', 'ADJUSTMENT', 'UNKNOWN'],
        },
        limit: { type: 'integer', description: 'Maximum rows to return, up to 50' },
      },
      additionalProperties: false,
    },
    argsSchema: z.object({
      from: dateSchema.optional(),
      to: dateSchema.optional(),
      searchText: z.string().max(200).optional(),
      category: z.string().max(100).optional(),
      minAmount: z.number().nonnegative().optional(),
      maxAmount: z.number().nonnegative().optional(),
      accountId: z.string().uuid().optional(),
      classification: z
        .enum(['INCOME', 'EXPENSE', 'REFUND', 'TRANSFER', 'ADJUSTMENT', 'UNKNOWN'])
        .optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
  },
  {
    name: 'get_largest_transactions',
    description: 'The biggest transactions in a period, optionally filtered by classification.',
    category: 'READ',
    inputSchema: {
      type: 'object',
      properties: {
        ...dateRangeProperties,
        classification: {
          type: 'string',
          enum: ['INCOME', 'EXPENSE', 'REFUND', 'TRANSFER', 'ADJUSTMENT', 'UNKNOWN'],
        },
        limit: { type: 'integer', description: 'Maximum rows, up to 25' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    argsSchema: z.object({
      from: dateSchema,
      to: dateSchema,
      classification: z
        .enum(['INCOME', 'EXPENSE', 'REFUND', 'TRANSFER', 'ADJUSTMENT', 'UNKNOWN'])
        .optional(),
      limit: z.number().int().min(1).max(25).optional(),
    }),
  },
  {
    name: 'get_top_merchants',
    description: 'Merchants ranked by actual spending in a period, net of refunds.',
    category: 'READ',
    inputSchema: {
      type: 'object',
      properties: { ...dateRangeProperties, limit: { type: 'integer', description: 'Up to 25' } },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    argsSchema: z.object({
      from: dateSchema,
      to: dateSchema,
      limit: z.number().int().min(1).max(25).optional(),
    }),
  },
  {
    name: 'compare_periods',
    description:
      'Compares income, spending, surplus and savings rate between two periods. Use for "July vs June".',
    category: 'READ',
    inputSchema: {
      type: 'object',
      properties: {
        periodAFrom: { type: 'string', description: 'First period start, yyyy-MM-dd' },
        periodATo: { type: 'string', description: 'First period end, yyyy-MM-dd' },
        periodBFrom: { type: 'string', description: 'Second period start, yyyy-MM-dd' },
        periodBTo: { type: 'string', description: 'Second period end, yyyy-MM-dd' },
      },
      required: ['periodAFrom', 'periodATo', 'periodBFrom', 'periodBTo'],
      additionalProperties: false,
    },
    argsSchema: z.object({
      periodAFrom: dateSchema,
      periodATo: dateSchema,
      periodBFrom: dateSchema,
      periodBTo: dateSchema,
    }),
  },
  {
    name: 'explain_monthly_spending',
    description:
      'The full derivation of actual spending for a month: gross debits, each exclusion, refunds, and the result. Use whenever the user asks how a spending figure was arrived at.',
    category: 'READ',
    inputSchema: {
      type: 'object',
      properties: {
        year: { type: 'integer' },
        month: { type: 'integer', description: '1-12' },
      },
      required: ['year', 'month'],
      additionalProperties: false,
    },
    argsSchema: z.object({
      year: z.number().int().min(2000).max(2100),
      month: z.number().int().min(1).max(12),
    }),
  },
  {
    name: 'get_data_freshness',
    description:
      'When each institution last synced, and which need reconnecting. Call this before implying data is current.',
    category: 'READ',
    inputSchema: emptyObject,
    argsSchema: z.object({}).passthrough(),
  },
  {
    name: 'refresh_accounts',
    description:
      'Fetches current balances from the user\'s banks. Slow and rate-limited — only use when the user explicitly asks to refresh, or when data is clearly stale.',
    category: 'PRIVILEGED',
    inputSchema: emptyObject,
    argsSchema: z.object({}).passthrough(),
  },
  {
    name: 'refresh_transactions',
    description:
      'Imports the latest transactions from the user\'s banks. Slow and rate-limited — only use when the user explicitly asks, or when data is clearly stale.',
    category: 'PRIVILEGED',
    inputSchema: emptyObject,
    argsSchema: z.object({}).passthrough(),
  },
];

export const TOOLS_BY_NAME = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

/** The tool list in the shape the Anthropic Messages API expects. */
export function toAnthropicTools(): { name: string; description: string; input_schema: unknown }[] {
  return TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}
