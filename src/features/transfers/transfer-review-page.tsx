import { ArrowDown, ArrowUp, Check, CheckCircle2, Shuffle, X } from 'lucide-react';
import * as React from 'react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorCard } from '@/components/common/states';
import { ConfidenceBadge } from '@/components/common/status-badges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useBaseCurrency } from '@/features/profile/hooks';
import { TRANSFER_SUBTYPE_LABELS } from '@/lib/financial/classification';
import { formatTransactionDate } from '@/lib/financial/dates';
import { formatMoneyWithCurrencyCode } from '@/lib/financial/money';

import { parseMatchReasons, type TransferReviewRow } from './api';
import { ChooseMatchDialog } from './choose-match-dialog';
import { useConfirmTransferMatch, useRejectTransferMatch, useTransferReviewQueue } from './hooks';

/**
 * Transfer review.
 *
 * Everything here is currently counted as spending. These are pairs Cash Atlas
 * suspects are movements between the user's own accounts but is not confident
 * enough to exclude on its own — so it asks rather than quietly removing
 * thousands of dollars from a spending figure.
 */
export function TransferReviewPage() {
  const queue = useTransferReviewQueue();
  const baseCurrency = useBaseCurrency();
  const confirm = useConfirmTransferMatch();
  const reject = useRejectTransferMatch();

  const [relinkTransactionId, setRelinkTransactionId] = React.useState<string | null>(null);

  const matches = queue.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transfer Review"
        description="Confirm which of these were movements between your own accounts."
      />

      {queue.isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-48 w-full rounded-xl" />
          ))}
          <span role="status" aria-live="polite" className="sr-only">
            Loading transfers to review
          </span>
        </div>
      ) : queue.isError ? (
        <ErrorCard
          title="We couldn't load the review queue"
          error={queue.error}
          onRetry={() => void queue.refetch()}
        />
      ) : matches.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={CheckCircle2}
              title="Nothing to review"
              description="Cash Atlas has not found any uncertain transfers. Confident matches are applied automatically, and you can always reclassify a transaction by hand."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Alert variant="info">
            <AlertTitle>
              {matches.length} possible transfer{matches.length === 1 ? '' : 's'} to review
            </AlertTitle>
            <AlertDescription>
              These are still counted as spending. Confirming a transfer removes it from your
              spending totals, because moving your own money is not an expense.
            </AlertDescription>
          </Alert>

          <ul className="space-y-4">
            {matches.map((match) => (
              <li key={match.id}>
                <TransferMatchCard
                  match={match}
                  baseCurrency={baseCurrency}
                  isBusy={confirm.isPending || reject.isPending}
                  onConfirm={() => confirm.mutate(match.id)}
                  onReject={() => reject.mutate(match.id)}
                  onChooseAnother={() => setRelinkTransactionId(match.outgoing_transaction_id)}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      <ChooseMatchDialog
        transactionId={relinkTransactionId}
        onOpenChange={(open) => {
          if (!open) setRelinkTransactionId(null);
        }}
      />
    </div>
  );
}

function TransferMatchCard({
  match,
  baseCurrency,
  isBusy,
  onConfirm,
  onReject,
  onChooseAnother,
}: {
  match: TransferReviewRow;
  baseCurrency: string;
  isBusy: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onChooseAnother: () => void;
}) {
  const reasons = parseMatchReasons(match.reason);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">{TRANSFER_SUBTYPE_LABELS[match.subtype]}</p>
          <ConfidenceBadge confidence={match.confidence} />
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <TransferLeg
            direction="out"
            name={match.outgoing_name}
            account={match.outgoing_account_name}
            institution={match.outgoing_institution_name}
            date={match.outgoing_date}
            amount={match.outgoing_amount}
            currency={match.outgoing_currency}
            baseCurrency={baseCurrency}
          />

          <div className="flex items-center justify-center">
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              possible match
            </span>
          </div>

          <TransferLeg
            direction="in"
            name={match.incoming_name}
            account={match.incoming_account_name}
            institution={match.incoming_institution_name}
            date={match.incoming_date}
            amount={match.incoming_amount}
            currency={match.incoming_currency}
            baseCurrency={baseCurrency}
          />
        </div>

        {/* The score is shown as the signals that produced it, not as a bare
            number. "87%" alone is not something a person can check. */}
        {reasons.length > 0 ? (
          <details className="rounded-lg bg-muted/50 p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Why we think these match
            </summary>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {reasons.map((reason) => (
                <li key={reason.signal} className="flex justify-between gap-4">
                  <span>{reason.detail}</span>
                  <span className="shrink-0 tabular-money text-xs">
                    +{Math.round(reason.weight * 100)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={isBusy} onClick={onConfirm}>
            <Check aria-hidden="true" />
            Confirm transfer
          </Button>
          <Button variant="outline" size="sm" disabled={isBusy} onClick={onReject}>
            <X aria-hidden="true" />
            Not a transfer
          </Button>
          <Button variant="ghost" size="sm" disabled={isBusy} onClick={onChooseAnother}>
            <Shuffle aria-hidden="true" />
            Choose another match
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TransferLeg({
  direction,
  name,
  account,
  institution,
  date,
  amount,
  currency,
  baseCurrency,
}: {
  direction: 'in' | 'out';
  name: string;
  account: string;
  institution: string | null;
  date: string;
  amount: number;
  currency: string | null;
  baseCurrency: string;
}) {
  const isOut = direction === 'out';
  const Icon = isOut ? ArrowUp : ArrowDown;

  return (
    <div className="space-y-1 rounded-lg border border-border p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {isOut ? 'Money out' : 'Money in'}
      </p>
      <p className="truncate text-sm font-medium">{name}</p>
      <p className="truncate text-xs text-muted-foreground">
        {institution ? `${institution} · ` : ''}
        {account}
      </p>
      <p className={isOut ? 'text-metric-sm tabular-money' : 'text-metric-sm tabular-money text-finance-inflow'}>
        <span aria-hidden="true">{isOut ? '−' : '+'}</span>
        {formatMoneyWithCurrencyCode(amount, currency, baseCurrency)}
        <span className="sr-only">{isOut ? ' out' : ' in'}</span>
      </p>
      <p className="text-xs text-muted-foreground">{formatTransactionDate(date)}</p>
    </div>
  );
}
