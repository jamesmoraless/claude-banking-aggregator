import { ArrowLeftRight, Ban, RotateCcw, Undo2 } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';

import { ErrorState } from '@/components/common/states';
import {
  ClassificationBadge,
  ConfidenceBadge,
  OverriddenBadge,
  PendingBadge,
} from '@/components/common/status-badges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useBaseCurrency } from '@/features/profile/hooks';
import { parseMatchReasons } from '@/features/transfers/api';
import { useTransferMatchesForTransaction } from '@/features/transfers/hooks';
import {
  ECONOMIC_TYPE_LABELS,
  type EconomicType,
  exclusionBucketLabel,
  TRANSFER_SUBTYPE_LABELS,
  TRANSFER_SUBTYPES,
  type TransferSubtype,
} from '@/lib/financial/classification';
import { formatTransactionDate } from '@/lib/financial/dates';

import { CreateRuleDialog } from './create-rule-dialog';
import {
  useClassifyTransaction,
  useRestoreAutomaticClassification,
  useSetTransactionExcluded,
  useTransaction,
} from './hooks';
import { TransactionAmount } from './transaction-amount';

/**
 * Transaction detail.
 *
 * Shows the three layers of classification side by side — what the bank said,
 * what we concluded, and what the user decided — because "why is this counted
 * as spending?" is the question this drawer exists to answer.
 */

const CLASSIFY_OPTIONS: EconomicType[] = ['INCOME', 'EXPENSE', 'TRANSFER', 'REFUND', 'ADJUSTMENT'];

export function TransactionDetailDrawer({
  transactionId,
  onOpenChange,
}: {
  transactionId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const transaction = useTransaction(transactionId);
  const matches = useTransferMatchesForTransaction(transactionId);
  const baseCurrency = useBaseCurrency();

  const classify = useClassifyTransaction();
  const restore = useRestoreAutomaticClassification();
  const setExcluded = useSetTransactionExcluded();

  const [pendingSubtypeFor, setPendingSubtypeFor] = React.useState(false);
  const [ruleDialogOpen, setRuleDialogOpen] = React.useState(false);

  const data = transaction.data;

  React.useEffect(() => {
    setPendingSubtypeFor(false);
  }, [transactionId]);

  const applyClassification = (type: EconomicType, subtype?: TransferSubtype) => {
    if (!data) return;
    if (type === 'TRANSFER' && !subtype) {
      setPendingSubtypeFor(true);
      return;
    }
    setPendingSubtypeFor(false);
    classify.mutate({ transactionId: data.id, type, transferSubtype: subtype ?? null });
  };

  return (
    <Sheet open={Boolean(transactionId)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{data?.display_name ?? 'Transaction'}</SheetTitle>
          <SheetDescription>
            {data
              ? `${formatTransactionDate(data.posted_date)} · ${data.account_name}`
              : 'Loading transaction'}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-6 pt-5">
          {transaction.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : transaction.isError ? (
            <ErrorState error={transaction.error} onRetry={() => void transaction.refetch()} compact />
          ) : !data ? (
            <p className="text-sm text-muted-foreground">This transaction is no longer available.</p>
          ) : (
            <>
              <section className="space-y-3">
                <TransactionAmount
                  amount={data.amount}
                  currency={data.currency}
                  baseCurrency={baseCurrency}
                  size="large"
                />

                <div className="flex flex-wrap items-center gap-1.5">
                  <ClassificationBadge
                    type={data.effective_type}
                    transferSubtype={data.effective_transfer_subtype}
                  />
                  {data.pending ? <PendingBadge /> : null}
                  {data.is_user_overridden ? <OverriddenBadge /> : null}
                </div>

                {data.pending ? (
                  <Alert>
                    <AlertDescription>
                      Pending transactions are excluded from spending and income totals until they
                      post. They are shown here because they are real activity.
                    </AlertDescription>
                  </Alert>
                ) : null}

                {data.spending_exclusion_bucket ? (
                  <Alert variant={data.spending_exclusion_bucket === 'UNCLASSIFIED' ? 'warning' : 'info'}>
                    <AlertTitle>
                      {data.spending_exclusion_bucket === 'UNCLASSIFIED'
                        ? 'Not counted — needs review'
                        : `Excluded from spending: ${exclusionBucketLabel(data.spending_exclusion_bucket)}`}
                    </AlertTitle>
                    <AlertDescription>
                      {data.spending_exclusion_bucket === 'UNCLASSIFIED'
                        ? 'We could not classify this automatically, so it is not included in your spending. Choose a classification below to include it.'
                        : 'This is money moving rather than money spent, so it does not count toward your spending total.'}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </section>

              <Separator />

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Details</h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <Detail label="Description" value={data.name} span />
                  <Detail label="Institution" value={data.institution_name ?? 'Manual'} />
                  <Detail label="Account" value={data.account_name} />
                  <Detail label="Posted" value={formatTransactionDate(data.posted_date)} />
                  <Detail
                    label="Authorised"
                    value={data.authorized_date ? formatTransactionDate(data.authorized_date) : '—'}
                  />
                  <Detail label="Currency" value={data.currency ?? '—'} />
                  <Detail label="Channel" value={data.plaid_payment_channel ?? '—'} />
                </dl>
              </section>

              <Separator />

              {/* The three layers, never merged. */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">How this was classified</h3>
                <dl className="space-y-2.5 rounded-lg bg-muted/50 p-4 text-sm">
                  <ClassificationLayer
                    label="Your bank said"
                    value={
                      data.plaid_category_detailed
                        ? data.plaid_category_detailed.replace(/_/g, ' ').toLowerCase()
                        : (data.plaid_category_primary?.replace(/_/g, ' ').toLowerCase() ?? 'nothing')
                    }
                  />
                  <ClassificationLayer
                    label="Cash Atlas concluded"
                    value={ECONOMIC_TYPE_LABELS[data.system_type]}
                    detail={data.system_classification_reason ?? undefined}
                  />
                  <ClassificationLayer
                    label="You set"
                    value={data.user_type ? ECONOMIC_TYPE_LABELS[data.user_type] : 'nothing'}
                    emphasis={Boolean(data.user_type)}
                  />
                </dl>
              </section>

              {(matches.data?.length ?? 0) > 0 ? (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Transfer match</h3>
                  {matches.data?.map((match) => (
                    <div key={match.id} className="space-y-2 rounded-lg border border-border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <ArrowLeftRight className="size-4 text-muted-foreground" aria-hidden="true" />
                          {TRANSFER_SUBTYPE_LABELS[match.subtype]}
                        </span>
                        <ConfidenceBadge confidence={match.confidence} />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {match.outgoing_account_name} → {match.incoming_account_name}
                      </p>
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {parseMatchReasons(match.reason).map((reason) => (
                          <li key={reason.signal}>· {reason.detail}</li>
                        ))}
                      </ul>
                      {match.status === 'NEEDS_REVIEW' ? (
                        <Button variant="outline" size="sm" asChild>
                          <Link to="/transactions/transfers">Review this match</Link>
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </section>
              ) : null}

              <Separator />

              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">Reclassify</h3>
                  <p className="text-sm text-muted-foreground">
                    Your choice takes precedence and is kept separate from what your bank reported.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {CLASSIFY_OPTIONS.map((type) => (
                    <Button
                      key={type}
                      variant={data.effective_type === type ? 'default' : 'outline'}
                      size="sm"
                      disabled={classify.isPending}
                      onClick={() => applyClassification(type)}
                    >
                      {ECONOMIC_TYPE_LABELS[type]}
                    </Button>
                  ))}
                </div>

                {pendingSubtypeFor ? (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <p className="text-sm font-medium">What kind of transfer?</p>
                    <div className="flex flex-wrap gap-2">
                      {TRANSFER_SUBTYPES.map((subtype) => (
                        <Button
                          key={subtype}
                          variant="outline"
                          size="sm"
                          disabled={classify.isPending}
                          onClick={() => applyClassification('TRANSFER', subtype)}
                        >
                          {TRANSFER_SUBTYPE_LABELS[subtype]}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {data.is_user_overridden ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={restore.isPending}
                      onClick={() => restore.mutate(data.id)}
                    >
                      <Undo2 aria-hidden="true" />
                      Restore automatic classification
                    </Button>
                  ) : null}

                  <Button
                    variant="ghost"
                    size="sm"
                    loading={setExcluded.isPending}
                    onClick={() =>
                      setExcluded.mutate({
                        transactionId: data.id,
                        excluded: !data.excluded_from_spending,
                      })
                    }
                  >
                    {data.excluded_from_spending ? (
                      <>
                        <RotateCcw aria-hidden="true" />
                        Include in totals
                      </>
                    ) : (
                      <>
                        <Ban aria-hidden="true" />
                        Ignore in all totals
                      </>
                    )}
                  </Button>

                  <Button variant="ghost" size="sm" onClick={() => setRuleDialogOpen(true)}>
                    Create a rule from this
                  </Button>
                </div>

                {classify.isError || restore.isError || setExcluded.isError ? (
                  <Alert variant="destructive">
                    <AlertDescription>
                      We couldn&apos;t save that change. Please try again.
                    </AlertDescription>
                  </Alert>
                ) : null}
              </section>

              <CreateRuleDialog
                open={ruleDialogOpen}
                onOpenChange={setRuleDialogOpen}
                transaction={data}
              />
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function Detail({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2 min-w-0' : 'min-w-0'}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
  );
}

function ClassificationLayer({
  label,
  value,
  detail,
  emphasis,
}: {
  label: string;
  value: string;
  detail?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className={emphasis ? 'font-semibold text-primary' : 'font-medium capitalize'}>
          {value}
        </span>
        {detail ? (
          <span className="block break-words font-mono text-[11px] text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
