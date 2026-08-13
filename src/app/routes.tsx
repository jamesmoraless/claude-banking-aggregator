import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { ErrorBoundary } from '@/components/common/error-boundary';
import { Skeleton } from '@/components/ui/skeleton';
import { AccountsPage } from '@/features/accounts/accounts-page';
import { useAuth } from '@/features/auth/auth-context';
import { AuthPage } from '@/features/auth/auth-page';
import { CashFlowPage } from '@/features/cash-flow/cash-flow-page';
import { ChatPage } from '@/features/chat/chat-page';
import { OverviewPage } from '@/features/overview/overview-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { TransactionsPage } from '@/features/transactions/transactions-page';
import { TransferReviewPage } from '@/features/transfers/transfer-review-page';

import { AppShell } from './app-shell';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/sign-in" element={<AuthPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<RouteBoundary region="the overview"><OverviewPage /></RouteBoundary>} />
        <Route path="accounts" element={<RouteBoundary region="accounts"><AccountsPage /></RouteBoundary>} />
        <Route
          path="transactions"
          element={<RouteBoundary region="transactions"><TransactionsPage /></RouteBoundary>}
        />
        <Route
          path="transactions/transfers"
          element={<RouteBoundary region="transfer review"><TransferReviewPage /></RouteBoundary>}
        />
        <Route path="cash-flow" element={<RouteBoundary region="cash flow"><CashFlowPage /></RouteBoundary>} />
        <Route path="chat" element={<RouteBoundary region="Atlas AI"><ChatPage /></RouteBoundary>} />
        <Route path="settings" element={<RouteBoundary region="settings"><SettingsPage /></RouteBoundary>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * Per-route error containment: a failure in one screen leaves the shell and
 * navigation intact so the user can move somewhere that works.
 */
function RouteBoundary({ region, children }: { region: string; children: React.ReactNode }) {
  return <ErrorBoundary region={region}>{children}</ErrorBoundary>;
}

/**
 * Auth gate.
 *
 * While the session is resolving it renders a skeleton rather than redirecting,
 * so a page refresh on an authenticated session does not flash the sign-in
 * screen. The attempted path is preserved and restored after sign-in.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-64 border-r border-border bg-card p-4 lg:block">
          <Skeleton className="h-8 w-36" />
          <div className="mt-6 space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 space-y-4 p-8">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
        <span role="status" aria-live="polite" className="sr-only">
          Loading Cash Atlas
        </span>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
