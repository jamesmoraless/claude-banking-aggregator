/**
 * Money formatting and comparison.
 *
 * Amounts are stored in PostgreSQL as numeric(20,4) and arrive as JavaScript
 * numbers. Every figure Cash Atlas reports comes from a SQL aggregate that has
 * already been rounded to 2 decimal places, so the browser never accumulates
 * floating-point error across many rows — it formats a value the database
 * already settled.
 *
 * Where the browser does compare amounts (transfer matching previews, filters),
 * it uses the epsilon-aware helpers below rather than `===`.
 */

/** Amounts closer together than this are treated as equal. Half a cent. */
export const AMOUNT_EPSILON = 0.005;

export function amountsEqual(a: number, b: number, epsilon = AMOUNT_EPSILON): boolean {
  return Math.abs(a - b) < epsilon;
}

export function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type FormatOptions = {
  currency?: string | null;
  /** Drop the decimal part. Used for dense chart axes and metric cards. */
  compact?: boolean;
  /** Always show a leading + or −. */
  signed?: boolean;
  locale?: string;
};

const DEFAULT_LOCALE = 'en-CA';
const DEFAULT_CURRENCY = 'CAD';

/**
 * Formats an amount with its currency.
 *
 * The currency is always rendered, because Cash Atlas holds accounts in more
 * than one currency and an unlabelled "$5,000" is ambiguous between CAD and
 * USD. For the base currency the symbol alone is used; for anything else the
 * ISO code is appended, e.g. "$1,200.00 USD".
 */
export function formatMoney(
  value: number | null | undefined,
  { currency, compact = false, signed = false, locale = DEFAULT_LOCALE }: FormatOptions = {},
): string {
  if (value == null || !Number.isFinite(value)) return '—';

  const currencyCode = currency ?? DEFAULT_CURRENCY;
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
    currencyDisplay: 'narrowSymbol',
  });

  const formatted = formatter.format(Math.abs(value));
  const sign = value < 0 ? '−' : signed ? '+' : '';

  return `${sign}${formatted}`;
}

/**
 * Formats an amount, appending the ISO code when it differs from the user's
 * base currency so that a mixed-currency list is never misread.
 */
export function formatMoneyWithCurrencyCode(
  value: number | null | undefined,
  currency: string | null | undefined,
  baseCurrency: string,
  options: Omit<FormatOptions, 'currency'> = {},
): string {
  const formatted = formatMoney(value, { ...options, currency });
  if (value == null || !Number.isFinite(value)) return formatted;
  if (!currency || currency === baseCurrency) return formatted;
  return `${formatted} ${currency}`;
}

/** Abbreviates for chart axes: 15400 → "$15.4K". */
export function formatMoneyAxis(value: number, currency = DEFAULT_CURRENCY): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  const symbol = currencySymbol(currency);

  if (abs >= 1_000_000) return `${sign}${symbol}${trimZero(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}${symbol}${trimZero(abs / 1_000)}K`;
  return `${sign}${symbol}${Math.round(abs)}`;
}

function trimZero(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function currencySymbol(currency: string, locale = DEFAULT_LOCALE): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? '$';
  } catch {
    return '$';
  }
}

/**
 * Formats a savings rate. `null` means undefined rather than zero — a month
 * with no income has no savings rate, and showing "0%" would be a lie.
 */
export function formatPercent(
  value: number | null | undefined,
  { fractionDigits = 1, signed = false }: { fractionDigits?: number; signed?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const percent = value * 100;
  const sign = percent < 0 ? '−' : signed ? '+' : '';
  return `${sign}${Math.abs(percent).toFixed(fractionDigits)}%`;
}

/**
 * Percentage-point change, for comparisons between periods. Rates are already
 * ratios, so the difference is in points, not percent — "+6.7 pp", not "+6.7%".
 */
export function formatPercentagePoints(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const points = value * 100;
  const sign = points < 0 ? '−' : '+';
  return `${sign}${Math.abs(points).toFixed(1)} pp`;
}

/** Relative change between two values, or null when the base is zero. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
