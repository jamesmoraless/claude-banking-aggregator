import * as React from 'react';

import { EmptyState, ErrorState } from '@/components/common/states';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Wraps a chart with its loading, empty and error states.
 *
 * Charts are the easiest place to accidentally imply data exists: an empty
 * Recharts canvas renders as a plausible flat line at zero. This component
 * makes "no data yet" an explicit message instead.
 */
export function ChartContainer({
  isLoading,
  isError,
  isEmpty,
  error,
  onRetry,
  emptyTitle = 'No data yet',
  emptyDescription,
  height = 260,
  children,
  className,
  label,
}: {
  isLoading?: boolean;
  isError?: boolean;
  isEmpty?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  height?: number;
  children: React.ReactNode;
  className?: string;
  /** Screen-reader description of what the chart shows. */
  label: string;
}) {
  if (isLoading) {
    return (
      <div className={cn('space-y-3', className)} style={{ minHeight: height }}>
        <Skeleton className="h-full w-full" style={{ height }} />
        <span role="status" aria-live="polite" className="sr-only">
          Loading {label}
        </span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={className} style={{ minHeight: height }}>
        <ErrorState title={`We couldn't load ${label}`} error={error} onRetry={onRetry} compact />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className={className} style={{ minHeight: height }}>
        <EmptyState title={emptyTitle} description={emptyDescription} compact />
      </div>
    );
  }

  return (
    <div className={className} style={{ height }} role="img" aria-label={label}>
      {children}
    </div>
  );
}

/** Colours for categorical series, matching the tokens in globals.css. */
export const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6))',
  'hsl(var(--chart-7))',
] as const;

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]!;
}
