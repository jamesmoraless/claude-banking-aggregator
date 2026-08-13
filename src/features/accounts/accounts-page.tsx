import { Building2, CreditCard, Landmark, Search, Wallet } from 'lucide-react';
import * as React from 'react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorCard, NoResultsState } from '@/components/common/states';
import { ConnectionStatusBadge } from '@/components/common/status-badges';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConnectInstitutionButton } from '@/features/connections/connect-institution-button';
import { OnboardingPanel } from '@/features/onboarding/onboarding-panel';
import { useBaseCurrency } from '@/features/profile/hooks';
import { evaluateFreshness } from '@/lib/financial/freshness';
import { formatMoney, formatMoneyWithCurrencyCode } from '@/lib/financial/money';
import { cn } from '@/lib/utils';

import { AccountDetailDrawer } from './account-detail-drawer';
import type { AccountRow } from './api';
import { useAccounts, useCashSummary, useHasConnections } from './hooks';
import { ManualAccountsCard } from './manual-accounts-card';

type FilterTab = 'all' | 'cash' | 'credit' | 'investments' | 'hidden';

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'cash', label: 'Cash' },
  { id: 'credit', label: 'Credit' },
  { id: 'investments', label: 'Investments' },
  { id: 'hidden', label: 'Hidden' },
];

export function AccountsPage() {
  const connections = useHasConnections();
  const accounts = useAccounts();
  const cashSummary = useCashSummary();
  const baseCurrency = useBaseCurrency();

  const [tab, setTab] = React.useState<FilterTab>('all');
  const [search, setSearch] = React.useState('');
  const [selectedAccountId, setSelectedAccountId] = React.useState<string | null>(null);

  const allAccounts = accounts.data ?? [];
  const plaidAccounts = allAccounts.filter((account) => account.source === 'plaid');

  const visibleAccounts = React.useMemo(
    () => filterAccounts(plaidAccounts, tab, search),
    [plaidAccounts, tab, search],
  );

  const groups = React.useMemo(() => groupByInstitution(visibleAccounts), [visibleAccounts]);
  const hasActiveFilter = search.trim().length > 0 || tab !== 'all';

  if (connections.isLoading) return <AccountsSkeleton />;

  if (connections.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Accounts" />
        <ErrorCard
          title="We couldn't load your accounts"
          error={connections.error}
          onRetry={connections.refetch}
        />
      </div>
    );
  }

  if (!connections.hasAnyAccount) {
    return (
      <div className="space-y-6">
        <PageHeader title="Accounts" description="Connected institutions and balances" />
        <OnboardingPanel connectAction={<ConnectInstitutionButton size="lg" />} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="Connected institutions and balances"
        actions={<ConnectInstitutionButton />}
      />

      <section aria-label="Account totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          icon={Building2}
          label="Connected Institutions"
          value={cashSummary.data?.institution_count ?? null}
          isLoading={cashSummary.isLoading}
        />
        <SummaryTile
          icon={Wallet}
          label="Total Accounts"
          value={allAccounts.filter((account) => !account.hidden).length}
          isLoading={accounts.isLoading}
        />
        <SummaryTile
          icon={Landmark}
          label="Cash Accounts"
          value={cashSummary.data?.cash_account_count ?? null}
          caption={
            cashSummary.data
              ? `${formatMoney(cashSummary.data.total_cash, { currency: cashSummary.data.currency })} total`
              : undefined
          }
          isLoading={cashSummary.isLoading}
        />
        <SummaryTile
          icon={CreditCard}
          label="Credit Accounts"
          value={cashSummary.data?.credit_account_count ?? null}
          caption={
            cashSummary.data
              ? // Plaid reports credit balances as amounts owed; shown as a
                // negative figure because that is how people read what they owe.
                `${formatMoney(-cashSummary.data.credit_owed_total, { currency: cashSummary.data.currency })} owed`
              : undefined
          }
          isLoading={cashSummary.isLoading}
        />
      </section>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Tabs value={tab} onValueChange={(value) => setTab(value as FilterTab)}>
              <TabsList>
                {FILTER_TABS.map((item) => (
                  <TabsTrigger key={item.id} value={item.id}>
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="relative sm:w-64">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search accounts…"
                aria-label="Search accounts"
                className="pl-9"
              />
            </div>
          </div>

          {accounts.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : accounts.isError ? (
            <ErrorCard error={accounts.error} onRetry={() => void accounts.refetch()} />
          ) : plaidAccounts.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No bank accounts connected"
              description="You have manual accounts only. Connect an institution to import balances and transactions automatically."
              action={<ConnectInstitutionButton size="sm" />}
            />
          ) : groups.length === 0 ? (
            <NoResultsState
              entity="accounts"
              onClear={
                hasActiveFilter
                  ? () => {
                      setSearch('');
                      setTab('all');
                    }
                  : undefined
              }
            />
          ) : (
            <div className="space-y-5">
              {groups.map((group) => (
                <InstitutionSection
                  key={group.key}
                  group={group}
                  baseCurrency={baseCurrency}
                  onSelectAccount={setSelectedAccountId}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ManualAccountsCard
        accounts={allAccounts.filter((account) => account.source === 'manual')}
        isLoading={accounts.isLoading}
        baseCurrency={baseCurrency}
      />

      <AccountDetailDrawer
        accountId={selectedAccountId}
        onOpenChange={(open) => {
          if (!open) setSelectedAccountId(null);
        }}
      />
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  caption,
  isLoading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | null;
  caption?: string;
  isLoading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm text-muted-foreground">{label}</p>
          {isLoading ? (
            <Skeleton className="h-6 w-12" />
          ) : (
            <p className="text-metric-sm tabular-money">{value ?? '—'}</p>
          )}
          {caption ? <p className="truncate text-xs text-muted-foreground">{caption}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

type Group = { key: string; name: string; accounts: AccountRow[]; status: AccountRow['item_status'] };

function InstitutionSection({
  group,
  baseCurrency,
  onSelectAccount,
}: {
  group: Group;
  baseCurrency: string;
  onSelectAccount: (id: string) => void;
}) {
  const currency = group.accounts[0]?.currency ?? baseCurrency;
  const total = group.accounts
    .filter((account) => account.currency === currency && !account.hidden)
    .reduce((sum, account) => sum + (account.current_balance ?? 0), 0);

  return (
    <section aria-label={group.name} className="space-y-1">
      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{group.name}</h3>
          {group.status && group.status !== 'ACTIVE' ? (
            <ConnectionStatusBadge status={group.status} />
          ) : null}
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-money">
          {formatMoney(total, { currency })}
        </span>
      </div>

      <ul className="divide-y divide-border">
        {group.accounts.map((account) => (
          <li key={account.id}>
            <button
              type="button"
              onClick={() => onSelectAccount(account.id)}
              className={cn(
                'flex w-full items-center gap-3 px-3 py-3 text-left transition-colors',
                'hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                account.hidden && 'opacity-60',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {account.effective_name}
                  {account.mask ? (
                    <span className="ml-2 text-xs tabular-money text-muted-foreground">
                      ····{account.mask}
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs capitalize text-muted-foreground">
                  {account.type}
                  {account.subtype ? ` · ${account.subtype}` : ''}
                  {account.hidden ? ' · Hidden' : ''}
                </p>
              </div>

              <div className="hidden text-right md:block">
                <p className="text-xs text-muted-foreground">Available</p>
                <p className="text-sm tabular-money">
                  {account.available_balance == null
                    ? '—'
                    : formatMoney(account.available_balance, { currency: account.currency })}
                </p>
              </div>

              <div className="hidden text-right lg:block">
                <p className="text-xs text-muted-foreground">Last sync</p>
                <p className="text-sm">
                  {evaluateFreshness(account.last_synced_at).level === 'NEVER'
                    ? 'Never'
                    : evaluateFreshness(account.last_synced_at).label}
                </p>
              </div>

              <p className="w-28 shrink-0 text-right text-sm font-semibold tabular-money">
                {formatMoneyWithCurrencyCode(
                  account.current_balance,
                  account.currency,
                  baseCurrency,
                )}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Exported for tests: filtering is easy to get subtly wrong. */
export function filterAccounts(
  accounts: AccountRow[],
  tab: FilterTab,
  search: string,
): AccountRow[] {
  const term = search.trim().toLowerCase();

  return accounts.filter((account) => {
    // "Hidden" is its own tab; hidden accounts never appear in the others.
    if (tab === 'hidden') {
      if (!account.hidden) return false;
    } else if (account.hidden) {
      return false;
    }

    if (tab === 'cash' && account.cash_bucket !== 'CHECKING' && account.cash_bucket !== 'SAVINGS' && account.cash_bucket !== 'OTHER_CASH') {
      return false;
    }
    if (tab === 'credit' && account.cash_bucket !== 'CREDIT') return false;
    if (tab === 'investments' && account.cash_bucket !== 'INVESTMENT') return false;

    if (term.length > 0) {
      const haystack = [
        account.effective_name,
        account.official_name,
        account.institution_effective_name,
        account.mask,
        account.subtype,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(term)) return false;
    }

    return true;
  });
}

function groupByInstitution(accounts: AccountRow[]): Group[] {
  const map = new Map<string, AccountRow[]>();
  for (const account of accounts) {
    const key = account.institution_id ?? 'unknown';
    const existing = map.get(key);
    if (existing) existing.push(account);
    else map.set(key, [account]);
  }

  return [...map.entries()]
    .map(([key, rows]) => ({
      key,
      name: rows[0]?.institution_effective_name ?? 'Unknown institution',
      accounts: rows,
      status: rows[0]?.item_status ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function AccountsSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeader title="Accounts" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 w-full rounded-xl" />
      <span role="status" aria-live="polite" className="sr-only">
        Loading accounts
      </span>
    </div>
  );
}
