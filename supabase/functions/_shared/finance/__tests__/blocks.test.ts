import { describe, expect, it } from 'vitest';

import { type ChatBlock, toolResultToBlocks } from '../blocks.ts';
import { TOOL_DEFINITIONS, TOOLS_BY_NAME, toAnthropicTools } from '../tool-definitions.ts';
import type { ToolResult } from '../tool-result.ts';

function result(toolName: string, data: unknown, ok = true): ToolResult {
  return { toolName, ok, data };
}

function findBlock<T extends ChatBlock['type']>(
  blocks: ChatBlock[],
  type: T,
): Extract<ChatBlock, { type: T }> | undefined {
  return blocks.find((block): block is Extract<ChatBlock, { type: T }> => block.type === type);
}

/**
 * These tests pin the property that makes Atlas AI trustworthy: every figure
 * the user sees is built from tool DATA, never from model output. If this
 * mapping is wrong, the assistant shows a number the database did not produce.
 */
describe('toolResultToBlocks', () => {
  it('renders nothing for a failed tool', () => {
    // A failure is explained in Claude's prose, not shown as an empty chart.
    expect(toolResultToBlocks({ toolName: 'get_cash_summary', ok: false, data: null })).toEqual([]);
  });

  it('renders nothing for an unrecognised tool', () => {
    expect(toolResultToBlocks(result('some_future_tool', { value: 1 }))).toEqual([]);
  });

  describe('get_cash_summary', () => {
    it('builds metric cards from the returned figures', () => {
      const blocks = toolResultToBlocks(
        result('get_cash_summary', {
          hasData: true,
          currency: 'CAD',
          total_cash: 54281,
          checking_total: 18841,
          savings_total: 35440,
          credit_owed_total: 7210,
          excluded_account_count: 0,
          excluded_currencies: [],
        }),
      );

      const grid = findBlock(blocks, 'metric_grid');
      expect(grid?.metrics.find((metric) => metric.label === 'Total Cash')?.value).toBe(54281);
      expect(grid?.metrics.find((metric) => metric.label === 'Checking')?.value).toBe(18841);
      expect(grid?.metrics.every((metric) => metric.currency === 'CAD')).toBe(true);
    });

    it('warns when accounts were excluded for currency reasons', () => {
      const blocks = toolResultToBlocks(
        result('get_cash_summary', {
          hasData: true,
          currency: 'CAD',
          total_cash: 1000,
          excluded_account_count: 2,
          excluded_currencies: ['USD'],
        }),
      );

      const alert = findBlock(blocks, 'alert');
      expect(alert?.variant).toBe('warning');
      expect(alert?.message).toContain('2 accounts');
      expect(alert?.message).toContain('USD');
    });

    it('says there is no data rather than showing zeroes', () => {
      const blocks = toolResultToBlocks(result('get_cash_summary', { hasData: false }));

      expect(findBlock(blocks, 'metric_grid')).toBeUndefined();
      expect(findBlock(blocks, 'alert')?.message).toContain('Connect a financial institution');
    });
  });

  describe('explain_monthly_spending', () => {
    const EXPLANATION = {
      hasData: true,
      month: '2026-07-01',
      currency: 'CAD',
      grossDebits: 15842,
      deductions: [
        { key: 'internal_transfers', label: 'Internal transfers', amount: 3210 },
        { key: 'credit_card_payments', label: 'Credit card payments', amount: 4712 },
        { key: 'investment_transfers', label: 'Investment transfers', amount: 1089 },
        { key: 'refunds', label: 'Applicable refunds', amount: 0 },
      ],
      actualSpending: 6831,
      balances: true,
      unclassifiedTransactionCount: 0,
    };

    it('builds a calculation whose deductions reconcile to the result', () => {
      const blocks = toolResultToBlocks(result('explain_monthly_spending', EXPLANATION));
      const calculation = findBlock(blocks, 'calculation');

      expect(calculation?.result.amount).toBe(6831);
      expect(calculation?.balances).toBe(true);

      const base = calculation!.lines.find((line) => line.operator === 'BASE')!;
      const deductions = calculation!.lines
        .filter((line) => line.operator === 'SUBTRACT')
        .reduce((sum, line) => sum + line.amount, 0);

      expect(base.amount - deductions).toBe(calculation!.result.amount);
    });

    it('keeps zero-value lines so the reader can see nothing was omitted', () => {
      const blocks = toolResultToBlocks(result('explain_monthly_spending', EXPLANATION));
      const calculation = findBlock(blocks, 'calculation');

      expect(calculation?.lines.some((line) => line.label === 'Applicable refunds')).toBe(true);
    });

    it('surfaces an imbalance rather than hiding it', () => {
      const blocks = toolResultToBlocks(
        result('explain_monthly_spending', { ...EXPLANATION, balances: false }),
      );

      const calculation = findBlock(blocks, 'calculation');
      expect(calculation?.balances).toBe(false);
      expect(calculation?.note).toContain('do not reconcile');
    });

    it('warns when unclassified transactions make the figure provisional', () => {
      const blocks = toolResultToBlocks(
        result('explain_monthly_spending', {
          ...EXPLANATION,
          unclassifiedTransactionCount: 3,
        }),
      );

      const alert = findBlock(blocks, 'alert');
      expect(alert?.variant).toBe('warning');
      expect(alert?.message).toContain('3 transactions');
    });
  });

  describe('get_cashflow_range', () => {
    it('charts actual income and actual spending', () => {
      const blocks = toolResultToBlocks(
        result('get_cashflow_range', {
          months: [
            { month_start: '2026-06-01', currency: 'CAD', actual_income: 9600, actual_spending: 6200 },
            { month_start: '2026-07-01', currency: 'CAD', actual_income: 10450, actual_spending: 6831 },
          ],
        }),
      );

      const chart = findBlock(blocks, 'bar_chart');
      expect(chart?.data).toHaveLength(2);
      expect(chart?.data[1]?.values.income).toBe(10450);
      expect(chart?.data[1]?.values.spending).toBe(6831);
    });

    it('renders nothing for an empty range', () => {
      expect(toolResultToBlocks(result('get_cashflow_range', { months: [] }))).toEqual([]);
    });
  });

  describe('search_transactions', () => {
    it('builds a table and reports truncation honestly', () => {
      const blocks = toolResultToBlocks(
        result('search_transactions', {
          transactions: [
            {
              id: 'tx-1',
              posted_date: '2026-07-15',
              display_name: 'Metro',
              account_name: 'Everyday Checking',
              absolute_amount: 82.14,
              currency: 'CAD',
              direction: 'OUTFLOW',
              effective_type: 'EXPENSE',
            },
          ],
          totalMatching: 214,
          truncated: true,
        }),
      );

      const table = findBlock(blocks, 'transaction_table');
      expect(table?.rows[0]?.amount).toBe(82.14);
      expect(table?.rows[0]?.direction).toBe('OUTFLOW');
      expect(table?.truncated).toBe(true);
      expect(table?.totalMatching).toBe(214);
    });
  });

  describe('get_data_freshness', () => {
    it('reports each institution, including ones needing reconnection', () => {
      const blocks = toolResultToBlocks(
        result('get_data_freshness', {
          institutions: [
            {
              institution_name: 'TD Canada Trust',
              last_successful_sync_at: '2026-08-13T12:00:00Z',
              requires_reauth: false,
            },
            { institution_name: 'RBC', last_successful_sync_at: null, requires_reauth: true },
          ],
        }),
      );

      const freshness = findBlock(blocks, 'freshness');
      expect(freshness?.institutions).toHaveLength(2);
      expect(freshness?.institutions[1]?.requiresReauth).toBe(true);
      expect(freshness?.institutions[1]?.syncedAt).toBeNull();
    });
  });

  describe('refresh tools', () => {
    it('reports a partial refresh naming the institution that failed', () => {
      const blocks = toolResultToBlocks(
        result('refresh_transactions', {
          overallStatus: 'PARTIAL',
          institutions: [
            { institutionName: 'TD', status: 'SUCCESS', transactionsAdded: 4 },
            { institutionName: 'RBC', status: 'FAILED', errorMessage: 'needs reconnecting' },
          ],
        }),
      );

      const alert = findBlock(blocks, 'alert');
      expect(alert?.variant).toBe('warning');
      expect(alert?.title).toContain('1 of 2');
      expect(alert?.message).toContain('RBC');
    });
  });
});

describe('tool definitions', () => {
  it('exposes every capability the specification requires', () => {
    const names = TOOL_DEFINITIONS.map((tool) => tool.name);

    for (const required of [
      'get_cash_summary',
      'get_accounts',
      'get_account_details',
      'get_monthly_cashflow',
      'get_cashflow_range',
      'get_spending_by_category',
      'get_income_breakdown',
      'get_transfer_summary',
      'search_transactions',
      'get_largest_transactions',
      'get_top_merchants',
      'compare_periods',
      'explain_monthly_spending',
      'get_data_freshness',
      'refresh_accounts',
      'refresh_transactions',
    ]) {
      expect(names).toContain(required);
    }
  });

  it('distinguishes privileged tools from cheap reads', () => {
    expect(TOOLS_BY_NAME.get('refresh_accounts')?.category).toBe('PRIVILEGED');
    expect(TOOLS_BY_NAME.get('refresh_transactions')?.category).toBe('PRIVILEGED');
    expect(TOOLS_BY_NAME.get('get_cash_summary')?.category).toBe('READ');
  });

  /**
   * No tool may accept a user id. The caller is established by the verified
   * JWT, and offering the model a place to put one would create a path to
   * another user's data.
   */
  it('never accepts a user id from the model', () => {
    for (const tool of TOOL_DEFINITIONS) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(properties)) {
        expect(key.toLowerCase()).not.toContain('userid');
        expect(key.toLowerCase()).not.toContain('user_id');
      }
    }
  });

  it('gives every tool a description the model can act on', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  it('emits the Anthropic tool shape', () => {
    const tools = toAnthropicTools();
    expect(tools).toHaveLength(TOOL_DEFINITIONS.length);
    for (const tool of tools) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('input_schema');
    }
  });
});

describe('tool argument validation', () => {
  it('rejects a limit above the safe maximum', () => {
    const tool = TOOLS_BY_NAME.get('search_transactions')!;
    expect(tool.argsSchema.safeParse({ limit: 5000 }).success).toBe(false);
    expect(tool.argsSchema.safeParse({ limit: 25 }).success).toBe(true);
  });

  it('rejects a malformed date', () => {
    const tool = TOOLS_BY_NAME.get('get_cashflow_range')!;
    expect(tool.argsSchema.safeParse({ from: 'last July', to: '2026-07-31' }).success).toBe(false);
    expect(tool.argsSchema.safeParse({ from: '2026-07-01', to: '2026-07-31' }).success).toBe(true);
  });

  it('rejects an out-of-range month', () => {
    const tool = TOOLS_BY_NAME.get('get_monthly_cashflow')!;
    expect(tool.argsSchema.safeParse({ year: 2026, month: 13 }).success).toBe(false);
    expect(tool.argsSchema.safeParse({ year: 2026, month: 7 }).success).toBe(true);
  });

  it('rejects an account id that is not a uuid', () => {
    const tool = TOOLS_BY_NAME.get('get_account_details')!;
    expect(tool.argsSchema.safeParse({ accountId: "'; drop table transactions; --" }).success).toBe(
      false,
    );
  });

  it('rejects an unknown classification', () => {
    const tool = TOOLS_BY_NAME.get('search_transactions')!;
    expect(tool.argsSchema.safeParse({ classification: 'EVERYTHING' }).success).toBe(false);
    expect(tool.argsSchema.safeParse({ classification: 'EXPENSE' }).success).toBe(true);
  });
});
