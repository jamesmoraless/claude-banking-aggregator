import { AlertCircle, CircleDot, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { type Freshness } from '@/lib/financial/freshness';
import { cn } from '@/lib/utils';

/**
 * Data freshness indicator.
 *
 * Every screen showing figures shows one of these. Cash Atlas reads a database
 * that Plaid populates on a delay, and presenting a number without saying how
 * old it is implies a liveness the app does not have.
 */

const LEVEL_STYLES: Record<Freshness['level'], string> = {
  FRESH: 'text-primary',
  RECENT: 'text-muted-foreground',
  STALE: 'text-finance-warning',
  VERY_STALE: 'text-destructive',
  NEVER: 'text-destructive',
};

export function DataFreshnessIndicator({
  freshness,
  onRefresh,
  isRefreshing = false,
  showRefreshAction = true,
  className,
}: {
  freshness: Freshness;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  showRefreshAction?: boolean;
  className?: string;
}) {
  const label =
    freshness.level === 'NEVER' ? 'Not synced yet' : `Last synced ${freshness.label}`;

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <p
        className={cn('flex items-center gap-1.5 text-sm', LEVEL_STYLES[freshness.level])}
        // Freshness changes as a consequence of user action; announce politely.
        role="status"
        aria-live="polite"
      >
        {freshness.isStale ? (
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <CircleDot className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        <span>{isRefreshing ? 'Refreshing…' : label}</span>
      </p>

      {showRefreshAction && onRefresh ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          loading={isRefreshing}
          loadingText="Refreshing…"
        >
          <RefreshCw aria-hidden="true" />
          Refresh data
        </Button>
      ) : null}
    </div>
  );
}

/** Per-institution freshness, e.g. "TD: 3 minutes ago · RBC: reconnect required". */
export function InstitutionFreshnessList({
  institutions,
}: {
  institutions: { name: string; freshness: Freshness; requiresReauth: boolean }[];
}) {
  if (institutions.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {institutions.map((institution) => (
        <li key={institution.name} className="flex items-center gap-1.5">
          <span className="font-medium text-foreground">{institution.name}:</span>
          {institution.requiresReauth ? (
            <span className="text-destructive">reconnect required</span>
          ) : (
            <span className={LEVEL_STYLES[institution.freshness.level]}>
              {institution.freshness.level === 'NEVER'
                ? 'not synced'
                : `updated ${institution.freshness.label}`}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
