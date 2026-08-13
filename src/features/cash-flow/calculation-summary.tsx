import { AlertTriangle, Info } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { CashflowTotals, SpendingExplanation } from '@/lib/financial/cashflow';
import { formatMoney } from '@/lib/financial/money';
import { cn } from '@/lib/utils';

/**
 * "How we calculated your actual spending."
 *
 * The reason this application exists. Every line is a real figure from the
 * database, the deductions sum exactly to the result, and each line links
 * through to the transactions behind it.
 *
 * Lines worth $0 are still shown. Their absence would leave the reader
 * wondering whether the category was omitted or genuinely empty.
 */
export function CalculationSummary({
  explanation,
  totals,
  onInspectBucket,
  className,
}: {
  explanation: SpendingExplanation;
  totals: CashflowTotals;
  onInspectBucket?: (bucket: string) => void;
  className?: string;
}) {
  const currency = explanation.currency;

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center gap-1.5 space-y-0">
        <CardTitle>Monthly Summary</CardTitle>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="rounded text-muted-foreground/70 transition-colors hover:text-muted-foreground"
              aria-label="About this calculation"
            >
              <Info className="size-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Every eligible outflow falls into exactly one line below, so the deductions add up
            precisely to your actual spending.
          </TooltipContent>
        </Tooltip>
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="space-y-0.5">
          {explanation.lines.map((line) => {
            if (line.operator === 'RESULT') {
              return (
                <div
                  key={line.key}
                  className="mt-2 flex items-baseline justify-between gap-4 border-t-2 border-foreground/10 pt-3"
                >
                  <dt className="text-sm font-semibold">{line.label}</dt>
                  <dd className="text-metric-sm tabular-money">
                    {formatMoney(line.amount, { currency })}
                  </dd>
                </div>
              );
            }

            const isDeduction = line.operator === 'SUBTRACT';
            const clickable = Boolean(onInspectBucket && line.drillDownBucket && line.amount > 0);

            const row = (
              <>
                <dt className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'text-sm',
                      line.operator === 'BASE' ? 'font-medium' : 'text-muted-foreground',
                      line.needsAttention && 'text-finance-warning',
                    )}
                  >
                    {line.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">{line.description}</span>
                </dt>
                <dd
                  className={cn(
                    'shrink-0 tabular-money text-sm',
                    line.operator === 'BASE' ? 'font-medium' : '',
                    line.needsAttention && line.amount > 0 && 'font-medium text-finance-warning',
                  )}
                >
                  {isDeduction && line.amount > 0 ? '−' : ''}
                  {formatMoney(line.amount, { currency })}
                </dd>
              </>
            );

            return (
              <div key={line.key}>
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => onInspectBucket!(line.drillDownBucket!)}
                    className="flex w-full items-start justify-between gap-4 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row}
                  </button>
                ) : (
                  <div className="flex items-start justify-between gap-4 px-2 py-1.5">{row}</div>
                )}
              </div>
            );
          })}
        </dl>

        <div className="space-y-0.5 rounded-lg bg-muted/50 p-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-muted-foreground">Actual income</span>
            <span className="tabular-money text-sm font-medium text-finance-inflow">
              {formatMoney(totals.actualIncome, { currency })}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-muted-foreground">Less actual spending</span>
            <span className="tabular-money text-sm">
              −{formatMoney(totals.actualSpending, { currency })}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2">
            <span className="text-sm font-semibold">Surplus</span>
            <span
              className={cn(
                'text-metric-sm tabular-money',
                totals.surplus >= 0 ? 'text-finance-inflow' : 'text-destructive',
              )}
            >
              {formatMoney(totals.surplus, { currency })}
            </span>
          </div>
        </div>

        {/* If the arithmetic ever fails to close, say so. A figure that cannot
            be reconstructed should not be presented as if it can. */}
        {!explanation.balances ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertDescription>
              These components do not add up to the total shown. Please report this — a figure that
              cannot be reconstructed should not be trusted.
            </AlertDescription>
          </Alert>
        ) : null}

        {totals.foreignCurrencyTransactionCount > 0 ? (
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertDescription>
              {totals.foreignCurrencyTransactionCount} transaction
              {totals.foreignCurrencyTransactionCount === 1 ? '' : 's'} in another currency
              {totals.foreignCurrencyTransactionCount === 1 ? ' is' : ' are'} not included. Cash
              Atlas does not convert currencies, so adding them would produce a wrong total.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
