import type { EconomicType, TransferSubtype } from '@/lib/financial/classification';
import { requireSupabase } from '@/lib/supabase/client';
import { unwrapMaybe } from '@/lib/supabase/errors';
import type { Tables } from '@/types/database.types';

/**
 * Transaction data access.
 *
 * Reads come from the canonical transactions_classified view, so a row's
 * economic meaning here is the same meaning the monthly totals were built from.
 * Filters are structured values that map onto PostgREST operators — there is no
 * place a caller could inject SQL, which also makes this layer safe to expose
 * to the Atlas AI tool executor.
 */

export type TransactionRow = Tables<'transactions_classified'>;

export type TransactionFilters = {
  from?: string;
  to?: string;
  accountIds?: string[];
  institutionIds?: string[];
  categories?: string[];
  economicTypes?: EconomicType[];
  /** Free-text match against merchant name and raw description. */
  search?: string;
  minAmount?: number;
  maxAmount?: number;
  status?: 'ALL' | 'POSTED' | 'PENDING';
  transferStatus?: 'ALL' | 'TRANSFERS_ONLY' | 'EXCLUDING_TRANSFERS';
  /** Only rows our classifier could not resolve. */
  needsReviewOnly?: boolean;
  /** Restricts to one exclusion bucket, for calculation drill-downs. */
  exclusionBucket?: string;
  direction?: 'INFLOW' | 'OUTFLOW';
};

export type TransactionPage = {
  rows: TransactionRow[];
  /** Total matching rows, for "showing 50 of 1,284". */
  totalCount: number;
  hasMore: boolean;
};

export const TRANSACTIONS_PAGE_SIZE = 50;

/** Escapes PostgREST `or()` syntax, which is comma- and paren-delimited. */
function escapeForOrFilter(value: string): string {
  return value.replace(/[(),*]/g, ' ').trim();
}

export async function fetchTransactions(
  filters: TransactionFilters,
  page = 0,
  pageSize = TRANSACTIONS_PAGE_SIZE,
): Promise<TransactionPage> {
  const supabase = requireSupabase();

  let query = supabase
    .from('transactions_classified')
    .select('*', { count: 'exact' })
    .is('removed_at', null);

  if (filters.from) query = query.gte('posted_date', filters.from);
  if (filters.to) query = query.lte('posted_date', filters.to);
  if (filters.accountIds?.length) query = query.in('account_id', filters.accountIds);
  if (filters.institutionIds?.length) query = query.in('institution_id', filters.institutionIds);
  if (filters.categories?.length) query = query.in('plaid_category_primary', filters.categories);
  if (filters.economicTypes?.length) query = query.in('effective_type', filters.economicTypes);
  if (filters.direction) query = query.eq('direction', filters.direction);
  if (filters.exclusionBucket) {
    query =
      filters.exclusionBucket === 'REFUND'
        ? query.eq('income_exclusion_bucket', 'REFUND')
        : query.eq('spending_exclusion_bucket', filters.exclusionBucket);
  }

  if (filters.status === 'PENDING') query = query.eq('pending', true);
  if (filters.status === 'POSTED') query = query.eq('pending', false);

  if (filters.transferStatus === 'TRANSFERS_ONLY') {
    query = query.eq('effective_type', 'TRANSFER');
  } else if (filters.transferStatus === 'EXCLUDING_TRANSFERS') {
    query = query.neq('effective_type', 'TRANSFER');
  }

  if (filters.needsReviewOnly) query = query.eq('effective_type', 'UNKNOWN');

  // Amount filters compare magnitudes, so a user asking for "over $500" gets
  // both a $600 purchase and a $600 deposit rather than only outflows.
  if (filters.minAmount != null) query = query.gte('absolute_amount', filters.minAmount);
  if (filters.maxAmount != null) query = query.lte('absolute_amount', filters.maxAmount);

  if (filters.search?.trim()) {
    const term = escapeForOrFilter(filters.search);
    if (term.length > 0) {
      query = query.or(`merchant_name.ilike.%${term}%,name.ilike.%${term}%`);
    }
  }

  const start = page * pageSize;
  const { data, error, count } = await query
    .order('posted_date', { ascending: false })
    .order('absolute_amount', { ascending: false })
    .order('id', { ascending: true })
    .range(start, start + pageSize - 1);

  if (error) throw error;

  const rows = data ?? [];
  const totalCount = count ?? rows.length;

  return { rows, totalCount, hasMore: start + rows.length < totalCount };
}

export async function fetchTransaction(transactionId: string): Promise<TransactionRow | null> {
  const supabase = requireSupabase();
  return unwrapMaybe(
    'Load transaction',
    await supabase
      .from('transactions_classified')
      .select('*')
      .eq('id', transactionId)
      .maybeSingle(),
  );
}

export async function fetchRecentTransactions(limit = 5): Promise<TransactionRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('transactions_classified')
    .select('*')
    .is('removed_at', null)
    .order('posted_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Distinct Plaid categories present in the user's data, for the filter list. */
export async function fetchAvailableCategories(): Promise<string[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('transactions_classified')
    .select('plaid_category_primary')
    .is('removed_at', null)
    .not('plaid_category_primary', 'is', null)
    .limit(2000);
  if (error) throw error;

  const unique = new Set<string>();
  for (const row of data ?? []) {
    if (row.plaid_category_primary) unique.add(row.plaid_category_primary);
  }
  return [...unique].sort();
}

// ---------------------------------------------------------------------------
// Classification overrides
//
// The browser may write only the user_* columns (enforced by column-level
// grants). Plaid's raw data and our system classification are untouched, so an
// override can always be undone and the original reasoning inspected.
// ---------------------------------------------------------------------------

export async function setTransactionClassification(
  transactionId: string,
  type: EconomicType,
  transferSubtype: TransferSubtype | null = null,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('transactions')
    .update({
      user_type: type,
      user_transfer_subtype: type === 'TRANSFER' ? transferSubtype : null,
      user_classified_at: new Date().toISOString(),
    })
    .eq('id', transactionId);
  if (error) throw error;
}

/** Removes the override, restoring whatever the classifier decided. */
export async function clearTransactionClassification(transactionId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('transactions')
    .update({ user_type: null, user_transfer_subtype: null, user_classified_at: null })
    .eq('id', transactionId);
  if (error) throw error;
}

export async function setTransactionExcluded(
  transactionId: string,
  excluded: boolean,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('transactions')
    .update({ excluded_from_spending: excluded })
    .eq('id', transactionId);
  if (error) throw error;
}
