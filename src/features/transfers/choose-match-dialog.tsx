import { ArrowDown } from 'lucide-react';

import { EmptyState, ErrorState } from '@/components/common/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useBaseCurrency } from '@/features/profile/hooks';
import { formatTransactionDate } from '@/lib/financial/dates';
import { formatMoneyWithCurrencyCode } from '@/lib/financial/money';

import { useCreateManualTransferMatch, useTransferCandidates } from './hooks';

/**
 * "Choose another match".
 *
 * Lists opposing-direction transactions on other accounts, ordered by how close
 * they are in amount then date. Selecting one records a user-confirmed match:
 * the server verifies ownership of both legs, so a transaction id from the
 * browser cannot be used to pair somebody else's data.
 */
export function ChooseMatchDialog({
  transactionId,
  onOpenChange,
}: {
  transactionId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const candidates = useTransferCandidates(transactionId);
  const createMatch = useCreateManualTransferMatch();
  const baseCurrency = useBaseCurrency();

  return (
    <Dialog open={Boolean(transactionId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Choose the matching transaction</DialogTitle>
          <DialogDescription>
            Transactions in the opposite direction on your other accounts, closest match first.
          </DialogDescription>
        </DialogHeader>

        {candidates.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : candidates.isError ? (
          <ErrorState error={candidates.error} onRetry={() => void candidates.refetch()} compact />
        ) : (candidates.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={ArrowDown}
            title="No candidates found"
            description="There is no opposing transaction on your other accounts within a week of this one. If the other side is at an institution you have not connected, this is genuine spending."
            compact
          />
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto">
            {candidates.data?.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  disabled={createMatch.isPending || !transactionId}
                  onClick={() =>
                    createMatch.mutate(
                      {
                        outgoingTransactionId: transactionId!,
                        incomingTransactionId: candidate.id,
                      },
                      { onSuccess: () => onOpenChange(false) },
                    )
                  }
                  className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{candidate.display_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {candidate.institution_name ? `${candidate.institution_name} · ` : ''}
                      {candidate.account_name} · {formatTransactionDate(candidate.posted_date)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-money">
                      {formatMoneyWithCurrencyCode(
                        candidate.absolute_amount,
                        candidate.currency,
                        baseCurrency,
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {candidate.amount_delta === 0
                        ? 'exact amount'
                        : `${formatMoneyWithCurrencyCode(candidate.amount_delta, candidate.currency, baseCurrency)} apart`}
                      {' · '}
                      {candidate.day_delta === 0
                        ? 'same day'
                        : `${candidate.day_delta}d apart`}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {createMatch.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              We couldn&apos;t link those transactions. They must be on different accounts, in the
              same currency, and move money in opposite directions.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
