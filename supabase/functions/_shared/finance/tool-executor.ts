import type { SupabaseClient } from '@supabase/supabase-js';

import { AppError } from '../errors/app-error.ts';
import type { Logger } from '../logging/logger.ts';
import { PlaidClient } from '../plaid/client.ts';
import { ConnectionService } from '../services/connection-service.ts';

import { TOOLS_BY_NAME } from './tool-definitions.ts';
import type { ToolResult } from './tool-result.ts';

/**
 * Executes finance tools.
 *
 * Deliberately independent of Anthropic: it takes a tool name and arguments and
 * returns data. That means the whole capability surface can be exercised in
 * tests without an API key, and it makes the security boundary obvious — this
 * class is where "what the assistant can do" is actually decided.
 *
 * Three rules hold for every tool:
 *   1. The user id comes from the verified JWT, never from tool arguments.
 *   2. Arguments are validated with Zod before use. The model's output is
 *      untrusted input.
 *   3. Every query runs through the same RPCs and views the dashboard uses, so
 *      the assistant cannot quote a number the UI would disagree with.
 */

export type { ToolResult } from './tool-result.ts';

/** Privileged tools hit Plaid, so they are capped per conversation. */
const MAX_PRIVILEGED_CALLS = 2;

export class FinanceToolExecutor {
  private privilegedCallCount = 0;

  /**
   * @param client   RLS-scoped, acting as the calling user. Every READ tool
   *                 uses this, so the database enforces the boundary rather
   *                 than this class remembering to.
   * @param adminClient  Service-role. Used ONLY by the privileged refresh
   *                 tools, which must read encrypted Plaid credentials.
   */
  constructor(
    private readonly client: SupabaseClient,
    private readonly adminClient: SupabaseClient,
    private readonly userId: string,
    private readonly logger: Logger,
    private readonly requestId: string,
  ) {}

  async execute(toolName: string, rawArgs: unknown): Promise<ToolResult> {
    const definition = TOOLS_BY_NAME.get(toolName);

    if (!definition) {
      // The model asked for something that does not exist. Told plainly so it
      // can recover, rather than failing the whole turn.
      return { toolName, ok: false, data: null, error: `There is no tool called "${toolName}".` };
    }

    const parsed = definition.argsSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      return {
        toolName,
        ok: false,
        data: null,
        error: `Invalid arguments: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
      };
    }

    if (definition.category === 'PRIVILEGED') {
      if (this.privilegedCallCount >= MAX_PRIVILEGED_CALLS) {
        return {
          toolName,
          ok: false,
          data: null,
          error: 'Refresh has already run in this conversation. Ask again in a moment if needed.',
        };
      }
      this.privilegedCallCount += 1;
    }

    const startedAt = Date.now();

    try {
      const data = await this.dispatch(toolName, parsed.data as Record<string, unknown>);

      this.logger.info('Tool executed', {
        toolName,
        durationMs: Date.now() - startedAt,
      });

      return { toolName, ok: true, data };
    } catch (error) {
      const appError = error instanceof AppError ? error : null;

      this.logger.warn('Tool failed', {
        toolName,
        code: appError?.code ?? 'INTERNAL_ERROR',
      });

      return {
        toolName,
        ok: false,
        data: null,
        error: appError?.message ?? 'That information could not be retrieved right now.',
      };
    }
  }

  private async dispatch(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'get_cash_summary':
        return await this.getCashSummary();
      case 'get_accounts':
        return await this.getAccounts(args);
      case 'get_account_details':
        return await this.getAccountDetails(args.accountId as string);
      case 'get_monthly_cashflow':
        return await this.getMonthlyCashflow(args.year as number, args.month as number);
      case 'get_cashflow_range':
        return await this.getCashflowRange(args.from as string, args.to as string);
      case 'get_spending_by_category':
        return await this.rpcRange('spending_by_category', args);
      case 'get_income_breakdown':
        return await this.rpcRange('income_by_source', args);
      case 'get_transfer_summary':
        return await this.rpcRange('transfer_summary', args);
      case 'search_transactions':
        return await this.searchTransactions(args);
      case 'get_largest_transactions':
        return await this.getLargestTransactions(args);
      case 'get_top_merchants':
        return await this.getTopMerchants(args);
      case 'compare_periods':
        return await this.comparePeriods(args);
      case 'explain_monthly_spending':
        return await this.explainMonthlySpending(args.year as number, args.month as number);
      case 'get_data_freshness':
        return await this.getDataFreshness();
      case 'refresh_accounts':
        return await this.refresh('accounts');
      case 'refresh_transactions':
        return await this.refresh('transactions');
      default:
        throw AppError.internal(`Unhandled tool ${toolName}`);
    }
  }

  // -------------------------------------------------------------------------
  // Read tools
  // -------------------------------------------------------------------------

  private async getCashSummary() {
    const summary = await this.rpc('dashboard_cash_summary', {});
    const row = (summary as Record<string, unknown>[])[0];

    if (!row) {
      return { hasData: false, message: 'No accounts have been connected yet.' };
    }

    return { hasData: true, ...row };
  }

  private async getAccounts(args: Record<string, unknown>) {
    let query = this.client
      .from('account_balances')
      .select(
        'id, effective_name, institution_effective_name, type, subtype, current_balance, available_balance, currency, include_in_cash, hidden, item_status, cash_bucket, last_synced_at',
      )
      .eq('user_id', this.userId);

    if (!args.includeHidden) query = query.eq('hidden', false);
    if (args.accountType) query = query.eq('type', args.accountType as string);
    if (args.institutionName) {
      query = query.ilike('institution_effective_name', `%${String(args.institutionName)}%`);
    }

    const { data, error } = await query.order('effective_name');
    if (error) throw AppError.database('getAccounts', error.message);

    return { accounts: data ?? [], count: (data ?? []).length };
  }

  private async getAccountDetails(accountId: string) {
    const { data, error } = await this.client
      .from('account_balances')
      .select('*')
      .eq('user_id', this.userId)
      .eq('id', accountId)
      .maybeSingle();

    if (error) throw AppError.database('getAccountDetails', error.message);
    if (!data) throw AppError.notFound('That account could not be found.');

    return data;
  }

  private async getMonthlyCashflow(year: number, month: number) {
    const { from, to } = monthRange(year, month);
    const rows = (await this.rpc('monthly_cashflow', {
      p_from: from,
      p_to: to,
    })) as Record<string, unknown>[];

    const row = rows[0];
    if (!row) return { hasData: false, month: from };

    return { hasData: true, month: from, ...row };
  }

  private async getCashflowRange(from: string, to: string) {
    const rows = (await this.rpc('monthly_cashflow', {
      p_from: from,
      p_to: to,
    })) as Record<string, unknown>[];

    return { months: rows, monthCount: rows.length, from, to };
  }

  private async rpcRange(functionName: string, args: Record<string, unknown>) {
    const rows = await this.rpc(functionName, {
      p_from: args.from as string,
      p_to: args.to as string,
    });
    return { rows, from: args.from, to: args.to };
  }

  private async searchTransactions(args: Record<string, unknown>) {
    const limit = Math.min((args.limit as number) ?? 25, 50);

    let query = this.client
      .from('transactions_classified')
      .select(
        'id, posted_date, display_name, amount, absolute_amount, direction, currency, account_name, institution_name, effective_type, effective_transfer_subtype, plaid_category_primary, pending, spending_exclusion_bucket',
        { count: 'exact' },
      )
      .eq('user_id', this.userId)
      .is('removed_at', null);

    if (args.from) query = query.gte('posted_date', args.from as string);
    if (args.to) query = query.lte('posted_date', args.to as string);
    if (args.category) query = query.eq('plaid_category_primary', args.category as string);
    if (args.classification) query = query.eq('effective_type', args.classification as string);
    if (args.accountId) query = query.eq('account_id', args.accountId as string);
    if (args.minAmount != null) query = query.gte('absolute_amount', args.minAmount as number);
    if (args.maxAmount != null) query = query.lte('absolute_amount', args.maxAmount as number);

    if (args.searchText) {
      // Structured filter, not SQL. The term is escaped of PostgREST's own
      // delimiters so it cannot alter the filter expression.
      const term = String(args.searchText).replace(/[(),*]/g, ' ').trim();
      if (term.length > 0) {
        query = query.or(`merchant_name.ilike.%${term}%,name.ilike.%${term}%`);
      }
    }

    const { data, error, count } = await query
      .order('posted_date', { ascending: false })
      .limit(limit);

    if (error) throw AppError.database('searchTransactions', error.message);

    return {
      transactions: data ?? [],
      returned: (data ?? []).length,
      totalMatching: count ?? 0,
      truncated: (count ?? 0) > (data ?? []).length,
    };
  }

  private async getLargestTransactions(args: Record<string, unknown>) {
    const limit = Math.min((args.limit as number) ?? 10, 25);

    let query = this.client
      .from('transactions_classified')
      .select(
        'id, posted_date, display_name, absolute_amount, direction, currency, account_name, effective_type, plaid_category_primary',
      )
      .eq('user_id', this.userId)
      .is('removed_at', null)
      .eq('is_reportable', true)
      .gte('posted_date', args.from as string)
      .lte('posted_date', args.to as string);

    query = args.classification
      ? query.eq('effective_type', args.classification as string)
      : // Without a classification, "largest" sensibly means largest spending.
        query.is('spending_exclusion_bucket', null).eq('direction', 'OUTFLOW');

    const { data, error } = await query.order('absolute_amount', { ascending: false }).limit(limit);

    if (error) throw AppError.database('getLargestTransactions', error.message);
    return { transactions: data ?? [], from: args.from, to: args.to };
  }

  private async getTopMerchants(args: Record<string, unknown>) {
    const rows = await this.rpc('top_merchants', {
      p_from: args.from as string,
      p_to: args.to as string,
      p_limit: Math.min((args.limit as number) ?? 10, 25),
    });
    return { merchants: rows, from: args.from, to: args.to };
  }

  private async comparePeriods(args: Record<string, unknown>) {
    const [periodA, periodB] = await Promise.all([
      this.rpc('monthly_cashflow', { p_from: args.periodAFrom, p_to: args.periodATo }),
      this.rpc('monthly_cashflow', { p_from: args.periodBFrom, p_to: args.periodBTo }),
    ]);

    const totalsA = sumMonths(periodA as Record<string, unknown>[]);
    const totalsB = sumMonths(periodB as Record<string, unknown>[]);

    return {
      periodA: { from: args.periodAFrom, to: args.periodATo, ...totalsA },
      periodB: { from: args.periodBFrom, to: args.periodBTo, ...totalsB },
      change: {
        actualIncome: totalsA.actualIncome - totalsB.actualIncome,
        actualSpending: totalsA.actualSpending - totalsB.actualSpending,
        surplus: totalsA.surplus - totalsB.surplus,
        savingsRatePoints:
          totalsA.savingsRate != null && totalsB.savingsRate != null
            ? totalsA.savingsRate - totalsB.savingsRate
            : null,
      },
    };
  }

  private async explainMonthlySpending(year: number, month: number) {
    const { from, to } = monthRange(year, month);
    const rows = (await this.rpc('monthly_cashflow', {
      p_from: from,
      p_to: to,
    })) as Record<string, unknown>[];

    const row = rows[0];
    if (!row) return { hasData: false, month: from };

    const amountOf = (key: string): number => Number(row[key] ?? 0);

    // Deductions are listed in the same order and with the same labels as the
    // Cash Flow screen, so the assistant's explanation and the UI panel are
    // recognisably the same artefact.
    const deductions = [
      { key: 'internal_transfers', label: 'Internal transfers' },
      { key: 'credit_card_payments', label: 'Credit card payments' },
      { key: 'investment_transfers', label: 'Investment transfers' },
      { key: 'adjustment_outflows', label: 'Adjustments' },
      { key: 'user_excluded_outflows', label: 'Excluded by you' },
      { key: 'other_non_expense_outflows', label: 'Other non-expense' },
      { key: 'unclassified_outflows', label: 'Unclassified' },
      { key: 'refunds', label: 'Applicable refunds' },
    ].map((entry) => ({ ...entry, amount: amountOf(entry.key) }));

    const totalDeductions = deductions.reduce((sum, entry) => sum + entry.amount, 0);
    const grossDebits = amountOf('gross_debits');
    const actualSpending = amountOf('actual_spending');

    return {
      hasData: true,
      month: from,
      currency: typeof row.currency === 'string' ? row.currency : 'CAD',
      grossDebits,
      deductions,
      actualSpending,
      actualIncome: amountOf('actual_income'),
      surplus: amountOf('surplus'),
      savingsRate: row.savings_rate === null ? null : Number(row.savings_rate),
      // Reported so the assistant can flag a discrepancy rather than presenting
      // a figure that does not reconcile.
      balances: Math.abs(grossDebits - totalDeductions - actualSpending) < 0.02,
      unclassifiedTransactionCount: amountOf('unclassified_transaction_count'),
      foreignCurrencyTransactionCount: amountOf('foreign_currency_transaction_count'),
    };
  }

  private async getDataFreshness() {
    const rows = (await this.rpc('data_freshness', {})) as Record<string, unknown>[];

    return {
      institutions: rows,
      anyNeedReconnect: rows.some((row) => row.requires_reauth === true),
      // Explicit, so the assistant states how old the data is rather than
      // implying it is live.
      generatedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Privileged tools
  // -------------------------------------------------------------------------

  private async refresh(kind: 'accounts' | 'transactions') {
    // Refreshing needs the access token, which only the service role can read.
    const service = new ConnectionService(
      this.adminClient,
      new PlaidClient(this.logger),
      this.logger,
    );

    const result = await service.refresh({ userId: this.userId, requestId: this.requestId });

    return {
      kind,
      overallStatus: result.overallStatus,
      institutions: result.results.map((item) => ({
        institutionName: item.institutionName,
        status: item.status,
        transactionsAdded: item.transactionsAdded,
        errorMessage: item.errorMessage,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  /**
   * Calls a reporting RPC.
   *
   * Runs on the user-scoped client, so the SECURITY INVOKER functions see the
   * right `auth.uid()` and return only this user's data — the same expression
   * the dashboard calls, with the same scoping.
   */
  private async rpc(functionName: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.client.rpc(functionName, args);
    if (error) throw AppError.database(functionName, error.message);
    return data;
  }
}

function monthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

type PeriodTotals = {
  actualIncome: number;
  expenseOutflows: number;
  refunds: number;
  grossDebits: number;
};

function sumMonths(rows: Record<string, unknown>[]) {
  const totals = rows.reduce<PeriodTotals>(
    (acc, row) => ({
      actualIncome: acc.actualIncome + Number(row.actual_income ?? 0),
      expenseOutflows: acc.expenseOutflows + Number(row.expense_outflows ?? 0),
      refunds: acc.refunds + Number(row.refunds ?? 0),
      grossDebits: acc.grossDebits + Number(row.gross_debits ?? 0),
    }),
    { actualIncome: 0, expenseOutflows: 0, refunds: 0, grossDebits: 0 },
  );

  const actualSpending = round(totals.expenseOutflows - totals.refunds);
  const actualIncome = round(totals.actualIncome);
  const surplus = round(actualIncome - actualSpending);

  return {
    actualIncome,
    actualSpending,
    surplus,
    grossDebits: round(totals.grossDebits),
    // Recomputed from summed components, never averaged across months.
    savingsRate: actualIncome > 0 ? round(surplus / actualIncome, 4) : null,
    monthCount: rows.length,
  };
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
