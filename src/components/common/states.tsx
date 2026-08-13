import { AlertTriangle, Inbox, RefreshCw, SearchX, WifiOff } from 'lucide-react';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The shared vocabulary of non-populated states.
 *
 * Cash Atlas never fabricates data, so these states are load-bearing rather
 * than decorative. The distinction between them matters:
 *
 *   EmptyState        — you have no data yet. Offers the action that creates it.
 *   NoResultsState    — you have data, but none matches these filters.
 *   ZeroState         — a legitimate $0. Must not look like a failure.
 *   ErrorState        — we could not load it. Always offers a retry.
 *
 * Conflating the first two is the classic mistake: telling someone with 4,000
 * transactions that they have no transactions because a filter excluded them.
 */

type EmptyStateProps = {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
};

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

/** Filters excluded everything. Distinct from "you have no data". */
export function NoResultsState({
  onClear,
  entity = 'transactions',
}: {
  onClear?: () => void;
  entity?: string;
}) {
  return (
    <EmptyState
      icon={SearchX}
      title={`No ${entity} match these filters`}
      description="Try widening the date range, or clearing one of the active filters."
      action={
        onClear ? (
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        ) : null
      }
    />
  );
}

/**
 * A real zero. Rendered as an actual figure with an explanation, because "$0"
 * shown alone is indistinguishable from a component that failed to load.
 */
export function ZeroState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-metric-sm tabular-money text-muted-foreground">$0.00</p>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

type ErrorStateProps = {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  isRetrying?: boolean;
  className?: string;
  compact?: boolean;
};

/**
 * Surfaces a failure with a retry.
 *
 * The message shown is our own; raw exception text is deliberately not rendered
 * because it can carry query fragments or identifiers. `describeError` maps
 * known failure shapes onto actionable sentences.
 */
export function ErrorState({
  title = "We couldn't load this",
  error,
  onRetry,
  isRetrying = false,
  className,
  compact = false,
}: ErrorStateProps) {
  const description = describeError(error);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        compact ? 'px-4 py-8' : 'px-6 py-12',
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-destructive-subtle text-destructive">
        {offline ? (
          <WifiOff className="size-5" aria-hidden="true" />
        ) : (
          <AlertTriangle className="size-5" aria-hidden="true" />
        )}
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{offline ? "You're offline" : title}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {offline ? 'Reconnect to the internet and try again.' : description}
        </p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} loading={isRetrying} loadingText="Retrying…">
          <RefreshCw aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Card-wrapped error, for use where a whole card failed to load. */
export function ErrorCard(props: ErrorStateProps) {
  return (
    <Card>
      <CardContent className="p-0">
        <ErrorState {...props} />
      </CardContent>
    </Card>
  );
}

/**
 * Maps a thrown value onto a safe, actionable sentence.
 *
 * Only messages we authored are passed through. Anything unrecognised falls
 * back to a generic sentence rather than leaking driver or network internals.
 */
export function describeError(error: unknown): string {
  if (!error) return 'Something went wrong. Please try again.';

  if (typeof error === 'object' && error !== null) {
    const candidate = error as { code?: string; message?: string; name?: string };

    if (candidate.code === 'SUPABASE_NOT_CONFIGURED') {
      return 'Cash Atlas is not connected to Supabase yet. See MANUAL_SETUP.md.';
    }
    if (candidate.name === 'AuthSessionMissingError' || candidate.code === 'PGRST301') {
      return 'Your session expired. Sign in again to continue.';
    }
    if (candidate.code === '42501' || candidate.code === 'PGRST116') {
      return 'You do not have access to this data.';
    }
    if (candidate.code === 'PGRST202') {
      return 'The database is missing a required function. Have the migrations been applied?';
    }
    if (candidate.name === 'TypeError' || candidate.name === 'FetchError') {
      return 'We could not reach the server. Check your connection and try again.';
    }
    if (candidate.code?.startsWith('PLAID_')) {
      return candidate.message ?? 'Your bank could not be reached right now.';
    }
  }

  return 'Something went wrong on our side. Please try again.';
}

/**
 * Partial failure. Some institutions synced, some did not — and the ones that
 * worked must stay visible.
 */
export function PartialFailureAlert({
  succeeded,
  failed,
}: {
  succeeded: { name: string }[];
  failed: { name: string; reason: string }[];
}) {
  if (failed.length === 0) return null;

  return (
    <Alert variant="warning">
      <AlertTriangle aria-hidden="true" />
      <div className="space-y-2">
        <AlertTitle>
          {succeeded.length > 0
            ? `${succeeded.length} of ${succeeded.length + failed.length} institutions synced`
            : 'Sync did not complete'}
        </AlertTitle>
        <AlertDescription>
          <ul className="space-y-1">
            {succeeded.map((item) => (
              <li key={item.name} className="flex items-center gap-2">
                <span aria-hidden="true">✓</span>
                <span>{item.name} synced successfully</span>
              </li>
            ))}
            {failed.map((item) => (
              <li key={item.name} className="flex items-center gap-2 font-medium">
                <span aria-hidden="true">!</span>
                <span>
                  {item.name}: {item.reason}
                </span>
              </li>
            ))}
          </ul>
        </AlertDescription>
      </div>
    </Alert>
  );
}
