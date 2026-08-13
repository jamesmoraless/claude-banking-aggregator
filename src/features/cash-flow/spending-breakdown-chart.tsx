import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { chartColor, ChartContainer } from '@/components/common/chart-container';
import { formatCategoryName } from '@/features/overview/insights-card';
import { formatMoney, formatPercent } from '@/lib/financial/money';

import type { SpendingByCategoryRow } from './api';

/**
 * Spending by category.
 *
 * The legend carries the amount and share for every slice, so the chart is not
 * the only way to read the data — which is what keeps it usable for anyone who
 * cannot distinguish the colours.
 *
 * Negative categories (more refunded than spent) are excluded from the ring,
 * because a negative slice has no meaningful area. They are still listed, with
 * their value, below.
 */
export function SpendingBreakdownChart({
  categories,
  currency,
  isLoading,
  isError,
  error,
  onRetry,
  onSelectCategory,
}: {
  categories: SpendingByCategoryRow[];
  currency: string;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onSelectCategory?: (category: string) => void;
}) {
  const positive = categories.filter((row) => row.amount > 0);
  const negative = categories.filter((row) => row.amount <= 0);
  const total = positive.reduce((sum, row) => sum + row.amount, 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,220px)_1fr] lg:items-center">
      <ChartContainer
        label="spending by category"
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={onRetry}
        isEmpty={positive.length === 0}
        emptyTitle="No spending recorded"
        emptyDescription="Once transactions are classified as expenses they will appear here."
        height={220}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={positive}
              dataKey="amount"
              nameKey="category"
              innerRadius={62}
              outerRadius={92}
              paddingAngle={2}
              strokeWidth={0}
            >
              {positive.map((row, index) => (
                <Cell key={row.category} fill={chartColor(index)} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                borderRadius: 'var(--radius)',
                border: '1px solid hsl(var(--border))',
                backgroundColor: 'hsl(var(--popover))',
                fontSize: 13,
              }}
              formatter={(value: number, name: string) => [
                formatMoney(value, { currency }),
                formatCategoryName(String(name)),
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </ChartContainer>

      {positive.length > 0 || negative.length > 0 ? (
        <ul className="space-y-1.5">
          {positive.map((row, index) => (
            <li key={row.category}>
              <CategoryRow
                category={row.category}
                amount={row.amount}
                share={row.share ?? (total > 0 ? row.amount / total : null)}
                color={chartColor(index)}
                currency={currency}
                onSelect={onSelectCategory}
              />
            </li>
          ))}
          {negative.map((row) => (
            <li key={row.category}>
              <CategoryRow
                category={row.category}
                amount={row.amount}
                share={null}
                color="hsl(var(--muted-foreground))"
                currency={currency}
                note="net refund"
                onSelect={onSelectCategory}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CategoryRow({
  category,
  amount,
  share,
  color,
  currency,
  note,
  onSelect,
}: {
  category: string;
  amount: number;
  share: number | null;
  color: string;
  currency: string;
  note?: string;
  onSelect?: (category: string) => void;
}) {
  const content = (
    <>
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate">{formatCategoryName(category)}</span>
      <span className="shrink-0 tabular-money font-medium">{formatMoney(amount, { currency })}</span>
      <span className="w-14 shrink-0 text-right tabular-money text-xs text-muted-foreground">
        {note ?? (share != null ? formatPercent(share) : '—')}
      </span>
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(category)}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {content}
      </button>
    );
  }

  return <div className="flex items-center gap-2.5 px-2 py-1.5 text-sm">{content}</div>;
}
