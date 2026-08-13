import { ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react';
import * as React from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatMoney, formatPercent } from '@/lib/financial/money';
import { cn } from '@/lib/utils';

/**
 * The headline metric card.
 *
 * `value === null` renders an em dash, not "$0". A user with no connected
 * accounts has an unknown balance, not a zero balance, and the difference
 * matters on the very first screen they see.
 */

type Trend = {
  /** Fractional change, e.g. 0.054 for +5.4%. */
  change: number | null;
  label: string;
  /** When true, a decrease is the good outcome (spending, debt). */
  inverted?: boolean;
};

type MetricCardProps = {
  label: string;
  value: number | null | undefined;
  currency?: string;
  /** Renders as a percentage instead of an amount. */
  format?: 'money' | 'percent';
  icon?: React.ComponentType<{ className?: string }>;
  iconClassName?: string;
  trend?: Trend;
  hint?: string;
  footnote?: React.ReactNode;
  isLoading?: boolean;
  onClick?: () => void;
};

export function MetricCard({
  label,
  value,
  currency,
  format = 'money',
  icon: Icon,
  iconClassName,
  trend,
  hint,
  footnote,
  isLoading = false,
  onClick,
}: MetricCardProps) {
  if (isLoading) return <MetricCardSkeleton />;

  const display =
    value == null
      ? '—'
      : format === 'percent'
        ? formatPercent(value)
        : formatMoney(value, { currency });

  const body = (
    <CardContent className="space-y-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {hint ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="rounded text-muted-foreground/70 transition-colors hover:text-muted-foreground"
                  aria-label={`About ${label}`}
                >
                  <Info className="size-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{hint}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        {Icon ? (
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground',
              iconClassName,
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
          </span>
        ) : null}
      </div>

      <p className="text-metric tabular-money">{display}</p>

      {trend ? <TrendIndicator {...trend} /> : null}
      {footnote ? <div className="text-xs text-muted-foreground">{footnote}</div> : null}
    </CardContent>
  );

  if (onClick) {
    return (
      <Card className="transition-shadow hover:shadow-card-hover">
        <button
          type="button"
          onClick={onClick}
          className="w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {body}
        </button>
      </Card>
    );
  }

  return <Card>{body}</Card>;
}

/**
 * Trend arrow.
 *
 * Direction is conveyed by the arrow glyph and the sign as well as by colour,
 * so the meaning survives greyscale and colour blindness. `inverted` flips
 * which direction counts as good: spending going up is not a win.
 */
export function TrendIndicator({ change, label, inverted = false }: Trend) {
  if (change == null || !Number.isFinite(change)) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Minus className="size-3.5" aria-hidden="true" />
        <span>No comparison available</span>
      </p>
    );
  }

  const isIncrease = change > 0;
  const isFlat = Math.abs(change) < 0.0005;
  const isGood = inverted ? !isIncrease : isIncrease;
  const Arrow = isIncrease ? ArrowUpRight : ArrowDownRight;

  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs">
      <span
        className={cn(
          'inline-flex items-center gap-0.5 font-medium',
          isFlat ? 'text-muted-foreground' : isGood ? 'text-finance-inflow' : 'text-destructive',
        )}
      >
        {isFlat ? (
          <Minus className="size-3.5" aria-hidden="true" />
        ) : (
          <Arrow className="size-3.5" aria-hidden="true" />
        )}
        {formatPercent(Math.abs(change))}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </p>
  );
}

export function MetricCardSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="size-9 rounded-lg" />
        </div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-3 w-28" />
      </CardContent>
    </Card>
  );
}

/** Small inline metric used inside cards and chat responses. */
export function InlineMetric({
  label,
  value,
  currency,
  format = 'money',
  emphasis = 'default',
  sublabel,
}: {
  label: string;
  value: number | null | undefined;
  currency?: string;
  format?: 'money' | 'percent';
  emphasis?: 'default' | 'positive' | 'negative' | 'muted';
  sublabel?: string;
}) {
  const display =
    value == null
      ? '—'
      : format === 'percent'
        ? formatPercent(value)
        : formatMoney(value, { currency });

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          'text-metric-sm tabular-money',
          emphasis === 'positive' && 'text-finance-inflow',
          emphasis === 'negative' && 'text-destructive',
          emphasis === 'muted' && 'text-muted-foreground',
        )}
      >
        {display}
      </p>
      {sublabel ? <p className="text-xs text-muted-foreground">{sublabel}</p> : null}
    </div>
  );
}
