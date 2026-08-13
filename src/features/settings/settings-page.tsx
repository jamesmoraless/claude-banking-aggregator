import { AlertCircle, Link2, Plus, RefreshCw, Trash2, Unlink } from 'lucide-react';
import * as React from 'react';

import { DataFreshnessIndicator } from '@/components/common/data-freshness';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, PartialFailureAlert } from '@/components/common/states';
import { ConnectionStatusBadge } from '@/components/common/status-badges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useAccounts, useDataFreshness, useUpdateAccountSettings } from '@/features/accounts/hooks';
import { ConnectInstitutionButton } from '@/features/connections/connect-institution-button';
import { useRefreshConnections, useRemoveConnection } from '@/features/connections/hooks';
import { ReconnectButton } from '@/features/connections/reconnect-button';
import { useProfile, useUpdateProfile } from '@/features/profile/hooks';
import { useDeleteRule, useRules, useUpdateRule } from '@/features/rules/hooks';
import {
  ECONOMIC_TYPE_LABELS,
  TRANSFER_SUBTYPE_LABELS,
} from '@/lib/financial/classification';
import { evaluateFreshness } from '@/lib/financial/freshness';

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD'];

const TIMEZONES = [
  'America/Toronto',
  'America/Vancouver',
  'America/Edmonton',
  'America/Winnipeg',
  'America/Halifax',
  'America/St_Johns',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'UTC',
];

export function SettingsPage() {
  const refresh = useRefreshConnections();
  const freshness = useDataFreshness();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Profile, connections, accounts and rules."
        actions={
          <DataFreshnessIndicator
            freshness={freshness.overall}
            onRefresh={() => refresh.mutate(undefined)}
            isRefreshing={refresh.isPending}
          />
        }
      />

      {/* One institution failing must not hide the ones that worked. */}
      {refresh.data && refresh.data.overallStatus !== 'SUCCESS' ? (
        <PartialFailureAlert
          succeeded={refresh.data.results
            .filter((result) => result.status === 'SUCCESS')
            .map((result) => ({ name: result.institutionName }))}
          failed={refresh.data.results
            .filter((result) => result.status === 'FAILED')
            .map((result) => ({
              name: result.institutionName,
              reason: result.errorMessage ?? 'Sync failed',
            }))}
        />
      ) : null}

      <ProfileSection />
      <ConnectionsSection />
      <AccountsSection />
      <RulesSection />
      <DataSection />
    </div>
  );
}

function ProfileSection() {
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
  const [displayName, setDisplayName] = React.useState('');

  React.useEffect(() => {
    setDisplayName(profile.data?.display_name ?? '');
  }, [profile.data?.display_name]);

  return (
    <Card>
      <CardHeader>
        <SectionHeader title="Profile" description="How Cash Atlas reports your finances." />
      </CardHeader>
      <CardContent className="space-y-4">
        {profile.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : profile.isError ? (
          <ErrorState error={profile.error} onRetry={() => void profile.refetch()} compact />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Display name</Label>
              <Input
                id="profile-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                onBlur={() => {
                  const trimmed = displayName.trim();
                  if (trimmed !== (profile.data?.display_name ?? '')) {
                    updateProfile.mutate({ display_name: trimmed || null });
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-currency">Base currency</Label>
              <Select
                value={profile.data?.base_currency ?? 'CAD'}
                onValueChange={(value) => updateProfile.mutate({ base_currency: value })}
              >
                <SelectTrigger id="profile-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((currency) => (
                    <SelectItem key={currency} value={currency}>
                      {currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Totals are calculated in this currency only. Accounts in other currencies are
                reported separately rather than converted.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-timezone">Timezone</Label>
              <Select
                value={profile.data?.timezone ?? 'America/Toronto'}
                onValueChange={(value) => updateProfile.mutate({ timezone: value })}
              >
                <SelectTrigger id="profile-timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((timezone) => (
                    <SelectItem key={timezone} value={timezone}>
                      {timezone.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectionsSection() {
  const freshness = useDataFreshness();
  const refresh = useRefreshConnections();
  const remove = useRemoveConnection();

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title="Connections"
          description="Institutions linked through Plaid."
          actions={<ConnectInstitutionButton variant="outline" size="sm" label="Add institution" />}
        />
      </CardHeader>
      <CardContent className="p-0">
        {freshness.isLoading ? (
          <div className="space-y-2 px-5 pb-5">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full" />
            ))}
          </div>
        ) : freshness.rows.length === 0 ? (
          <EmptyState
            icon={Link2}
            title="No institutions connected"
            description="Connect a bank to import balances and transactions automatically."
            action={<ConnectInstitutionButton size="sm" />}
            compact
          />
        ) : (
          <ul className="divide-y divide-border">
            {freshness.rows.map((row) => {
              const itemFreshness = evaluateFreshness(row.last_successful_sync_at);
              return (
                <li key={row.plaid_item_id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{row.institution_name}</p>
                      <ConnectionStatusBadge status={row.item_status} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {row.account_count} account{row.account_count === 1 ? '' : 's'} ·{' '}
                      {itemFreshness.level === 'NEVER'
                        ? 'never synced'
                        : `synced ${itemFreshness.label}`}
                    </p>
                    {row.requires_reauth ? (
                      <p className="mt-1 text-sm text-destructive">
                        Your bank needs you to sign in again before data can update.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {row.requires_reauth ? <ReconnectButton plaidItemId={row.plaid_item_id} /> : null}

                    <Button
                      variant="outline"
                      size="sm"
                      loading={refresh.isPending}
                      onClick={() => refresh.mutate(row.plaid_item_id)}
                    >
                      <RefreshCw aria-hidden="true" />
                      Refresh
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      loading={remove.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Disconnect ${row.institution_name}? Your existing accounts and transaction history are kept — only future syncing stops.`,
                          )
                        ) {
                          remove.mutate(row.plaid_item_id);
                        }
                      }}
                    >
                      <Unlink aria-hidden="true" />
                      Disconnect
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {remove.isError ? (
          <Alert variant="destructive" className="m-5">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>
              We couldn&apos;t disconnect that institution. Please try again.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AccountsSection() {
  const accounts = useAccounts();
  const updateAccount = useUpdateAccountSettings();

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title="Accounts"
          description="Control which accounts count toward your totals. These settings survive every sync."
        />
      </CardHeader>
      <CardContent className="p-0">
        {accounts.isLoading ? (
          <div className="space-y-2 px-5 pb-5">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : (accounts.data?.length ?? 0) === 0 ? (
          <EmptyState title="No accounts yet" description="Connect an institution to get started." compact />
        ) : (
          <ul className="divide-y divide-border">
            {accounts.data?.map((account) => (
              <li key={account.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{account.effective_name}</p>
                  <p className="truncate text-xs capitalize text-muted-foreground">
                    {account.institution_effective_name ?? 'Manual'} · {account.type}
                    {account.subtype ? ` · ${account.subtype}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-5">
                  <label className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={account.include_in_cash}
                      disabled={updateAccount.isPending}
                      onCheckedChange={(checked) =>
                        updateAccount.mutate({
                          accountId: account.id,
                          changes: { include_in_cash: checked },
                        })
                      }
                      aria-label={`Count ${account.effective_name} as cash`}
                    />
                    Cash
                  </label>

                  <label className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={account.hidden}
                      disabled={updateAccount.isPending}
                      onCheckedChange={(checked) =>
                        updateAccount.mutate({ accountId: account.id, changes: { hidden: checked } })
                      }
                      aria-label={`Hide ${account.effective_name}`}
                    />
                    Hidden
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RulesSection() {
  const rules = useRules();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title="Financial Rules"
          description="Reusable classification rules, applied in priority order during synchronisation."
        />
      </CardHeader>
      <CardContent className="p-0">
        {rules.isLoading ? (
          <div className="space-y-2 px-5 pb-5">
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (rules.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={Plus}
            title="No rules yet"
            description="Create one from any transaction's detail panel — for example, always treat anything from PAYROLL as income."
            compact
          />
        ) : (
          <ul className="divide-y divide-border">
            {rules.data?.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{rule.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {rule.match_field.replace(/_/g, ' ').toLowerCase()}{' '}
                    {rule.match_operator.replace(/_/g, ' ').toLowerCase()} &ldquo;{rule.match_value}
                    &rdquo; → {ECONOMIC_TYPE_LABELS[rule.result_type]}
                    {rule.result_transfer_subtype
                      ? ` (${TRANSFER_SUBTYPE_LABELS[rule.result_transfer_subtype]})`
                      : ''}
                  </p>
                </div>

                <Badge variant="neutral">Priority {rule.priority}</Badge>

                <Switch
                  checked={rule.enabled}
                  disabled={updateRule.isPending}
                  onCheckedChange={(checked) =>
                    updateRule.mutate({ ruleId: rule.id, changes: { enabled: checked } })
                  }
                  aria-label={`Enable rule ${rule.name}`}
                />

                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete rule ${rule.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete the rule "${rule.name}"?`)) {
                      deleteRule.mutate(rule.id);
                    }
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DataSection() {
  const freshness = useDataFreshness();

  return (
    <Card>
      <CardHeader>
        <SectionHeader title="Data" description="Synchronisation status by institution." />
      </CardHeader>
      <CardContent className="space-y-3">
        {freshness.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : freshness.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has been synchronised yet.</p>
        ) : (
          <dl className="space-y-2 text-sm">
            {freshness.rows.map((row) => (
              <div key={row.plaid_item_id} className="flex flex-wrap justify-between gap-2">
                <dt className="font-medium">{row.institution_name}</dt>
                <dd className="text-muted-foreground">
                  Accounts:{' '}
                  {row.last_accounts_sync_at
                    ? evaluateFreshness(row.last_accounts_sync_at).label
                    : 'never'}
                  {' · '}
                  Transactions:{' '}
                  {row.last_transactions_sync_at
                    ? evaluateFreshness(row.last_transactions_sync_at).label
                    : 'never'}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <Alert>
          <AlertTitle>How syncing works</AlertTitle>
          <AlertDescription>
            Your bank notifies Plaid when new transactions are available, and Cash Atlas imports them
            automatically. A scheduled job also runs periodically as a safety net. You can refresh
            manually at any time.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
