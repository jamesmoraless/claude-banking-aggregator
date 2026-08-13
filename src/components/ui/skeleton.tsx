import { cn } from '@/lib/utils';

/**
 * Loading placeholder.
 *
 * Marked aria-hidden with a sibling live region supplied by callers: a screen
 * reader should hear "Loading accounts", not a description of grey rectangles.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('shimmer rounded-md', className)}
      {...props}
    />
  );
}

/** Announces loading state to assistive technology. Pair with <Skeleton />. */
function LoadingAnnouncement({ label }: { label: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {label}
    </span>
  );
}

export { LoadingAnnouncement, Skeleton };
