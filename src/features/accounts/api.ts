import { requireSupabase } from '@/lib/supabase/client';
import { unwrap, unwrapSingleRow } from '@/lib/supabase/errors';
import type { FunctionReturns, Tables, TablesUpdate } from '@/types/database.types';

/**
 * Account and institution data access.
 *
 * Reads go straight to Supabase views under Row Level Security — there is no
 * Edge Function in the path, because there is nothing privileged about reading
 * your own balances. Writes are limited to the columns the browser is granted
 * (display label and reporting flags); anything touching Plaid goes through an
 * Edge Function instead.
 */

export type AccountRow = Tables<'account_balances'>;
export type InstitutionRow = Tables<'institutions'>;
export type PlaidItemRow = Tables<'plaid_items'>;
export type CashSummary = FunctionReturns<'dashboard_cash_summary'>[number];
export type DataFreshnessRow = FunctionReturns<'data_freshness'>[number];

export async function fetchAccounts(): Promise<AccountRow[]> {
  const supabase = requireSupabase();
  return unwrap(
    'Load accounts',
    await supabase
      .from('account_balances')
      .select('*')
      .order('institution_effective_name', { ascending: true, nullsFirst: false })
      .order('type', { ascending: true })
      .order('effective_name', { ascending: true }),
  );
}

export async function fetchAccount(accountId: string): Promise<AccountRow | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('account_balances')
    .select('*')
    .eq('id', accountId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchInstitutions(): Promise<InstitutionRow[]> {
  const supabase = requireSupabase();
  return unwrap(
    'Load institutions',
    await supabase.from('institutions').select('*').order('name'),
  );
}

export async function fetchPlaidItems(): Promise<PlaidItemRow[]> {
  const supabase = requireSupabase();
  return unwrap(
    'Load connections',
    await supabase
      .from('plaid_items')
      .select('*')
      .is('disconnected_at', null)
      .order('created_at'),
  );
}

/**
 * Total cash, checking and savings.
 *
 * Computed by the dashboard_cash_summary RPC rather than in the browser, so the
 * Overview screen and the Atlas AI assistant answer "how much cash do I have?"
 * from the identical expression.
 */
export async function fetchCashSummary(): Promise<CashSummary | null> {
  const supabase = requireSupabase();
  return unwrapSingleRow('Load cash summary', await supabase.rpc('dashboard_cash_summary'));
}

export async function fetchDataFreshness(): Promise<DataFreshnessRow[]> {
  const supabase = requireSupabase();
  return unwrap('Load sync status', await supabase.rpc('data_freshness'));
}

// ---------------------------------------------------------------------------
// Mutations — user-owned settings only.
// ---------------------------------------------------------------------------

export type AccountSettingsUpdate = Pick<
  TablesUpdate<'accounts'>,
  'display_name' | 'include_in_cash' | 'include_in_net_worth' | 'hidden'
>;

export async function updateAccountSettings(
  accountId: string,
  changes: AccountSettingsUpdate,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('accounts').update(changes).eq('id', accountId);
  if (error) throw error;
}

export async function renameInstitution(
  institutionId: string,
  displayName: string | null,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('institutions')
    .update({ display_name: displayName })
    .eq('id', institutionId);
  if (error) throw error;
}

export type ManualAccountInput = {
  name: string;
  type: string;
  subtype: string | null;
  currentBalance: number;
  currency: string;
  includeInCash: boolean;
};

/**
 * Creates a manual account. RLS permits inserts only where source = 'manual',
 * so a client cannot fabricate an account that appears to come from a bank.
 */
export async function createManualAccount(
  userId: string,
  input: ManualAccountInput,
): Promise<Tables<'accounts'>> {
  const supabase = requireSupabase();
  return unwrap(
    'Create account',
    await supabase
      .from('accounts')
      .insert({
        user_id: userId,
        source: 'manual',
        name: input.name,
        type: input.type,
        subtype: input.subtype,
        current_balance: input.currentBalance,
        available_balance: input.currentBalance,
        iso_currency_code: input.currency,
        include_in_cash: input.includeInCash,
        balances_updated_at: new Date().toISOString(),
      })
      .select()
      .single(),
  );
}

export async function updateManualAccount(
  accountId: string,
  input: Partial<ManualAccountInput>,
): Promise<void> {
  const supabase = requireSupabase();
  const changes: TablesUpdate<'accounts'> = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.type !== undefined) changes.type = input.type;
  if (input.subtype !== undefined) changes.subtype = input.subtype;
  if (input.currency !== undefined) changes.iso_currency_code = input.currency;
  if (input.includeInCash !== undefined) changes.include_in_cash = input.includeInCash;
  if (input.currentBalance !== undefined) {
    changes.current_balance = input.currentBalance;
    changes.available_balance = input.currentBalance;
    changes.balances_updated_at = new Date().toISOString();
  }

  const { error } = await supabase.from('accounts').update(changes).eq('id', accountId);
  if (error) throw error;
}

export async function deleteManualAccount(accountId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('accounts').delete().eq('id', accountId);
  if (error) throw error;
}
