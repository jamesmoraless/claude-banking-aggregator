import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useUserId } from '@/features/auth/auth-context';
import { requireSupabase } from '@/lib/supabase/client';
import { unwrapMaybe } from '@/lib/supabase/errors';
import { queryKeys } from '@/lib/supabase/query-keys';
import type { Tables, TablesUpdate } from '@/types/database.types';

export type Profile = Tables<'profiles'>;

/**
 * The profile row is created automatically by a trigger on auth.users, so a
 * signed-in user always has one. It is fetched with maybeSingle rather than
 * single so that the brief window before the trigger commits renders as
 * "loading", not as an error.
 */
async function fetchProfile(userId: string): Promise<Profile | null> {
  const supabase = requireSupabase();
  return unwrapMaybe(
    'Load profile',
    await supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
  );
}

export function useProfile() {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.profile(userId ?? 'anonymous'),
    queryFn: () => fetchProfile(userId!),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });
}

/** Base reporting currency, defaulting to CAD until the profile loads. */
export function useBaseCurrency(): string {
  return useProfile().data?.base_currency ?? 'CAD';
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const userId = useUserId();

  return useMutation({
    mutationFn: async (changes: TablesUpdate<'profiles'>) => {
      const supabase = requireSupabase();
      const { error } = await supabase.from('profiles').update(changes).eq('id', userId!);
      if (error) throw error;
    },
    onSuccess: (_result, changes) => {
      if (!userId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) });
      // Base currency decides which rows aggregate at all, so every figure
      // must be recomputed when it changes.
      if (changes.base_currency) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.all(userId) });
      }
    },
  });
}
