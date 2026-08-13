import { Building2, ChevronDown, Landmark } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';

import { EmptyState, ErrorState } from '@/components/common/states';
import { ConnectionStatusBadge } from '@/components/common/status-badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { AccountRow } from '@/features/accounts/api';
import { useAccounts } from '@/features/accounts/hooks';
import { ConnectInstitutionButton } from '@/features/connections/connect-institution-button';
import { useBaseCurrency } from '@/features/profile/hooks';
import { formatMoneyWithCurrencyCode } from '@/lib/financial/money';
import { cn } from '@/lib/utils';

/**
 * Connected institutions, each with its accounts.
 *
 * Institution totals sum only accounts in the base currency. Where an
 * institution also holds another currency, that is stated rather than folded
 * into a single misleading number.
 */
export function ConnectedInstitutionsCard({ className }: { className?: string }) {
  const accounts = useAccounts();
  const baseCurrency = useBaseCurrency();

  const groups = React.useMemo(() => groupByInstitution(accounts.data ?? []), [accounts.data]);

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Connected Institutions</CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/settings">Manage</Link>
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {accounts.isLoading ? (
          <>
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
            <span role="status" aria-live="polite" className="sr-only">
              Loading institutions
            </span>
          </>
        ) : accounts.isError ? (
          <ErrorState
            title="We couldn't load your institutions"
            error={accounts.error}
            onRetry={() => void accounts.refetch()}
            compact
          />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No institutions connected"
            description="Connect your first bank to see your balances here."
            action={<ConnectInstitutionButton size="sm" />}
            compact
          />
        ) : (
          <>
            <ul className="space-y-3">
              {groups.map((group) => (
                <InstitutionGroup key={group.key} group={group} baseCurrency={baseCurrency} />
              ))}
            </ul>
            <ConnectInstitutionButton
              variant="ghost"
              size="sm"
              label="Add an institution"
              className="pt-1"
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

type InstitutionGroup = {
  key: string;
  name: string;
  accounts: AccountRow[];
  total: number;
  otherCurrencies: string[];
  status: AccountRow['item_status'];
};

function groupByInstitution(accounts: AccountRow[]): InstitutionGroup[] {
  const visible = accounts.filter((account) => !account.hidden && !account.closed_at);
  const byInstitution = new Map<string, AccountRow[]>();

  for (const account of visible) {
    const key = account.institution_id ?? `manual:${account.source}`;
    const existing = byInstitution.get(key);
    if (existing) existing.push(account);
    else byInstitution.set(key, [account]);
  }

  return [...byInstitution.entries()]
    .map(([key, rows]) => {
      const first = rows[0]!;
      const baseCurrency = first.currency;
      return {
        key,
        name: first.institution_effective_name ?? 'Manual accounts',
        accounts: rows,
        // Only sums accounts sharing a currency; see otherCurrencies below.
        total: rows
          .filter((row) => row.currency === baseCurrency)
          .reduce((sum, row) => sum + (row.current_balance ?? 0), 0),
        otherCurrencies: [
          ...new Set(
            rows.filter((row) => row.currency !== baseCurrency).map((row) => row.currency ?? '—'),
          ),
        ],
        status: first.item_status,
      };
    })
    .sort((a, b) => b.total - a.total);
}

function InstitutionGroup({
  group,
  baseCurrency,
}: {
  group: InstitutionGroup;
  baseCurrency: string;
}) {
  const [expanded, setExpanded] = React.useState(true);
  const contentId = `institution-${group.key}`;

  return (
    <li className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={contentId}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Landmark className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{group.name}</span>
          <span className="block text-xs text-muted-foreground">
            {group.accounts.length} account{group.accounts.length === 1 ? '' : 's'}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-money text-primary">
            {formatMoneyWithCurrencyCode(
              group.total,
              group.accounts[0]?.currency ?? baseCurrency,
              baseCurrency,
            )}
          </span>
          {group.status && group.status !== 'ACTIVE' ? (
            <ConnectionStatusBadge status={group.status} className="mt-1" />
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {expanded ? (
        <ul id={contentId} className="space-y-1 border-t border-border px-3 py-2">
          {group.accounts.map((account) => (
            <li key={account.id} className="flex items-center justify-between gap-3 py-1">
              <span className="min-w-0 truncate text-sm text-muted-foreground">
                {account.effective_name}
                {account.mask ? (
                  <span className="ml-1.5 text-xs tabular-money">····{account.mask}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-sm tabular-money">
                {formatMoneyWithCurrencyCode(account.current_balance, account.currency, baseCurrency)}
              </span>
            </li>
          ))}
          {group.otherCurrencies.length > 0 ? (
            <li className="pt-1 text-xs text-finance-warning">
              Total excludes {group.otherCurrencies.join(', ')} accounts
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}
