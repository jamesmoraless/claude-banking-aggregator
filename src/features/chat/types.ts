/**
 * Structured chat response blocks.
 *
 * Mirrors supabase/functions/_shared/finance/blocks.ts. The two must stay in
 * step — the renderer ignores any block type it does not recognise rather than
 * crashing, so a mismatch degrades quietly instead of breaking the screen.
 *
 * The important property: every FIGURE in these blocks was built server-side
 * from tool data, not written by the model. Claude's own words arrive only as
 * `text` blocks. That is what makes it impossible for the assistant to render a
 * number the database did not produce.
 */

export type ChatMetric = {
  label: string;
  value: number | null;
  format: 'money' | 'percent' | 'count';
  currency?: string;
  emphasis?: 'default' | 'positive' | 'negative' | 'muted';
  sublabel?: string;
};

export type ChatBlock =
  | { type: 'text'; text: string }
  | { type: 'metric_grid'; title?: string; subtitle?: string; metrics: ChatMetric[] }
  | {
      type: 'calculation';
      title: string;
      currency: string;
      lines: {
        label: string;
        description?: string;
        amount: number;
        operator: 'BASE' | 'SUBTRACT';
      }[];
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

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  /** User messages carry text; assistant messages carry blocks. */
  text?: string;
  blocks?: ChatBlock[];
  createdAt: string;
  toolsUsed?: string[];
  dataAsOf?: string;
};

export type ChatResponse = {
  blocks: ChatBlock[];
  toolsUsed: string[];
  dataAsOf: string;
};

/** Prompts shown on an empty conversation. */
export const SUGGESTED_QUESTIONS = [
  'How much did I actually spend last month, excluding transfers and credit card payments?',
  'How much did I save this year?',
  'Show my top merchants.',
  'Compare this month with last month.',
  'How has my cash changed over six months?',
  'What are my largest expenses this year?',
] as const;
