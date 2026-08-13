import {
  ArrowLeftRight,
  BarChart3,
  CreditCard,
  Percent,
  PiggyBank,
  RotateCcw,
  Store,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';

import { MetricCard, MetricCardSkeleton } from '@/components/common/metric-card';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorCard } from '@/components/common/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useHasConnections } from '@/features/accounts/hooks';
import { ConnectInstitutionButton } from '@/features/connections/connect-institution-button';
import { OnboardingPanel } from '@/features/onboarding/onboarding-panel';
import { useBaseCurrency } from '@/features/profile/hooks';
import {
  EXCLUSION_BUCKET_DESCRIPTIONS,
  EXCLUSION_BUCKET_LABELS,
  type ExclusionBucket,
  isExclusionBucket,
} from '@/lib/financial/classification';
import {
  type DateRange,
  formatRangeLabel,
  RANGE_PRESETS,
  type RangePresetId,
  resolveRangePreset,
} from '@/lib/financial/dates';
import { formatMoney } from '@/lib/financial/money';

import { CalculationSummary } from './calculation-summary';
import {
  useCashflowSummary,
  useSpendingByCategory,
  useTopMerchants,
  useTransferSummary,
} from './hooks';
import { IncomeSpendingChart } from './income-spending-chart';
import { SpendingBreakdownChart } from './spending-breakdown-chart';

/**
 * Cash Flow.
 *
 * Answers "what did I actually earn and spend, and how do you know?" — the
 * headline metrics, the trend, where the money went, what was deliberately left
 * out, and the arithmetic that connects them.
 *
 * Every figure links through to the transactions behind it, so nothing here has
 * to be taken on trust.
 */
export function CashFlowPage() {
  const navigate = useNavigate();
  const connections = useHasConnections();
  const baseCurrency = useBaseCurrency();

  const [preset, setPreset] = React.useState<RangePresetId>('6M');
  const [customRange, setCustomRange] = React.useState<DateRange | null>(null);

  const range = React.useMemo(
    () => (preset === 'CUSTOM' && customRange ? customRange : resolveRangePreset(preset)),
    [preset, customRange],
  );

  const cashflow = useCashflowSummary(range);
  const categories = useSpendingByCategory(range);
  const merchants = useTopMerchants(range, 8);
  const excluded = useTransferSummary(range);

  const currency = cashflow.totals.currency || baseCurrency;

  /** Opens the Transactions screen pre-filtered to whatever was clicked. */
  const inspect = React.useCallback(
    (params: Record<string, string>) => {
      const search = new URLSearchParams({ from: range.from, to: range.to, ...params });
      void navigate(`/transactions?${search.toString()}`);
    },
    [navigate, range],
  );

  if (connections.isLoading) return <CashFlowSkeleton />;

  if (!connections.hasAnyAccount) {
    return (
      <div className="space-y-6">
        <PageHeader title="Cash Flow" description="What you actually earned and spent." />
        <OnboardingPanel connectAction={<ConnectInstitutionButton size="lg" />} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cash Flow"
        description={formatRangeLabel(range)}
        actions={
          <div className="flex rounded-lg border border-input p-0.5" role="group" aria-label="Date range">
            {RANGE_PRESETS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={preset === option.id}
                onClick={() => setPreset(option.id)}
                className={
                  preset === option.id
                    ? 'rounded-md bg-primary-subtle px-3 py-1 text-sm font-medium text-primary'
                    : 'rounded-md px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                }
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={preset === 'CUSTOM'}
              onClick={() => {
                setCustomRange(range);
                setPreset('CUSTOM');
              }}
              className={
                preset === 'CUSTOM'
                  ? 'rounded-md bg-primary-subtle px-3 py-1 text-sm font-medium text-primary'
                  : 'rounded-md px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              }
            >
              Custom
            </button>
          </div>
        }
      />

      {preset === 'CUSTOM' ? (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-4 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="range-from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="range-from"
                type="date"
                value={range.from}
                onChange={(event) => setCustomRange({ ...range, from: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="range-to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="range-to"
                type="date"
                value={range.to}
                onChange={(event) => setCustomRange({ ...range, to: event.target.value })}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {cashflow.isError ? (
        <ErrorCard
          title="We couldn't load your cash flow"
          error={cashflow.error}
          onRetry={() => void cashflow.refetch()}
        />
      ) : (
        <>
          <section aria-label="Cash flow summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cashflow.isLoading ? (
              Array.from({ length: 4 }).map((_, index) => <MetricCardSkeleton key={index} />)
            ) : (
              <>
                <MetricCard
                  label="Income"
                  value={cashflow.totals.actualIncome}
                  currency={currency}
                  icon={TrendingUp}
                  iconClassName="bg-primary-subtle text-primary"
                  trend={
                    cashflow.comparison.available
                      ? { change: cashflow.comparison.income, label: 'vs previous period' }
                      : undefined
                  }
                  hint="Money you earned, with internal transfers and refunds excluded."
                  onClick={() => inspect({ types: 'INCOME' })}
                />
                <MetricCard
                  label="Actual Spending"
                  value={cashflow.totals.actualSpending}
                  currency={currency}
                  icon={TrendingDown}
                  iconClassName="bg-accent text-accent-foreground"
                  trend={
                    cashflow.comparison.available
                      ? {
                          change: cashflow.comparison.spending,
                          label: 'vs previous period',
                          inverted: true,
                        }
                      : undefined
                  }
                  hint="Expenses less refunds. Transfers between your accounts and credit-card payments are not counted."
                  onClick={() => inspect({ types: 'EXPENSE' })}
                />
                <MetricCard
                  label="Surplus"
                  value={cashflow.totals.surplus}
                  currency={currency}
                  icon={PiggyBank}
                  iconClassName="bg-primary-subtle text-primary"
                  trend={
                    cashflow.comparison.available
                      ? { change: cashflow.comparison.surplus, label: 'vs previous period' }
                      : undefined
                  }
                  hint="Actual income less actual spending."
                />
                <MetricCard
                  label="Savings Rate"
                  value={cashflow.totals.savingsRate}
                  format="percent"
                  icon={Percent}
                  iconClassName="bg-accent text-accent-foreground"
                  hint="Surplus divided by actual income. Undefined when there is no income."
                  footnote={
                    cashflow.totals.savingsRate == null && cashflow.totals.actualIncome === 0
                      ? 'No income recorded in this period'
                      : null
                  }
                />
              </>
            )}
          </section>

          {cashflow.isEmpty && !cashflow.isLoading ? (
            <Card>
              <CardContent className="p-0">
                <EmptyState
                  icon={BarChart3}
                  title="No transactions in this period"
                  description="Try a wider date range, or synchronise your accounts to import more history."
                />
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-6 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Income vs Spending</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <IncomeSpendingChart
                      months={cashflow.months}
                      isLoading={cashflow.isLoading}
                      isError={cashflow.isError}
                      error={cashflow.error}
                      onRetry={() => void cashflow.refetch()}
                      height={300}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Spending Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <SpendingBreakdownChart
                      categories={categories.data ?? []}
                      currency={currency}
                      isLoading={categories.isLoading}
                      isError={categories.isError}
                      error={categories.error}
                      onRetry={() => void categories.refetch()}
                      onSelectCategory={(category) => inspect({ categories: category })}
                    />
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-6 xl:grid-cols-3">
                <ExcludedFromSpendingCard
                  rows={excluded.data ?? []}
                  currency={currency}
                  isLoading={excluded.isLoading}
                  onInspect={(bucket) => inspect({ bucket })}
                />

                <CalculationSummary
                  explanation={cashflow.explanation}
                  totals={cashflow.totals}
                  onInspectBucket={(bucket) => inspect({ bucket })}
                />

                <TopMerchantsCard
                  merchants={merchants.data ?? []}
                  currency={currency}
                  isLoading={merchants.isLoading}
                  onInspect={(merchant) => inspect({ q: merchant })}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const BUCKET_ICONS: Partial<Record<ExclusionBucket, React.ComponentType<{ className?: string }>>> = {
  INTERNAL_TRANSFER: ArrowLeftRight,
  CREDIT_CARD_PAYMENT: CreditCard,
  INVESTMENT_TRANSFER: TrendingUp,
  REFUND: RotateCcw,
};

function ExcludedFromSpendingCard({
  rows,
  currency,
  isLoading,
  onInspect,
}: {
  rows: { bucket: string; amount: number; transaction_count: number }[];
  currency: string;
  isLoading: boolean;
  onInspect: (bucket: string) => void;
}) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Excluded from Spending</CardTitle>
        <p className="text-sm text-muted-foreground">These are not counted as true spending.</p>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing excluded"
            description="No transfers, card payments or refunds were found in this period."
            compact
          />
        ) : (
          <>
            {rows.map((row) => {
              const Icon = isExclusionBucket(row.bucket)
                ? (BUCKET_ICONS[row.bucket] ?? ArrowLeftRight)
                : ArrowLeftRight;
              const label = isExclusionBucket(row.bucket)
                ? EXCLUSION_BUCKET_LABELS[row.bucket]
                : row.bucket;
              const description = isExclusionBucket(row.bucket)
                ? EXCLUSION_BUCKET_DESCRIPTIONS[row.bucket]
                : '';

              return (
                <button
                  key={row.bucket}
                  type="button"
                  onClick={() => onInspect(row.bucket)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{description}</span>
                  </span>
                  <span className="shrink-0 text-sm font-medium tabular-money">
                    {formatMoney(row.amount, { currency })}
                  </span>
                </button>
              );
            })}
            <div className="flex items-center justify-between border-t border-border px-2 pt-3">
              <span className="text-sm font-medium">Total excluded</span>
              <span className="text-sm font-semibold tabular-money">
                {formatMoney(total, { currency })}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TopMerchantsCard({
  merchants,
  currency,
  isLoading,
  onInspect,
}: {
  merchants: { merchant: string; amount: number; transaction_count: number }[];
  currency: string;
  isLoading: boolean;
  onInspect: (merchant: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Merchants</CardTitle>
        <p className="text-sm text-muted-foreground">By actual spending, net of refunds.</p>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)
        ) : merchants.length === 0 ? (
          <EmptyState
            icon={Store}
            title="No merchant spending"
            description="Merchants appear here once expenses are recorded in this period."
            compact
          />
        ) : (
          merchants.map((merchant) => (
            <button
              key={merchant.merchant}
              type="button"
              onClick={() => onInspect(merchant.merchant)}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{merchant.merchant}</span>
                <span className="block text-xs text-muted-foreground">
                  {merchant.transaction_count} transaction
                  {merchant.transaction_count === 1 ? '' : 's'}
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium tabular-money">
                {formatMoney(merchant.amount, { currency })}
              </span>
            </button>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function CashFlowSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeader title="Cash Flow" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <MetricCardSkeleton key={index} />
        ))}
      </div>
      <Skeleton className="h-80 w-full rounded-xl" />
      <span role="status" aria-live="polite" className="sr-only">
        Loading cash flow
      </span>
    </div>
  );
}
