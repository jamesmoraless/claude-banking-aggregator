import {
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  startOfYear,
  subMonths,
  subYears,
} from 'date-fns';

/**
 * Date ranges and month keys.
 *
 * Everything the database indexes by is a calendar DATE (posted_date), not a
 * timestamp, so ranges are expressed as `yyyy-MM-dd` strings and never carry a
 * timezone. Constructing them from local Date objects and formatting with
 * date-fns keeps "July" meaning July for the user, rather than shifting at UTC
 * midnight.
 */

export type DateRange = { from: string; to: string };

export const DATE_FORMAT = 'yyyy-MM-dd';

export function toDateString(date: Date): string {
  return format(date, DATE_FORMAT);
}

export function fromDateString(value: string): Date {
  return parseISO(value);
}

export type RangePresetId = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'CUSTOM';

export const RANGE_PRESETS: { id: RangePresetId; label: string }[] = [
  { id: '1M', label: '1M' },
  { id: '3M', label: '3M' },
  { id: '6M', label: '6M' },
  { id: 'YTD', label: 'YTD' },
  { id: '1Y', label: '1Y' },
];

/**
 * Presets snap to whole months because every figure Cash Atlas reports is
 * monthly. "Last 6 months" meaning "the last 6 complete calendar months plus
 * this one" is what a bank statement means by it.
 */
export function resolveRangePreset(preset: RangePresetId, today = new Date()): DateRange {
  const currentMonthEnd = endOfMonth(today);

  switch (preset) {
    case '1M':
      return { from: toDateString(startOfMonth(today)), to: toDateString(currentMonthEnd) };
    case '3M':
      return {
        from: toDateString(startOfMonth(subMonths(today, 2))),
        to: toDateString(currentMonthEnd),
      };
    case '6M':
      return {
        from: toDateString(startOfMonth(subMonths(today, 5))),
        to: toDateString(currentMonthEnd),
      };
    case 'YTD':
      return { from: toDateString(startOfYear(today)), to: toDateString(currentMonthEnd) };
    case '1Y':
      return {
        from: toDateString(startOfMonth(subYears(today, 1))),
        to: toDateString(currentMonthEnd),
      };
    case 'CUSTOM':
      return { from: toDateString(startOfMonth(today)), to: toDateString(currentMonthEnd) };
  }
}

export function monthRange(year: number, month: number): DateRange {
  const start = new Date(year, month - 1, 1);
  return { from: toDateString(startOfMonth(start)), to: toDateString(endOfMonth(start)) };
}

/** The equivalent range one period earlier, for period-over-period comparison. */
export function previousPeriod(range: DateRange): DateRange {
  const from = fromDateString(range.from);
  const to = fromDateString(range.to);
  const months = monthsBetween(from, to) + 1;
  return {
    from: toDateString(startOfMonth(subMonths(from, months))),
    to: toDateString(endOfMonth(subMonths(to, months))),
  };
}

export function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

export function formatMonthLabel(monthStart: string): string {
  return format(parseISO(monthStart), 'MMM yyyy');
}

export function formatMonthLabelLong(monthStart: string): string {
  return format(parseISO(monthStart), 'MMMM yyyy');
}

export function formatTransactionDate(date: string): string {
  return format(parseISO(date), 'MMM d, yyyy');
}

export function formatRangeLabel(range: DateRange): string {
  const from = parseISO(range.from);
  const to = parseISO(range.to);
  if (from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth()) {
    return format(from, 'MMMM yyyy');
  }
  return `${format(from, 'MMM yyyy')} – ${format(to, 'MMM yyyy')}`;
}
