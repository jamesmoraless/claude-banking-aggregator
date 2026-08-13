import { Receipt } from 'lucide-react';
import { Link } from 'react-router-dom';

import { EmptyState, ErrorState } from '@/components/common/states';
import { ClassificationBadge, PendingBadge } from '@/components/common/status-badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useBaseCurrency } from '@/features/profile/hooks';
import { useRecentTransactions } from '@/features/transactions/hooks';
import { TransactionAmount } from '@/features/transactions/transaction-amount';
import { formatTransactionDate } from '@/lib/financial/dates';

/**
 * Most recent transactions across all accounts.
 *
 * Pending rows are shown — they are real activity the user will recognise — but
 * badged, because they are excluded from every spending total until they post.
 */
export function RecentActivityCard({ className }: { className?: string }) {
  const transactions = useRecentTransactions(6);
  const baseCurrency = useBaseCurrency();

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Recent Activity</CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/transactions">View all</Link>
        </Button>
      </CardHeader>

      <CardContent className="p-0">
        {transactions.isLoading ? (
          <div className="space-y-3 px-5 pb-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
            <span role="status" aria-live="polite" className="sr-only">
              Loading recent transactions
            </span>
          </div>
        ) : transactions.isError ? (
          <ErrorState
            title="We couldn't load recent activity"
            error={transactions.error}
            onRetry={() => void transactions.refetch()}
            compact
          />
        ) : (transactions.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No transactions yet"
            description="Transactions appear here once your institutions have finished syncing."
            compact
          />
        ) : (
          <ul className="divide-y divide-border">
            {transactions.data?.map((transaction) => (
              <li key={transaction.id}>
                <Link
                  to={`/transactions?transaction=${transaction.id}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{transaction.display_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {transaction.institution_name ?? transaction.account_name}
                      {' · '}
                      {formatTransactionDate(transaction.posted_date)}
                    </p>
                  </div>

                  <div className="hidden shrink-0 items-center gap-2 sm:flex">
                    {transaction.pending ? <PendingBadge /> : null}
                    <ClassificationBadge
                      type={transaction.effective_type}
                      transferSubtype={transaction.effective_transfer_subtype}
                    />
                  </div>

                  <TransactionAmount
                    amount={transaction.amount}
                    currency={transaction.currency}
                    baseCurrency={baseCurrency}
                    className="shrink-0"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
