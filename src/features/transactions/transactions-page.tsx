import { ArrowLeftRight, ChevronLeft, ChevronRight, Receipt } from 'lucide-react';
import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorCard, NoResultsState } from '@/components/common/states';
import {
  ClassificationBadge,
  OverriddenBadge,
  PendingBadge,
} from '@/components/common/status-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useHasConnections } from '@/features/accounts/hooks';
import { ConnectInstitutionButton } from '@/features/connections/connect-institution-button';
import { OnboardingPanel } from '@/features/onboarding/onboarding-panel';
import { useBaseCurrency } from '@/features/profile/hooks';
import { useTransferReviewCount } from '@/features/transfers/hooks';
import { exclusionBucketLabel } from '@/lib/financial/classification';
import { formatTransactionDate, resolveRangePreset } from '@/lib/financial/dates';

import type { TransactionFilters } from './api';
import { TRANSACTIONS_PAGE_SIZE } from './api';
import { useTransactions } from './hooks';
import { TransactionAmount } from './transaction-amount';
import { TransactionDetailDrawer } from './transaction-detail-drawer';
import { TransactionFilterBar } from './transaction-filter-bar';

/**
 * Transaction explorer.
 *
 * Filter state lives in the URL, so a filtered view can be linked to and
 * survives a refresh. That is what lets a figure in the Cash Flow calculation
 * panel link straight to the transactions behind it — the reason the panel is
 * auditable rather than merely informative.
 */
export function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const connections = useHasConnections();
  const baseCurrency = useBaseCurrency();
  const reviewCount = useTransferReviewCount();

  const [page, setPage] = React.useState(0);

  const defaultRange = React.useMemo(() => resolveRangePreset('3M'), []);
  const filters = React.useMemo(
    () => filtersFromSearchParams(searchParams, defaultRange),
    [searchParams, defaultRange],
  );

  const selectedTransactionId = searchParams.get('transaction');
  const transactions = useTransactions(filters, page);

  // Any filter change returns to the first page; staying on page 7 of a
  // now-3-page result set shows an empty table that looks like no data.
  const updateFilters = React.useCallback(
    (next: TransactionFilters) => {
      setPage(0);
      setSearchParams(searchParamsFromFilters(next, defaultRange), { replace: true });
    },
    [setSearchParams, defaultRange],
  );

  const clearFilters = React.useCallback(() => {
    setPage(0);
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const openTransaction = React.useCallback(
    (transactionId: string | null) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (transactionId) next.set('transaction', transactionId);
          else next.delete('transaction');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const hasActiveFilters = isFiltered(searchParams);
  const rows = transactions.data?.rows ?? [];
  const totalCount = transactions.data?.totalCount ?? 0;

  if (connections.isLoading) return <TransactionsSkeleton />;

  if (!connections.hasAnyAccount) {
    return (
      <div className="space-y-6">
        <PageHeader title="Transactions" description="Search, filter and classify your activity." />
        <OnboardingPanel connectAction={<ConnectInstitutionButton size="lg" />} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description="Search, filter and classify your activity."
        actions={
          reviewCount > 0 ? (
            <Button variant="outline" asChild>
              <Link to="/transactions/transfers">
                <ArrowLeftRight aria-hidden="true" />
                Review {reviewCount} transfer{reviewCount === 1 ? '' : 's'}
              </Link>
            </Button>
          ) : null
        }
      />

      <TransactionFilterBar
        filters={filters}
        onChange={updateFilters}
        onClear={clearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      <Card>
        <CardContent className="p-0">
          {transactions.isLoading ? (
            <TableSkeleton />
          ) : transactions.isError ? (
            <ErrorCard
              title="We couldn't load your transactions"
              error={transactions.error}
              onRetry={() => void transactions.refetch()}
            />
          ) : rows.length === 0 ? (
            hasActiveFilters ? (
              <NoResultsState entity="transactions" onClear={clearFilters} />
            ) : (
              <EmptyState
                icon={Receipt}
                title="No transactions available yet"
                description="Connect an institution or synchronise your accounts to import your transaction history."
                action={<ConnectInstitutionButton size="sm" />}
              />
            )
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead>Merchant</TableHead>
                    <TableHead className="hidden lg:table-cell">Account</TableHead>
                    <TableHead className="hidden xl:table-cell">Category</TableHead>
                    <TableHead>Classification</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((transaction) => (
                    <TableRow
                      key={transaction.id}
                      interactive
                      tabIndex={0}
                      role="button"
                      aria-label={`View ${transaction.display_name}`}
                      data-state={selectedTransactionId === transaction.id ? 'selected' : undefined}
                      onClick={() => openTransaction(transaction.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openTransaction(transaction.id);
                        }
                      }}
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTransactionDate(transaction.posted_date)}
                      </TableCell>

                      <TableCell className="max-w-[16rem]">
                        <p className="truncate font-medium">{transaction.display_name}</p>
                        <p className="truncate text-xs text-muted-foreground lg:hidden">
                          {transaction.institution_name ?? transaction.account_name}
                        </p>
                      </TableCell>

                      <TableCell className="hidden max-w-[14rem] lg:table-cell">
                        <p className="truncate text-sm">{transaction.account_name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {transaction.institution_name ?? 'Manual'}
                        </p>
                      </TableCell>

                      <TableCell className="hidden xl:table-cell">
                        <span className="text-sm text-muted-foreground">
                          {formatCategory(transaction.plaid_category_primary)}
                        </span>
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <ClassificationBadge
                            type={transaction.effective_type}
                            transferSubtype={transaction.effective_transfer_subtype}
                          />
                          {transaction.pending ? <PendingBadge /> : null}
                          {transaction.is_user_overridden ? <OverriddenBadge /> : null}
                          {transaction.spending_exclusion_bucket &&
                          transaction.spending_exclusion_bucket !== 'UNCLASSIFIED' ? (
                            <Badge variant="neutral">
                              {exclusionBucketLabel(transaction.spending_exclusion_bucket)}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>

                      <TableCell className="text-right">
                        <TransactionAmount
                          amount={transaction.amount}
                          currency={transaction.currency}
                          baseCurrency={baseCurrency}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <nav
                aria-label="Transaction pages"
                className="flex items-center justify-between gap-4 border-t border-border px-5 py-3"
              >
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Showing{' '}
                  <span className="font-medium text-foreground">
                    {page * TRANSACTIONS_PAGE_SIZE + 1}–
                    {page * TRANSACTIONS_PAGE_SIZE + rows.length}
                  </span>{' '}
                  of <span className="font-medium text-foreground">{totalCount.toLocaleString()}</span>
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0 || transactions.isFetching}
                    onClick={() => setPage((value) => Math.max(0, value - 1))}
                  >
                    <ChevronLeft aria-hidden="true" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!transactions.data?.hasMore || transactions.isFetching}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Next
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
              </nav>
            </>
          )}
        </CardContent>
      </Card>

      <TransactionDetailDrawer
        transactionId={selectedTransactionId}
        onOpenChange={(open) => {
          if (!open) openTransaction(null);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// URL <-> filter mapping. Exported for tests.
// ---------------------------------------------------------------------------

export function filtersFromSearchParams(
  params: URLSearchParams,
  defaultRange: { from: string; to: string },
): TransactionFilters {
  const list = (key: string) => {
    const value = params.get(key);
    return value ? value.split(',').filter(Boolean) : undefined;
  };
  const number = (key: string) => {
    const value = params.get(key);
    if (value == null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  return {
    from: params.get('from') ?? defaultRange.from,
    to: params.get('to') ?? defaultRange.to,
    accountIds: list('accounts'),
    institutionIds: list('institutions'),
    categories: list('categories'),
    economicTypes: list('types') as TransactionFilters['economicTypes'],
    search: params.get('q') ?? undefined,
    minAmount: number('min'),
    maxAmount: number('max'),
    status: (params.get('status') as TransactionFilters['status']) ?? 'ALL',
    transferStatus:
      (params.get('transfers') as TransactionFilters['transferStatus']) ?? 'ALL',
    needsReviewOnly: params.get('review') === '1',
    exclusionBucket: params.get('bucket') ?? undefined,
  };
}

export function searchParamsFromFilters(
  filters: TransactionFilters,
  defaultRange: { from: string; to: string },
): Record<string, string> {
  const params: Record<string, string> = {};

  if (filters.from && filters.from !== defaultRange.from) params.from = filters.from;
  if (filters.to && filters.to !== defaultRange.to) params.to = filters.to;
  if (filters.accountIds?.length) params.accounts = filters.accountIds.join(',');
  if (filters.institutionIds?.length) params.institutions = filters.institutionIds.join(',');
  if (filters.categories?.length) params.categories = filters.categories.join(',');
  if (filters.economicTypes?.length) params.types = filters.economicTypes.join(',');
  if (filters.search?.trim()) params.q = filters.search.trim();
  if (filters.minAmount != null) params.min = String(filters.minAmount);
  if (filters.maxAmount != null) params.max = String(filters.maxAmount);
  if (filters.status && filters.status !== 'ALL') params.status = filters.status;
  if (filters.transferStatus && filters.transferStatus !== 'ALL') {
    params.transfers = filters.transferStatus;
  }
  if (filters.needsReviewOnly) params.review = '1';
  if (filters.exclusionBucket) params.bucket = filters.exclusionBucket;

  return params;
}

/** `transaction` is a selection, not a filter, so it does not count. */
export function isFiltered(params: URLSearchParams): boolean {
  for (const key of params.keys()) {
    if (key !== 'transaction') return true;
  }
  return false;
}

export function formatCategory(category: string | null): string {
  if (!category) return 'Uncategorised';
  const cleaned = category.replace(/_/g, ' ').toLowerCase();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function TableSkeleton() {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: 8 }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
      <span role="status" aria-live="polite" className="sr-only">
        Loading transactions
      </span>
    </div>
  );
}

function TransactionsSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeader title="Transactions" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}
