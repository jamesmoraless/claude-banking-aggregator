import { ArrowRight, HelpCircle, Lightbulb, PiggyBank, TrendingDown, TrendingUp } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';

import { EmptyState } from '@/components/common/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { useCashflowSummary } from '@/features/cash-flow/hooks';
import { useSpendingByCategory } from '@/features/cash-flow/hooks';
import { useTransferReviewCount } from '@/features/transfers/hooks';
import { type DateRange, previousPeriod } from '@/lib/financial/dates';
import { formatMoney, formatPercent } from '@/lib/financial/money';

/**
 * Insights.
 *
 * Every item is computed from the user's own synchronised data and states the
 * figures it is derived from. There are deliberately no peer comparisons
 * ("you're in the top 25% of users") — Cash Atlas has no cohort to compare
 * against, and inventing one would be fabricating a financial claim.
 *
 * Insights that require the user to act come first, because an unreviewed
 * transfer makes every spending figure on this page provisional.
 */

type Insight = {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'info' | 'warning' | 'positive';
  title: string;
  description: string;
  to?: string;
};

type CashflowSummary = ReturnType<typeof useCashflowSummary>;

export function InsightsCard({
  range,
  cashflow,
  className,
}: {
  range: DateRange;
  cashflow: CashflowSummary;
  className?: string;
}) {
  const comparisonRange = React.useMemo(() => previousPeriod(range), [range]);
  const currentCategories = useSpendingByCategory(range);
  const previousCategories = useSpendingByCategory(comparisonRange);
  const reviewCount = useTransferReviewCount();

  const isLoading = cashflow.isLoading || currentCategories.isLoading;

  const insights = React.useMemo(
    () =>
      buildInsights({
        totals: cashflow.totals,
        reviewCount,
        currentCategories: currentCategories.data ?? [],
        previousCategories: previousCategories.data ?? [],
      }),
    [cashflow.totals, reviewCount, currentCategories.data, previousCategories.data],
  );

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Insights</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-3 px-5 pb-5">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : insights.length === 0 ? (
          <EmptyState
            icon={Lightbulb}
            title="No insights yet"
            description="Once a full month of transactions has synced, Cash Atlas will highlight changes worth knowing about."
            compact
          />
        ) : (
          <ul className="divide-y divide-border">
            {insights.map((insight) => (
              <li key={insight.id}>
                <InsightRow insight={insight} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function InsightRow({ insight }: { insight: Insight }) {
  const content = (
    <>
      <span
        className={
          insight.tone === 'warning'
            ? 'flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-finance-warning'
            : insight.tone === 'positive'
              ? 'flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary'
              : 'flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground'
        }
      >
        <insight.icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block text-sm font-medium">{insight.title}</span>
        <span className="block text-sm leading-relaxed text-muted-foreground">
          {insight.description}
        </span>
      </span>
      {insight.to ? (
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : null}
    </>
  );

  if (insight.to) {
    return (
      <Link
        to={insight.to}
        className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
      >
        {content}
      </Link>
    );
  }

  return <div className="flex items-start gap-3 px-5 py-4">{content}</div>;
}

type CategoryRow = { category: string; amount: number };

/** Pure, so the derivation of every insight is directly testable. */
export function buildInsights({
  totals,
  reviewCount,
  currentCategories,
  previousCategories,
}: {
  totals: CashflowSummary['totals'];
  reviewCount: number;
  currentCategories: CategoryRow[];
  previousCategories: CategoryRow[];
}): Insight[] {
  const insights: Insight[] = [];
  const currency = totals.currency;

  if (reviewCount > 0) {
    insights.push({
      id: 'transfer-review',
      icon: HelpCircle,
      tone: 'warning',
      title: `${reviewCount} possible transfer${reviewCount === 1 ? '' : 's'} to review`,
      description:
        'Confirming these keeps money moved between your own accounts out of your spending totals.',
      to: '/transactions/transfers',
    });
  }

  if (totals.unclassifiedTransactionCount > 0) {
    insights.push({
      id: 'unclassified',
      icon: HelpCircle,
      tone: 'warning',
      title: `${totals.unclassifiedTransactionCount} transaction${totals.unclassifiedTransactionCount === 1 ? '' : 's'} need classifying`,
      description: `${formatMoney(totals.unclassifiedOutflows, { currency })} is not counted in your spending until ${totals.unclassifiedTransactionCount === 1 ? 'it is' : 'they are'} categorised.`,
      to: '/transactions?review=1',
    });
  }

  // Largest category movement, only where a like-for-like comparison exists.
  const previousByCategory = new Map(previousCategories.map((row) => [row.category, row.amount]));
  let biggestMove: { category: string; delta: number; current: number; previous: number } | null =
    null;

  for (const row of currentCategories) {
    const previous = previousByCategory.get(row.category);
    if (previous == null || previous <= 0) continue;
    const delta = row.amount - previous;
    if (!biggestMove || Math.abs(delta) > Math.abs(biggestMove.delta)) {
      biggestMove = { category: row.category, delta, current: row.amount, previous };
    }
  }

  if (biggestMove && Math.abs(biggestMove.delta) >= 50) {
    const increased = biggestMove.delta > 0;
    const percent = Math.abs(biggestMove.delta) / biggestMove.previous;
    insights.push({
      id: 'category-move',
      icon: increased ? TrendingUp : TrendingDown,
      tone: increased ? 'warning' : 'positive',
      title: `${formatCategoryName(biggestMove.category)} spending is ${increased ? 'up' : 'down'} ${formatPercent(percent, { fractionDigits: 0 })}`,
      description: `${formatMoney(Math.abs(biggestMove.delta), { currency })} ${increased ? 'more' : 'less'} than the previous period (${formatMoney(biggestMove.current, { currency })} vs ${formatMoney(biggestMove.previous, { currency })}).`,
      to: '/cash-flow',
    });
  }

  if (totals.internalTransfers > 0) {
    insights.push({
      id: 'internal-transfers',
      icon: PiggyBank,
      tone: 'info',
      title: `${formatMoney(totals.internalTransfers, { currency })} moved between your accounts`,
      description:
        'Excluded from spending, because moving your own money is not an expense.',
      to: '/cash-flow',
    });
  }

  if (totals.savingsRate != null && totals.actualIncome > 0) {
    insights.push({
      id: 'savings-rate',
      icon: totals.savingsRate >= 0 ? TrendingUp : TrendingDown,
      tone: totals.savingsRate >= 0 ? 'positive' : 'warning',
      title: `Your savings rate is ${formatPercent(totals.savingsRate)}`,
      description: `${formatMoney(totals.surplus, { currency })} left over from ${formatMoney(totals.actualIncome, { currency })} of income.`,
      to: '/cash-flow',
    });
  }

  return insights.slice(0, 4);
}

/** Plaid categories arrive as GENERAL_MERCHANDISE; people read "General merchandise". */
export function formatCategoryName(category: string): string {
  const cleaned = category.replace(/_/g, ' ').toLowerCase();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
