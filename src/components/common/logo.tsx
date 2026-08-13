import { cn } from '@/lib/utils';

/** Cash Atlas wordmark. */
export function AtlasLogo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <AtlasMark className="size-8 shrink-0" />
      {showWordmark ? (
        <span className="text-lg font-semibold tracking-tight text-foreground">Cash Atlas</span>
      ) : null}
    </span>
  );
}

export function AtlasMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="Cash Atlas">
      <circle cx="16" cy="16" r="15" fill="hsl(var(--primary-subtle))" />
      <circle cx="16" cy="16" r="15" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.75" />
      <path
        d="M16 8.5 20.5 16 16 23.5 11.5 16Z"
        fill="hsl(var(--primary))"
        opacity="0.28"
      />
      <circle cx="16" cy="16" r="3.4" fill="hsl(var(--primary))" />
    </svg>
  );
}
