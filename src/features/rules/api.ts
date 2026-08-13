import { requireSupabase } from '@/lib/supabase/client';
import { unwrap } from '@/lib/supabase/errors';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database.types';

/**
 * Transaction rules.
 *
 * A deliberately small rule model: one match criterion plus optional amount and
 * account narrowing. Enough to express "anything from PAYROLL is income" or
 * "WEALTHSIMPLE transfers are investment transfers", without becoming a query
 * language nobody can reason about.
 *
 * Rules are applied during normalisation, in priority order, and write
 * `system_type`. They never write `user_type`, so an explicit decision on a
 * single transaction still outranks a rule.
 */

export type TransactionRuleRow = Tables<'transaction_rules'>;

export async function fetchRules(): Promise<TransactionRuleRow[]> {
  const supabase = requireSupabase();
  return unwrap(
    'Load rules',
    await supabase
      .from('transaction_rules')
      .select('*')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true }),
  );
}

export type RuleInput = Omit<TablesInsert<'transaction_rules'>, 'user_id' | 'id'>;

export async function createRule(
  userId: string,
  input: RuleInput,
): Promise<TransactionRuleRow> {
  const supabase = requireSupabase();
  return unwrap(
    'Create rule',
    await supabase
      .from('transaction_rules')
      .insert({ ...input, user_id: userId })
      .select()
      .single(),
  );
}

export async function updateRule(
  ruleId: string,
  changes: TablesUpdate<'transaction_rules'>,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('transaction_rules').update(changes).eq('id', ruleId);
  if (error) throw error;
}

export async function deleteRule(ruleId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('transaction_rules').delete().eq('id', ruleId);
  if (error) throw error;
}
