import { QueryCache, QueryClient } from '@tanstack/react-query';

import { logger } from '@/lib/logger';

/**
 * TanStack Query configuration.
 *
 * Financial data changes when a sync runs, not continuously, so refetching
 * aggressively costs requests without improving accuracy. Instead the app
 * invalidates precisely after mutations (connect, refresh, reclassify), which
 * is both cheaper and more predictable than polling.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        logger.error('Query failed', {
          queryKey: JSON.stringify(query.queryKey),
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }),
    defaultOptions: {
      queries: {
        // Data only moves when a sync runs.
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          // Never retry a configuration or authorisation problem: it will fail
          // identically every time and just delays the actionable message.
          const code = (error as { code?: string } | null)?.code;
          if (
            code === 'SUPABASE_NOT_CONFIGURED' ||
            code === 'PGRST301' ||
            code === '42501' ||
            code === 'PGRST202'
          ) {
            return false;
          }
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        retry: false,
      },
    },
  });
}
