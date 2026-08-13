import { Banknote, Landmark, PiggyBank, TrendingUp } from 'lucide-react';
import { AlertCircle } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';

import { DataFreshnessIndicator } from '@/components/common/data-freshness';
import { MetricCard, MetricCardSkeleton } from '@/components/common/metric-card';
import { PageHeader } from '@/components/common/page-header';
import { ErrorCard } from '@/components/common/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useCashSummary, useDataFreshness, useHasConnections } from '@/features/accounts/hooks';
import { useCashflowSummary } from '@/features/cash-flow/hooks';
import { ConnectInstitutionButton } from '@/features/connections/connect-institution-button';
import { useRefreshConnections } from '@/features/connections/hooks';
import { OnboardingPanel } from '@/features/onboarding/onboarding-panel';
import { resolveRangePreset } from '@/lib/financial/dates';

import { CashFlowSummaryCard } from './cash-flow-summary-card';
import { ConnectedInstitutionsCard } from './connected-institutions-card';
import { InsightsCard } from './insights-card';
import { RecentActivityCard } from './recent-activity-card';

/**
 * Overview.
 *
 * Three top-level states, chosen in this order:
 *   1. Still determining whether anything is connected → skeletons.
 *   2. Nothing connected → onboarding, NOT a grid of $0.00 cards.
 *   3. Connected → real figures, each with its own loading/error handling so
 *      one failing card cannot blank the page.
 */
export function OverviewPage() {
  const connections = useHasConnections();
  const cashSummary = useCashSummary();
  const freshness = useDataFreshness();
  const refresh = useRefreshConnections();

  const range = React.useMemo(() => resolveRangePreset('6M'), []);
  const cashflow = useCashflowSummary(range);

  const currentMonth = cashflow.months.at(-1);
  const currency = cashSummary.data?.currency ?? 'CAD';

  if (connections.isLoading) {
    return <OverviewSkeleton />;
  }

  if (connections.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" />
        <ErrorCard
          title="We couldn't load your accounts"
          error={connections.error}
          onRetry={connections.refetch}
        />
      </div>
    );
  }

  if (!connections.hasAnyAccount) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Overview"
          description="Your cash position, income and spending in one place."
        />
        <OnboardingPanel connectAction={<ConnectInstitutionButton size="lg" />} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Your cash position, income and spending in one place."
        actions={
          <DataFreshnessIndicator
            freshness={freshness.overall}
            onRefresh={() => refresh.mutate(undefined)}
            isRefreshing={refresh.isPending}
          />
        }
      />

      {freshness.needsReconnect.length > 0 ? (
        <Alert variant="warning">
          <AlertCircle aria-hidden="true" />
          <div className="flex-1 space-y-1">
            <AlertTitle>
              {freshness.needsReconnect.length === 1
                ? `${freshness.needsReconnect[0]!.institution_name} needs to be reconnected`
                : `${freshness.needsReconnect.length} institutions need to be reconnected`}
            </AlertTitle>
            <AlertDescription>
              Balances and transactions from{' '}
              {freshness.needsReconnect.length === 1 ? 'this institution' : 'these institutions'} are
              not updating, so the figures below may be incomplete.
            </AlertDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings">Reconnect</Link>
          </Button>
        </Alert>
      ) : null}

      {/* Balances come from account snapshots; cash-flow figures come from
          transactions. They load independently, so each card owns its state. */}
      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total Cash"
          value={cashSummary.data?.total_cash ?? null}
          currency={currency}
          icon={Banknote}
          iconClassName="bg-primary-subtle text-primary"
          isLoading={cashSummary.isLoading}
          hint="Balances of every account you have marked as cash, in your base currency."
          footnote={
            cashSummary.data && cashSummary.data.excluded_account_count > 0 ? (
              <span className="text-finance-warning">
                Excludes {cashSummary.data.excluded_account_count} account
                {cashSummary.data.excluded_account_count === 1 ? '' : 's'} in{' '}
                {cashSummary.data.excluded_currencies.join(', ')}
              </span>
            ) : null
          }
        />
        <MetricCard
          label="Checking"
          value={cashSummary.data?.checking_total ?? null}
          currency={currency}
          icon={Landmark}
          iconClassName="bg-accent text-accent-foreground"
          isLoading={cashSummary.isLoading}
          footnote={
            cashSummary.data
              ? `${cashSummary.data.checking_account_count} account${cashSummary.data.checking_account_count === 1 ? '' : 's'}`
              : null
          }
        />
        <MetricCard
          label="Savings"
          value={cashSummary.data?.savings_total ?? null}
          currency={currency}
          icon={PiggyBank}
          iconClassName="bg-primary-subtle text-primary"
          isLoading={cashSummary.isLoading}
          footnote={
            cashSummary.data
              ? `${cashSummary.data.savings_account_count} account${cashSummary.data.savings_account_count === 1 ? '' : 's'}`
              : null
          }
        />
        <MetricCard
          label="This Month Surplus"
          value={currentMonth?.surplus ?? null}
          currency={currency}
          icon={TrendingUp}
          iconClassName="bg-primary-subtle text-primary"
          isLoading={cashflow.isLoading}
          hint="Actual income less actual spending this month, with internal transfers and credit-card payments excluded."
          footnote={
            currentMonth && currentMonth.transaction_count === 0
              ? 'No transactions recorded this month yet'
              : null
          }
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <CashFlowSummaryCard cashflow={cashflow} className="xl:col-span-2" />
        <ConnectedInstitutionsCard />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <RecentActivityCard className="xl:col-span-2" />
        <InsightsCard range={range} cashflow={cashflow} />
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeader title="Overview" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <MetricCardSkeleton key={index} />
        ))}
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        Loading your financial overview
      </span>
    </div>
  );
}
