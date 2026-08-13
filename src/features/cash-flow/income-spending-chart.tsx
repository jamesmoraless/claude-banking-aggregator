import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ChartContainer } from '@/components/common/chart-container';
import type { MonthlyCashflowRow } from '@/features/cash-flow/api';
import { formatMonthLabel } from '@/lib/financial/dates';
import { formatMoney, formatMoneyAxis } from '@/lib/financial/money';

/**
 * Income vs Actual Spending, by month.
 *
 * Plots actual spending, not gross debits — transfers between the user's own
 * accounts and credit-card payments are already removed by the time the data
 * reaches here. Charting gross debits would double-count every transfer and
 * make the bars disagree with the metric cards above them.
 */
export function IncomeSpendingChart({
  months,
  isLoading,
  isError,
  error,
  onRetry,
  height = 280,
}: {
  months: MonthlyCashflowRow[];
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  height?: number;
}) {
  const currency = months[0]?.currency ?? 'CAD';
  const hasActivity = months.some((month) => month.transaction_count > 0);

  const data = months.map((month) => ({
    month: formatMonthLabel(month.month_start),
    Income: month.actual_income,
    'Actual Spending': month.actual_spending,
  }));

  return (
    <ChartContainer
      label="income compared with actual spending by month"
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={onRetry}
      isEmpty={!hasActivity}
      emptyTitle="No cash-flow data yet"
      emptyDescription="Once transactions have synced, your monthly income and spending will appear here."
      height={height}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }} barGap={4}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={(value: number) => formatMoneyAxis(value, currency)}
          />
          <Tooltip
            cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }}
            contentStyle={{
              borderRadius: 'var(--radius)',
              border: '1px solid hsl(var(--border))',
              backgroundColor: 'hsl(var(--popover))',
              fontSize: 13,
            }}
            formatter={(value: number, name: string) => [formatMoney(value, { currency }), name]}
          />
          <Legend
            verticalAlign="top"
            align="left"
            height={32}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}
          />
          <Bar dataKey="Income" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar
            dataKey="Actual Spending"
            fill="hsl(var(--chart-1))"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
