import { AlertCircle, RefreshCw } from 'lucide-react';
import * as React from 'react';

import { ErrorState } from '@/components/common/states';
import { ConnectionStatusBadge } from '@/components/common/status-badges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Switch } from '@/components/ui/switch';
import { useRefreshConnections } from '@/features/connections/hooks';
import { useBaseCurrency } from '@/features/profile/hooks';
import { evaluateFreshness } from '@/lib/financial/freshness';
import { formatMoneyWithCurrencyCode } from '@/lib/financial/money';

import { useAccount, useUpdateAccountSettings } from './hooks';

/**
 * Account detail panel.
 *
 * Separates what Plaid owns (name, type, balances) from what the user owns
 * (display label, whether it counts as cash, whether it is hidden). Only the
 * latter are editable here — the former are overwritten on the next sync, so
 * offering to edit them would be a lie.
 */
export function AccountDetailDrawer({
  accountId,
  onOpenChange,
}: {
  accountId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const account = useAccount(accountId);
  const baseCurrency = useBaseCurrency();
  const updateSettings = useUpdateAccountSettings();
  const refresh = useRefreshConnections();

  const [displayName, setDisplayName] = React.useState('');

  React.useEffect(() => {
    setDisplayName(account.data?.display_name ?? '');
  }, [account.data?.display_name, account.data?.id]);

  const data = account.data;
  const freshness = evaluateFreshness(data?.last_synced_at);

  const saveDisplayName = () => {
    if (!data) return;
    const trimmed = displayName.trim();
    if (trimmed === (data.display_name ?? '')) return;
    updateSettings.mutate({
      accountId: data.id,
      changes: { display_name: trimmed.length > 0 ? trimmed : null },
    });
  };

  return (
    <Sheet open={Boolean(accountId)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{data?.effective_name ?? 'Account'}</SheetTitle>
          <SheetDescription>
            {data
              ? `${data.institution_effective_name ?? 'Manual account'} · ${data.type}${data.subtype ? ` · ${data.subtype}` : ''}`
              : 'Loading account details'}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-6 pt-5">
          {account.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : account.isError ? (
            <ErrorState error={account.error} onRetry={() => void account.refetch()} compact />
          ) : !data ? (
            <p className="text-sm text-muted-foreground">This account is no longer available.</p>
          ) : (
            <>
              {data.item_status && data.item_status !== 'ACTIVE' ? (
                <Alert variant="warning">
                  <AlertCircle aria-hidden="true" />
                  <div>
                    <AlertTitle>This connection needs attention</AlertTitle>
                    <AlertDescription>
                      Balances shown were last updated {freshness.label}. Reconnect this institution
                      from Settings to resume syncing.
                    </AlertDescription>
                  </div>
                </Alert>
              ) : null}

              <section className="space-y-3">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Current balance</p>
                    <p className="text-metric tabular-money">
                      {formatMoneyWithCurrencyCode(
                        data.current_balance,
                        data.currency,
                        baseCurrency,
                      )}
                    </p>
                  </div>
                  <ConnectionStatusBadge status={data.item_status} />
                </div>

                <dl className="grid grid-cols-2 gap-4 rounded-lg bg-muted/50 p-4 text-sm">
                  <DetailRow
                    label="Available"
                    value={
                      data.available_balance == null
                        ? '—'
                        : formatMoneyWithCurrencyCode(
                            data.available_balance,
                            data.currency,
                            baseCurrency,
                          )
                    }
                  />
                  {data.credit_limit != null ? (
                    <DetailRow
                      label="Credit limit"
                      value={formatMoneyWithCurrencyCode(
                        data.credit_limit,
                        data.currency,
                        baseCurrency,
                      )}
                    />
                  ) : null}
                  <DetailRow label="Currency" value={data.currency ?? '—'} />
                  <DetailRow label="Account number" value={data.mask ? `····${data.mask}` : '—'} />
                  <DetailRow
                    label="Last synced"
                    value={freshness.level === 'NEVER' ? 'Never' : freshness.label}
                  />
                  <DetailRow label="Official name" value={data.official_name ?? '—'} />
                </dl>

                {data.source === 'plaid' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refresh.mutate(data.plaid_item_id ?? undefined)}
                    loading={refresh.isPending}
                    loadingText="Refreshing…"
                  >
                    <RefreshCw aria-hidden="true" />
                    Refresh now
                  </Button>
                ) : null}
              </section>

              <Separator />

              <section className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">Your settings</h3>
                  <p className="text-sm text-muted-foreground">
                    These are preserved every time this account syncs.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="display-name">Display name</Label>
                  <Input
                    id="display-name"
                    value={displayName}
                    placeholder={data.name}
                    onChange={(event) => setDisplayName(event.target.value)}
                    onBlur={saveDisplayName}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to use the name from your bank ({data.name}).
                  </p>
                </div>

                <ToggleRow
                  id="include-in-cash"
                  label="Count as cash"
                  description="Include this balance in Total Cash on the Overview."
                  checked={data.include_in_cash}
                  disabled={updateSettings.isPending}
                  onChange={(checked) =>
                    updateSettings.mutate({
                      accountId: data.id,
                      changes: { include_in_cash: checked },
                    })
                  }
                />

                <ToggleRow
                  id="include-in-net-worth"
                  label="Count toward net worth"
                  description="Include this account in net-worth calculations."
                  checked={data.include_in_net_worth}
                  disabled={updateSettings.isPending}
                  onChange={(checked) =>
                    updateSettings.mutate({
                      accountId: data.id,
                      changes: { include_in_net_worth: checked },
                    })
                  }
                />

                <ToggleRow
                  id="hidden"
                  label="Hide this account"
                  description="Removes it from every view and report, including spending totals."
                  checked={data.hidden}
                  disabled={updateSettings.isPending}
                  onChange={(checked) =>
                    updateSettings.mutate({ accountId: data.id, changes: { hidden: checked } })
                  }
                />

                {updateSettings.isError ? (
                  <Alert variant="destructive">
                    <AlertCircle aria-hidden="true" />
                    <AlertDescription>
                      We couldn&apos;t save that change. Please try again.
                    </AlertDescription>
                  </Alert>
                ) : null}
              </section>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium tabular-money">{value}</dd>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
