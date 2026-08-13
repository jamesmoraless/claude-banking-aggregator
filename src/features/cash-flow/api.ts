import type { DateRange } from '@/lib/financial/dates';
import { requireSupabase } from '@/lib/supabase/client';
import { unwrap } from '@/lib/supabase/errors';
import type { FunctionReturns } from '@/types/database.types';

/**
 * Cash flow data access.
 *
 * Every figure here comes from a database function. Nothing is recomputed in
 * the browser, which is what guarantees the Overview cards, the Cash Flow
 * screen and Atlas AI cannot disagree: they are literally reading the same
 * expression.
 */

export type MonthlyCashflowRow = FunctionReturns<'monthly_cashflow'>[number];
export type SpendingByCategoryRow = FunctionReturns<'spending_by_category'>[number];
export type IncomeBySourceRow = FunctionReturns<'income_by_source'>[number];
export type TopMerchantRow = FunctionReturns<'top_merchants'>[number];
export type TransferSummaryRow = FunctionReturns<'transfer_summary'>[number];
export type CashTrendRow = FunctionReturns<'cash_trend'>[number];

export async function fetchMonthlyCashflow(range: DateRange): Promise<MonthlyCashflowRow[]> {
  const supabase = requireSupabase();
  return unwrap(
    'Load cash flow',
    await supabase.rpc('monthly_cashflow', { p_from: range.from, p_to: range.to }),
  );
}

export async function fetchSpendingByCategory(range: DateRange): Promise<SpendingByCategoryRow[]> {
  const supabase = requireSupabase();
  return unwrap(
    'Load spending by category',
    await supabase.rpc('spending_by_category', { p_from: range.from, p_to: range.to }),
  );
}

export async function fetchIncomeBySource(range: DateRange): Promise<IncomeBySourceRow[]> {
  const supabase = requireSupabase();
  return unwrap(
    'Load income breakdown',
    await supabase.rpc('income_by_source', { p_from: range.from, p_to: range.to }),
  );
}

export async function fetchTopMerchants(range: DateRange, limit = 10): Promise<TopMerchantRow[]> {
  const supabase = requireSupabase();
  return unwrap(
    'Load top merchants',
    await supabase.rpc('top_merchants', { p_from: range.from, p_to: range.to, p_limit: limit }),
  );
}

export async function fetchTransferSummary(range: DateRange): Promise<TransferSummaryRow[]> {
  const supabase = requireSupabase();
  return unwrap(
    'Load excluded transactions',
    await supabase.rpc('transfer_summary', { p_from: range.from, p_to: range.to }),
  );
}

export async function fetchCashTrend(range: DateRange): Promise<CashTrendRow[]> {
  const supabase = requireSupabase();
  return unwrap(
    'Load cash trend',
    await supabase.rpc('cash_trend', { p_from: range.from, p_to: range.to }),
  );
}
