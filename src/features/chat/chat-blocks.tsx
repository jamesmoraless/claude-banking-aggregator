import { AlertCircle, ArrowRight, CircleDot, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { chartColor } from '@/components/common/chart-container';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCategoryName } from '@/features/overview/insights-card';
import { formatMonthLabel, formatTransactionDate } from '@/lib/financial/dates';
import { evaluateFreshness } from '@/lib/financial/freshness';
import { formatMoney, formatMoneyAxis, formatPercent } from '@/lib/financial/money';
import { cn } from '@/lib/utils';

import type { ChatBlock } from './types';

/**
 * Renders a structured chat block.
 *
 * These components receive DATA, not markup. Claude never generates HTML, and
 * never supplies the figures rendered here — they arrive from the server, built
 * from what a tool returned.
 *
 * Unknown block types render nothing rather than throwing, so a server that has
 * learned a new block type before the client degrades quietly.
 */
export function ChatBlockRenderer({ block }: { block: ChatBlock }) {
  switch (block.type) {
    case 'text':
      return <ProseBlock text={block.text} />;
    case 'metric_grid':
      return <MetricGridBlock block={block} />;
    case 'calculation':
      return <CalculationBlock block={block} />;
    case 'transaction_table':
      return <TransactionTableBlock block={block} />;
    case 'account_list':
      return <AccountListBlock block={block} />;
    case 'bar_chart':
      return <BarChartBlock block={block} />;
    case 'donut_chart':
      return <DonutChartBlock block={block} />;
    case 'alert':
      return <AlertBlock block={block} />;
    case 'freshness':
      return <FreshnessBlock block={block} />;
    default:
      return null;
  }
}

/**
 * Assistant prose.
 *
 * Rendered as plain text with paragraph breaks — deliberately not as HTML or
 * arbitrary Markdown. The model's output is never interpreted as markup.
 */
function ProseBlock({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {text
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length > 0)
        .map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
    </div>
  );
}

function MetricGridBlock({ block }: { block: Extract<ChatBlock, { type: 'metric_grid' }> }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {block.title ? (
          <div>
            <p className="text-sm font-medium">{block.title}</p>
            {block.subtitle ? (
              <p className="text-xs text-muted-foreground">{block.subtitle}</p>
            ) : null}
          </div>
        ) : null}

        <dl
          className={cn(
            'grid gap-4',
            block.metrics.length <= 2
              ? 'grid-cols-2'
              : block.metrics.length <= 4
                ? 'grid-cols-2 lg:grid-cols-4'
                : 'grid-cols-2 lg:grid-cols-4',
          )}
        >
          {block.metrics.map((metric) => (
            <div key={metric.label} className="min-w-0 space-y-1">
              <dt className="truncate text-xs font-medium text-muted-foreground">{metric.label}</dt>
              <dd
                className={cn(
                  'text-metric-sm tabular-money',
                  metric.emphasis === 'positive' && 'text-finance-inflow',
                  metric.emphasis === 'negative' && 'text-destructive',
                  metric.emphasis === 'muted' && 'text-muted-foreground',
                )}
              >
                {metric.value == null
                  ? '—'
                  : metric.format === 'percent'
                    ? formatPercent(metric.value)
                    : metric.format === 'count'
                      ? metric.value.toLocaleString()
                      : formatMoney(metric.value, { currency: metric.currency })}
              </dd>
              {metric.sublabel ? (
                <p className="truncate text-xs text-muted-foreground">{metric.sublabel}</p>
              ) : null}
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/** The audit trail: exactly the panel the Cash Flow screen shows. */
function CalculationBlock({ block }: { block: Extract<ChatBlock, { type: 'calculation' }> }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {block.title}
          <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </p>

        <dl className="space-y-1">
          {block.lines.map((line) => (
            <div key={line.label} className="flex items-baseline justify-between gap-4">
              <dt
                className={cn(
                  'text-sm',
                  line.operator === 'BASE' ? 'font-medium' : 'text-muted-foreground',
                )}
              >
                {line.label}
              </dt>
              <dd className="shrink-0 text-sm tabular-money">
                {line.operator === 'SUBTRACT' && line.amount > 0 ? '−' : ''}
                {formatMoney(line.amount, { currency: block.currency })}
              </dd>
            </div>
          ))}

          <div className="flex items-baseline justify-between gap-4 border-t-2 border-foreground/10 pt-2">
            <dt className="text-sm font-semibold">{block.result.label}</dt>
            <dd className="text-metric-sm tabular-money">
              {formatMoney(block.result.amount, { currency: block.currency })}
            </dd>
          </div>
        </dl>

        {!block.balances ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>
              {block.note ?? 'These components do not add up to the total shown.'}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TransactionTableBlock({
  block,
}: {
  block: Extract<ChatBlock, { type: 'transaction_table' }>;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="text-sm font-medium">{block.title}</p>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Date</TableHead>
              <TableHead>Merchant</TableHead>
              <TableHead className="hidden sm:table-cell">Account</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {block.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatTransactionDate(row.date)}
                </TableCell>
                <TableCell className="max-w-[14rem]">
                  <p className="truncate text-sm">{row.name}</p>
                </TableCell>
                <TableCell className="hidden max-w-[10rem] sm:table-cell">
                  <p className="truncate text-xs text-muted-foreground">{row.account}</p>
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={cn(
                      'text-sm tabular-money',
                      row.direction === 'INFLOW' && 'text-finance-inflow',
                    )}
                  >
                    <span aria-hidden="true">{row.direction === 'INFLOW' ? '+' : '−'}</span>
                    {formatMoney(row.amount, { currency: row.currency })}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {block.truncated && block.totalMatching ? (
          <p className="text-xs text-muted-foreground">
            Showing {block.rows.length} of {block.totalMatching.toLocaleString()} matching
            transactions.{' '}
            <Link to="/transactions" className="font-medium text-primary hover:underline">
              See all
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AccountListBlock({ block }: { block: Extract<ChatBlock, { type: 'account_list' }> }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="text-sm font-medium">{block.title}</p>
        <ul className="divide-y divide-border">
          {block.accounts.map((account) => (
            <li key={account.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{account.name}</p>
                <p className="truncate text-xs capitalize text-muted-foreground">
                  {account.institution ? `${account.institution} · ` : ''}
                  {account.type}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {account.status && account.status !== 'ACTIVE' ? (
                  <Badge variant="warning">Reconnect</Badge>
                ) : null}
                <span className="text-sm font-medium tabular-money">
                  {formatMoney(account.balance, { currency: account.currency })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function BarChartBlock({ block }: { block: Extract<ChatBlock, { type: 'bar_chart' }> }) {
  const data = block.data.map((entry) => ({
    label: formatMonthLabel(entry.label),
    ...entry.values,
  }));

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="text-sm font-medium">{block.title}</p>
        <div className="h-64" role="img" aria-label={block.title}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={52}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(value: number) => formatMoneyAxis(value, block.currency)}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 'var(--radius)',
                  border: '1px solid hsl(var(--border))',
                  backgroundColor: 'hsl(var(--popover))',
                  fontSize: 13,
                }}
                formatter={(value: number, name: string) => [
                  formatMoney(value, { currency: block.currency }),
                  block.series.find((series) => series.key === name)?.label ?? name,
                ]}
              />
              {block.series.map((series) => (
                <Bar
                  key={series.key}
                  dataKey={series.key}
                  name={series.key}
                  fill={
                    series.color === 'income' ? 'hsl(var(--chart-2))' : 'hsl(var(--chart-1))'
                  }
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          {block.series.map((series) => (
            <li key={series.key} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-full"
                style={{
                  backgroundColor:
                    series.color === 'income' ? 'hsl(var(--chart-2))' : 'hsl(var(--chart-1))',
                }}
                aria-hidden="true"
              />
              {series.label}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function DonutChartBlock({ block }: { block: Extract<ChatBlock, { type: 'donut_chart' }> }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-sm font-medium">{block.title}</p>

        <div className="grid gap-4 sm:grid-cols-[160px_1fr] sm:items-center">
          <div className="h-40" role="img" aria-label={block.title}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={block.slices}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={44}
                  outerRadius={68}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {block.slices.map((slice, index) => (
                    <Cell key={slice.label} fill={chartColor(index)} />
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
                    formatMoney(value, { currency: block.currency }),
                    formatCategoryName(String(name)),
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* The legend carries every value, so the chart is never the only
              way to read the data. */}
          <ul className="space-y-1">
            {block.slices.map((slice, index) => (
              <li key={slice.label} className="flex items-center gap-2 text-sm">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: chartColor(index) }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{formatCategoryName(slice.label)}</span>
                <span className="shrink-0 tabular-money font-medium">
                  {formatMoney(slice.value, { currency: block.currency })}
                </span>
                <span className="w-12 shrink-0 text-right text-xs tabular-money text-muted-foreground">
                  {slice.share != null ? formatPercent(slice.share, { fractionDigits: 0 }) : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function AlertBlock({ block }: { block: Extract<ChatBlock, { type: 'alert' }> }) {
  return (
    <Alert variant={block.variant}>
      {block.variant === 'info' ? (
        <Info aria-hidden="true" />
      ) : (
        <AlertCircle aria-hidden="true" />
      )}
      <div>
        {block.title ? <AlertTitle>{block.title}</AlertTitle> : null}
        <AlertDescription>{block.message}</AlertDescription>
      </div>
    </Alert>
  );
}

function FreshnessBlock({ block }: { block: Extract<ChatBlock, { type: 'freshness' }> }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="text-sm font-medium">Data freshness</p>
        <ul className="space-y-1.5">
          {block.institutions.map((institution) => {
            const freshness = evaluateFreshness(institution.syncedAt);
            return (
              <li key={institution.name} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium">{institution.name}</span>
                {institution.requiresReauth ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-destructive">
                    <AlertCircle className="size-3.5" aria-hidden="true" />
                    reconnect required
                  </span>
                ) : (
                  <span
                    className={cn(
                      'flex shrink-0 items-center gap-1.5',
                      freshness.isStale ? 'text-finance-warning' : 'text-muted-foreground',
                    )}
                  >
                    <CircleDot className="size-3.5" aria-hidden="true" />
                    {freshness.level === 'NEVER' ? 'not synced' : `updated ${freshness.label}`}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <Link
          to="/settings"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Manage connections
          <ArrowRight className="size-3" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}
