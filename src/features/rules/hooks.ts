import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useUserId } from '@/features/auth/auth-context';
import { queryKeys } from '@/lib/supabase/query-keys';
import type { TablesUpdate } from '@/types/database.types';

import { createRule, deleteRule, fetchRules, type RuleInput, updateRule } from './api';

export function useRules() {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.rules(userId ?? 'anonymous'),
    queryFn: fetchRules,
    enabled: Boolean(userId),
  });
}

/**
 * Rule changes affect future classification runs rather than rewriting existing
 * transactions, so only the rules list is invalidated. Re-classifying history
 * happens on the next sync, or when the user triggers a refresh.
 */
function useRuleMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<unknown>) {
  const queryClient = useQueryClient();
  const userId = useUserId();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      if (!userId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.rules(userId) });
    },
  });
}

export function useCreateRule() {
  const userId = useUserId();
  return useRuleMutation((input: RuleInput) => {
    if (!userId) throw new Error('Not signed in');
    return createRule(userId, input);
  });
}

export function useUpdateRule() {
  return useRuleMutation(
    ({ ruleId, changes }: { ruleId: string; changes: TablesUpdate<'transaction_rules'> }) =>
      updateRule(ruleId, changes),
  );
}

export function useDeleteRule() {
  return useRuleMutation((ruleId: string) => deleteRule(ruleId));
}
