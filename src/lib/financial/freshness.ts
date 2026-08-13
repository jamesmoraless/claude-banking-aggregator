import { formatDistanceToNowStrict, parseISO } from 'date-fns';

/**
 * Data freshness.
 *
 * Cash Atlas reads from a database that Plaid populates on a delay, so no
 * screen may imply the figures are live. Every surface that shows a number also
 * shows how old it is, and the assistant is given the same information so it
 * cannot claim currency it does not have.
 */

export type FreshnessLevel = 'FRESH' | 'RECENT' | 'STALE' | 'VERY_STALE' | 'NEVER';

/** Beyond this, data is called stale in the UI. */
const STALE_AFTER_HOURS = 12;
const VERY_STALE_AFTER_HOURS = 72;
const FRESH_WITHIN_MINUTES = 30;

export type Freshness = {
  level: FreshnessLevel;
  /** "12 minutes ago", or "never" when nothing has synced. */
  label: string;
  syncedAt: string | null;
  ageMinutes: number | null;
  isStale: boolean;
};

export function evaluateFreshness(syncedAt: string | null | undefined, now = new Date()): Freshness {
  if (!syncedAt) {
    return { level: 'NEVER', label: 'never synced', syncedAt: null, ageMinutes: null, isStale: true };
  }

  const parsed = parseISO(syncedAt);
  if (Number.isNaN(parsed.getTime())) {
    return { level: 'NEVER', label: 'unknown', syncedAt, ageMinutes: null, isStale: true };
  }

  const ageMinutes = Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 60_000));
  const ageHours = ageMinutes / 60;

  let level: FreshnessLevel;
  if (ageMinutes <= FRESH_WITHIN_MINUTES) level = 'FRESH';
  else if (ageHours < STALE_AFTER_HOURS) level = 'RECENT';
  else if (ageHours < VERY_STALE_AFTER_HOURS) level = 'STALE';
  else level = 'VERY_STALE';

  return {
    level,
    label: `${formatDistanceToNowStrict(parsed)} ago`,
    syncedAt,
    ageMinutes,
    isStale: level === 'STALE' || level === 'VERY_STALE',
  };
}

/**
 * Freshness across several institutions is the freshness of the OLDEST one.
 * Reporting the newest would let one healthy connection mask three stale ones.
 */
export function aggregateFreshness(
  syncTimes: readonly (string | null | undefined)[],
  now = new Date(),
): Freshness {
  const present = syncTimes.filter((value): value is string => Boolean(value));
  if (present.length === 0 || present.length < syncTimes.length) {
    // Something has never synced — say so rather than averaging it away.
    if (present.length === 0) return evaluateFreshness(null, now);
  }

  const oldest = present.reduce((min, value) => (value < min ? value : min), present[0]!);
  return evaluateFreshness(oldest, now);
}
