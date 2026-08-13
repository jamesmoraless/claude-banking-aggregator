import type { ToolResult } from './tool-result.ts';

/**
 * Turns tool results into structured response blocks.
 *
 * This is the mechanism that stops Atlas AI inventing numbers.
 *
 * Claude writes prose. Every FIGURE the user sees — metric cards, chart values,
 * table amounts, calculation lines — is built here, deterministically, from the
 * data a tool actually returned. The model never types a number into a metric
 * card, because it has no way to. Its output is rendered as text; the data is
 * rendered from the tool result.
 *
 * A consequence worth stating: if Claude's prose ever contradicts a block, the
 * block is right. They come from different places, and only one of them is the
 * database.
 *
 * The block types mirror src/features/chat/types.ts on the client. Keep the two
 * in step — a block the client cannot render is dropped rather than shown.
 */

export type ChatBlock =
  | { type: 'text'; text: string }
  | {
      type: 'metric_grid';
      title?: string;
      subtitle?: string;
      metrics: {
        label: string;
        value: number | null;
        format: 'money' | 'percent' | 'count';
        currency?: string;
        emphasis?: 'default' | 'positive' | 'negative' | 'muted';
        sublabel?: string;
      }[];
    }
  | {
      type: 'calculation';
      title: string;
      currency: string;
      lines: { label: string; description?: string; amount: number; operator: 'BASE' | 'SUBTRACT' }[];
      result: { label: string; amount: number };
      balances: boolean;
      note?: string;
    }
  | {
      type: 'transaction_table';
      title: string;
      rows: {
        id: string;
        date: string;
        name: string;
        account: string;
        amount: number;
        currency: string | null;
        direction: string;
        classification: string;
      }[];
      truncated?: boolean;
      totalMatching?: number;
    }
  | {
      type: 'account_list';
      title: string;
      accounts: {
        id: string;
        name: string;
        institution: string | null;
        type: string;
        balance: number | null;
        currency: string | null;
        status: string | null;
      }[];
    }
  | {
      type: 'bar_chart';
      title: string;
      currency: string;
      series: { key: string; label: string; color: 'income' | 'spending' }[];
      data: { label: string; values: Record<string, number> }[];
    }
  | {
      type: 'donut_chart';
      title: string;
      currency: string;
      total: number;
      slices: { label: string; value: number; share: number | null }[];
    }
  | { type: 'alert'; variant: 'info' | 'warning' | 'destructive'; title?: string; message: string }
  | {
      type: 'freshness';
      institutions: { name: string; syncedAt: string | null; requiresReauth: boolean }[];
    };

type Row = Record<string, unknown>;

const number = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0));
const nullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : number(value);
const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

/**
 * Maps one tool result to the blocks that should render it.
 *
 * Returns an empty array for tools with no visual representation, and for
 * failed tools — a failure is communicated in Claude's prose, not as an
 * empty chart.
 */
export function toolResultToBlocks(result: ToolResult): ChatBlock[] {
  if (!result.ok || result.data === null) return [];

  const data = result.data as Row;

  switch (result.toolName) {
    case 'get_cash_summary':
      return cashSummaryBlocks(data);
    case 'get_monthly_cashflow':
      return monthlyCashflowBlocks(data);
    case 'get_cashflow_range':
      return cashflowRangeBlocks(data);
    case 'explain_monthly_spending':
      return explanationBlocks(data);
    case 'get_spending_by_category':
      return categoryBlocks(data);
    case 'get_top_merchants':
      return merchantBlocks(data);
    case 'get_transfer_summary':
      return transferSummaryBlocks(data);
    case 'search_transactions':
    case 'get_largest_transactions':
      return transactionBlocks(result.toolName, data);
    case 'get_accounts':
      return accountBlocks(data);
    case 'compare_periods':
      return comparisonBlocks(data);
    case 'get_data_freshness':
      return freshnessBlocks(data);
    case 'refresh_accounts':
    case 'refresh_transactions':
      return refreshBlocks(data);
    default:
      return [];
  }
}

function cashSummaryBlocks(data: Row): ChatBlock[] {
  if (data.hasData !== true) {
    return [
      {
        type: 'alert',
        variant: 'info',
        title: 'No accounts connected',
        message: 'Connect a financial institution to see your cash position.',
      },
    ];
  }

  const currency = text(data.currency, 'CAD');
  const blocks: ChatBlock[] = [
    {
      type: 'metric_grid',
      title: 'Cash position',
      metrics: [
        { label: 'Total Cash', value: nullableNumber(data.total_cash), format: 'money', currency },
        { label: 'Checking', value: nullableNumber(data.checking_total), format: 'money', currency },
        { label: 'Savings', value: nullableNumber(data.savings_total), format: 'money', currency },
        {
          label: 'Credit owed',
          value: nullableNumber(data.credit_owed_total),
          format: 'money',
          currency,
          emphasis: 'muted',
        },
      ],
    },
  ];

  // A total that silently omits accounts is worse than no total.
  const excluded = number(data.excluded_account_count);
  if (excluded > 0) {
    const currencies = Array.isArray(data.excluded_currencies)
      ? (data.excluded_currencies as string[]).join(', ')
      : 'another currency';
    blocks.push({
      type: 'alert',
      variant: 'warning',
      message: `This total excludes ${excluded} account${excluded === 1 ? '' : 's'} held in ${currencies}. Cash Atlas does not convert currencies.`,
    });
  }

  return blocks;
}

function monthlyCashflowBlocks(data: Row): ChatBlock[] {
  if (data.hasData !== true) {
    return [
      { type: 'alert', variant: 'info', message: 'There is no activity recorded for that month.' },
    ];
  }

  const currency = text(data.currency, 'CAD');

  return [
    {
      type: 'metric_grid',
      title: 'Monthly cash flow',
      metrics: [
        {
          label: 'Actual Spending',
          value: nullableNumber(data.actual_spending),
          format: 'money',
          currency,
        },
        { label: 'Income', value: nullableNumber(data.actual_income), format: 'money', currency },
        {
          label: 'Surplus',
          value: nullableNumber(data.surplus),
          format: 'money',
          currency,
          emphasis: number(data.surplus) >= 0 ? 'positive' : 'negative',
        },
        {
          label: 'Savings Rate',
          value: nullableNumber(data.savings_rate),
          format: 'percent',
          sublabel: data.savings_rate === null ? 'No income recorded' : undefined,
        },
      ],
    },
  ];
}

function cashflowRangeBlocks(data: Row): ChatBlock[] {
  const months = Array.isArray(data.months) ? (data.months as Row[]) : [];
  if (months.length === 0) return [];

  const currency = text(months[0]?.currency, 'CAD');

  return [
    {
      type: 'bar_chart',
      title: 'Income vs Actual Spending',
      currency,
      series: [
        { key: 'income', label: 'Income', color: 'income' },
        { key: 'spending', label: 'Actual Spending', color: 'spending' },
      ],
      data: months.map((month) => ({
        label: text(month.month_start),
        values: {
          income: number(month.actual_income),
          spending: number(month.actual_spending),
        },
      })),
    },
  ];
}

function explanationBlocks(data: Row): ChatBlock[] {
  if (data.hasData !== true) {
    return [
      { type: 'alert', variant: 'info', message: 'There is no activity recorded for that month.' },
    ];
  }

  const currency = text(data.currency, 'CAD');
  const deductions = Array.isArray(data.deductions) ? (data.deductions as Row[]) : [];

  const blocks: ChatBlock[] = [
    {
      type: 'calculation',
      title: 'How we calculated your actual spending',
      currency,
      lines: [
        { label: 'Gross debits', description: 'All money that left your accounts', amount: number(data.grossDebits), operator: 'BASE' },
        ...deductions.map((deduction) => ({
          label: text(deduction.label),
          amount: number(deduction.amount),
          operator: 'SUBTRACT' as const,
        })),
      ],
      result: { label: 'Actual spending', amount: number(data.actualSpending) },
      balances: data.balances === true,
      note:
        data.balances === true
          ? undefined
          : 'These components do not reconcile to the total. Please report this.',
    },
  ];

  const unclassified = number(data.unclassifiedTransactionCount);
  if (unclassified > 0) {
    blocks.push({
      type: 'alert',
      variant: 'warning',
      message: `${unclassified} transaction${unclassified === 1 ? '' : 's'} could not be classified automatically and ${unclassified === 1 ? 'is' : 'are'} not included in this figure. Review them on the Transactions screen.`,
    });
  }

  return blocks;
}

function categoryBlocks(data: Row): ChatBlock[] {
  const rows = Array.isArray(data.rows) ? (data.rows as Row[]) : [];
  const positive = rows.filter((row) => number(row.amount) > 0);
  if (positive.length === 0) return [];

  const total = positive.reduce((sum, row) => sum + number(row.amount), 0);

  return [
    {
      type: 'donut_chart',
      title: 'Spending by category',
      currency: 'CAD',
      total,
      slices: positive.map((row) => ({
        label: text(row.category, 'Uncategorised'),
        value: number(row.amount),
        share: nullableNumber(row.share),
      })),
    },
  ];
}

function merchantBlocks(data: Row): ChatBlock[] {
  const merchants = Array.isArray(data.merchants) ? (data.merchants as Row[]) : [];
  if (merchants.length === 0) return [];

  return [
    {
      type: 'metric_grid',
      title: 'Top merchants',
      metrics: merchants.slice(0, 8).map((merchant) => ({
        label: text(merchant.merchant, 'Unknown'),
        value: number(merchant.amount),
        format: 'money' as const,
        sublabel: `${number(merchant.transaction_count)} transaction${number(merchant.transaction_count) === 1 ? '' : 's'}`,
      })),
    },
  ];
}

function transferSummaryBlocks(data: Row): ChatBlock[] {
  const rows = Array.isArray(data.rows) ? (data.rows as Row[]) : [];
  if (rows.length === 0) return [];

  return [
    {
      type: 'metric_grid',
      title: 'Excluded from spending',
      subtitle: 'Money that moved without being spent',
      metrics: rows.map((row) => ({
        label: humanise(text(row.bucket)),
        value: number(row.amount),
        format: 'money' as const,
        emphasis: 'muted' as const,
        sublabel: `${number(row.transaction_count)} transaction${number(row.transaction_count) === 1 ? '' : 's'}`,
      })),
    },
  ];
}

function transactionBlocks(toolName: string, data: Row): ChatBlock[] {
  const transactions = Array.isArray(data.transactions) ? (data.transactions as Row[]) : [];
  if (transactions.length === 0) return [];

  return [
    {
      type: 'transaction_table',
      title: toolName === 'get_largest_transactions' ? 'Largest transactions' : 'Matching transactions',
      rows: transactions.map((transaction) => ({
        id: text(transaction.id),
        date: text(transaction.posted_date),
        name: text(transaction.display_name, 'Transaction'),
        account: text(transaction.account_name, ''),
        amount: number(transaction.absolute_amount),
        currency: transaction.currency === null ? null : text(transaction.currency),
        direction: text(transaction.direction, 'OUTFLOW'),
        classification: text(transaction.effective_type, 'UNKNOWN'),
      })),
      truncated: data.truncated === true,
      totalMatching: data.totalMatching === undefined ? undefined : number(data.totalMatching),
    },
  ];
}

function accountBlocks(data: Row): ChatBlock[] {
  const accounts = Array.isArray(data.accounts) ? (data.accounts as Row[]) : [];
  if (accounts.length === 0) return [];

  return [
    {
      type: 'account_list',
      title: 'Your accounts',
      accounts: accounts.map((account) => ({
        id: text(account.id),
        name: text(account.effective_name, 'Account'),
        institution:
          account.institution_effective_name === null
            ? null
            : text(account.institution_effective_name),
        type: text(account.type, 'other'),
        balance: nullableNumber(account.current_balance),
        currency: account.currency === null ? null : text(account.currency),
        status: account.item_status === null ? null : text(account.item_status),
      })),
    },
  ];
}

function comparisonBlocks(data: Row): ChatBlock[] {
  const periodA = (data.periodA ?? {}) as Row;
  const periodB = (data.periodB ?? {}) as Row;

  return [
    {
      type: 'metric_grid',
      title: `${text(periodA.from)} – ${text(periodA.to)}`,
      metrics: [
        { label: 'Income', value: nullableNumber(periodA.actualIncome), format: 'money' },
        { label: 'Actual Spending', value: nullableNumber(periodA.actualSpending), format: 'money' },
        { label: 'Surplus', value: nullableNumber(periodA.surplus), format: 'money' },
        { label: 'Savings Rate', value: nullableNumber(periodA.savingsRate), format: 'percent' },
      ],
    },
    {
      type: 'metric_grid',
      title: `${text(periodB.from)} – ${text(periodB.to)}`,
      metrics: [
        { label: 'Income', value: nullableNumber(periodB.actualIncome), format: 'money' },
        { label: 'Actual Spending', value: nullableNumber(periodB.actualSpending), format: 'money' },
        { label: 'Surplus', value: nullableNumber(periodB.surplus), format: 'money' },
        { label: 'Savings Rate', value: nullableNumber(periodB.savingsRate), format: 'percent' },
      ],
    },
  ];
}

function freshnessBlocks(data: Row): ChatBlock[] {
  const institutions = Array.isArray(data.institutions) ? (data.institutions as Row[]) : [];
  if (institutions.length === 0) return [];

  return [
    {
      type: 'freshness',
      institutions: institutions.map((institution) => ({
        name: text(institution.institution_name, 'Institution'),
        syncedAt:
          institution.last_successful_sync_at === null
            ? null
            : text(institution.last_successful_sync_at),
        requiresReauth: institution.requires_reauth === true,
      })),
    },
  ];
}

function refreshBlocks(data: Row): ChatBlock[] {
  const institutions = Array.isArray(data.institutions) ? (data.institutions as Row[]) : [];
  const status = text(data.overallStatus, 'SUCCESS');

  if (institutions.length === 0) {
    return [{ type: 'alert', variant: 'info', message: 'There are no connected institutions to refresh.' }];
  }

  const failed = institutions.filter((institution) => institution.status !== 'SUCCESS');

  return [
    {
      type: 'alert',
      variant: status === 'SUCCESS' ? 'info' : status === 'FAILED' ? 'destructive' : 'warning',
      title:
        status === 'SUCCESS'
          ? 'Refreshed'
          : `${institutions.length - failed.length} of ${institutions.length} institutions refreshed`,
      message:
        failed.length === 0
          ? `Updated ${institutions.length} institution${institutions.length === 1 ? '' : 's'}.`
          : failed
              .map((institution) => `${text(institution.institutionName)}: ${text(institution.errorMessage, 'could not be refreshed')}`)
              .join(' · '),
    },
  ];
}

function humanise(value: string): string {
  const cleaned = value.replace(/_/g, ' ').toLowerCase();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
