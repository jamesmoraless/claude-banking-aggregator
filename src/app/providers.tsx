import { QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

import { ErrorBoundary } from '@/components/common/error-boundary';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/features/auth/auth-context';

import { createQueryClient } from './query-client';

/**
 * Application providers.
 *
 * The QueryClient is created once per mount rather than at module scope, so
 * tests can render a fresh, isolated cache without one test's data leaking into
 * the next.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(createQueryClient);

  return (
    <ErrorBoundary region="the application">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
