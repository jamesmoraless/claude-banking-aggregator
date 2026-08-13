import { interpretPlaidAmount } from '@/lib/financial/direction';
import { formatMoney } from '@/lib/financial/money';
import { cn } from '@/lib/utils';

/**
 * Renders a transaction amount.
 *
 * This is the ONLY component that turns a stored Plaid amount into something a
 * person reads. It asks the domain layer for the direction rather than
 * inspecting the sign itself, which is what keeps Plaid's convention (positive
 * means money leaving) from leaking into presentation code.
 *
 * The direction is carried by the explicit +/− prefix as well as by colour, so
 * an inflow is still identifiable in greyscale.
 */
export function TransactionAmount({
  amount,
  currency,
  baseCurrency,
  className,
  size = 'default',
}: {
  amount: number;
  currency: string | null;
  baseCurrency?: string;
  className?: string;
  size?: 'default' | 'large';
}) {
  const { direction, absoluteAmount } = interpretPlaidAmount(amount);
  const isInflow = direction === 'INFLOW';
  const showCurrencyCode = Boolean(currency && baseCurrency && currency !== baseCurrency);

  return (
    <span
      className={cn(
        'tabular-money font-medium',
        size === 'large' ? 'text-metric-sm' : 'text-sm',
        isInflow ? 'text-finance-inflow' : 'text-foreground',
        className,
      )}
    >
      <span aria-hidden="true">{isInflow ? '+' : '−'}</span>
      {formatMoney(absoluteAmount, { currency })}
      {showCurrencyCode ? <span className="ml-1 text-xs font-normal">{currency}</span> : null}
      {/* Screen readers get words, not a glyph that may not be announced. */}
      <span className="sr-only">
        {isInflow ? ' received' : ' spent'}
        {showCurrencyCode ? ` in ${currency}` : ''}
      </span>
    </span>
  );
}
