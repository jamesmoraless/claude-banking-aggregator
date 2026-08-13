import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import { InlineMetric } from '@/components/common/metric-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { useCashflowSummary } from '@/features/cash-flow/hooks';
import { IncomeSpendingChart } from '@/features/cash-flow/income-spending-chart';
import { formatMonthLabelLong } from '@/lib/financial/dates';
import { cn } from '@/lib/utils';

type CashflowSummary = ReturnType<typeof useCashflowSummary>;

/**
 * Cash flow at a glance.
 *
 * Shows the CURRENT month's headline figures above a six-month chart, matching
 * how the question is usually asked ("how am I doing this month?") while giving
 * the trend the context to answer "is that normal?".
 */
export function CashFlowSummaryCard({
  cashflow,
  className,
}: {
  cashflow: CashflowSummary;
  className?: string;
}) {
  const currentMonth = cashflow.months.at(-1);
  const currency = cashflow.totals.currency;

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle>
            Cash Flow{currentMonth ? ` — ${formatMonthLabelLong(currentMonth.month_start)}` : ''}
          </CardTitle>
          <p className="text-sm text-muted-foreground">Last 6 months</p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/cash-flow">
            View details
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-5">
        <div className="grid grid-cols-3 gap-4">
          <InlineMetric
            label="Income"
            value={cashflow.isLoading ? null : (currentMonth?.actual_income ?? null)}
            currency={currency}
            emphasis="positive"
          />
          <InlineMetric
            label="Actual spending"
            value={cashflow.isLoading ? null : (currentMonth?.actual_spending ?? null)}
            currency={currency}
          />
          <InlineMetric
            label="Savings rate"
            value={cashflow.isLoading ? null : (currentMonth?.savings_rate ?? null)}
            format="percent"
            emphasis={
              currentMonth?.savings_rate != null && currentMonth.savings_rate > 0
                ? 'positive'
                : 'muted'
            }
            sublabel={
              currentMonth && currentMonth.actual_income === 0 ? 'No income recorded' : undefined
            }
          />
        </div>

        <Separator />

        <IncomeSpendingChart
          months={cashflow.months}
          isLoading={cashflow.isLoading}
          isError={cashflow.isError}
          error={cashflow.error}
          onRetry={() => void cashflow.refetch()}
          height={240}
        />

        {/* Unclassified outflows sit outside Actual Spending, so the number is
            understated until they are reviewed. Saying so is the difference
            between a figure that is wrong and one that is provisional. */}
        {cashflow.totals.unclassifiedTransactionCount > 0 ? (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            {cashflow.totals.unclassifiedTransactionCount} transaction
            {cashflow.totals.unclassifiedTransactionCount === 1 ? '' : 's'} could not be classified
            automatically and {cashflow.totals.unclassifiedTransactionCount === 1 ? 'is' : 'are'} not
            counted above.{' '}
            <Link to="/transactions?review=1" className="font-medium text-primary hover:underline">
              Review them
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
