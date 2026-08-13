import { zodResolver } from '@hookform/resolvers/zod';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { PiggyBank, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { SectionHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { formatMoneyWithCurrencyCode } from '@/lib/financial/money';

import type { AccountRow } from './api';
import { useCreateManualAccount, useDeleteManualAccount, useUpdateManualAccount } from './hooks';

/**
 * Manual accounts.
 *
 * For cash, or institutions Plaid does not cover. They are marked "Manual"
 * everywhere so a stale hand-entered balance is never mistaken for a synced
 * one, and they are the only accounts a user can create or delete directly.
 */

const manualAccountSchema = z.object({
  name: z.string().trim().min(1, 'Give this account a name').max(80, 'Keep the name under 80 characters'),
  type: z.enum(['depository', 'credit', 'investment', 'loan', 'other']),
  subtype: z.string().trim().max(40).optional(),
  currentBalance: z
    .number({ invalid_type_error: 'Enter a balance' })
    .finite('Enter a valid balance'),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Use a 3-letter currency code, e.g. CAD'),
  includeInCash: z.boolean(),
});

type ManualAccountForm = z.infer<typeof manualAccountSchema>;

export function ManualAccountsCard({
  accounts,
  isLoading,
  baseCurrency,
}: {
  accounts: AccountRow[];
  isLoading: boolean;
  baseCurrency: string;
}) {
  const [editing, setEditing] = React.useState<AccountRow | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const deleteAccount = useDeleteManualAccount();

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title="Manual Accounts"
          description="Balances you maintain yourself, for cash or institutions Plaid doesn't support."
          actions={
            <Button variant="outline" size="sm" onClick={() => setIsCreating(true)}>
              <Plus aria-hidden="true" />
              Add account
            </Button>
          }
        />
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 px-5 pb-5">
            <Skeleton className="h-16 w-full" />
          </div>
        ) : accounts.length === 0 ? (
          <EmptyState
            icon={PiggyBank}
            title="No manual accounts"
            description="Add one to track cash on hand or an account Cash Atlas can't connect to."
            compact
          />
        ) : (
          <ul className="divide-y divide-border">
            {accounts.map((account) => (
              <li key={account.id} className="flex items-center gap-3 px-5 py-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary">
                  <PiggyBank className="size-4" aria-hidden="true" />
                </span>

                <button
                  type="button"
                  onClick={() => setEditing(account)}
                  className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block truncate text-sm font-medium">
                    {account.effective_name}
                  </span>
                  <span className="block truncate text-xs capitalize text-muted-foreground">
                    {account.type}
                    {account.subtype ? ` · ${account.subtype}` : ''}
                    {account.balances_updated_at
                      ? ` · updated ${formatDistanceToNowStrict(parseISO(account.balances_updated_at))} ago`
                      : ''}
                  </span>
                </button>

                <span className="shrink-0 text-sm font-semibold tabular-money">
                  {formatMoneyWithCurrencyCode(
                    account.current_balance,
                    account.currency,
                    baseCurrency,
                  )}
                </span>
                <Badge variant="neutral">Manual</Badge>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${account.effective_name}`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete "${account.effective_name}"? Any transactions recorded against it will also be removed.`,
                      )
                    ) {
                      deleteAccount.mutate(account.id);
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

      <ManualAccountDialog
        open={isCreating || editing !== null}
        account={editing}
        baseCurrency={baseCurrency}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreating(false);
            setEditing(null);
          }
        }}
      />
    </Card>
  );
}

function ManualAccountDialog({
  open,
  account,
  baseCurrency,
  onOpenChange,
}: {
  open: boolean;
  account: AccountRow | null;
  baseCurrency: string;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateManualAccount();
  const update = useUpdateManualAccount();
  const isEditing = account !== null;

  const form = useForm<ManualAccountForm>({
    resolver: zodResolver(manualAccountSchema),
    defaultValues: {
      name: '',
      type: 'depository',
      subtype: 'savings',
      currentBalance: 0,
      currency: baseCurrency,
      includeInCash: true,
    },
  });

  React.useEffect(() => {
    if (!open) return;
    form.reset(
      account
        ? {
            name: account.display_name ?? account.name,
            type: (account.type as ManualAccountForm['type']) ?? 'depository',
            subtype: account.subtype ?? '',
            currentBalance: account.current_balance ?? 0,
            currency: account.currency ?? baseCurrency,
            includeInCash: account.include_in_cash,
          }
        : {
            name: '',
            type: 'depository',
            subtype: 'savings',
            currentBalance: 0,
            currency: baseCurrency,
            includeInCash: true,
          },
    );
  }, [open, account, baseCurrency, form]);

  const onSubmit = (values: ManualAccountForm) => {
    const payload = {
      name: values.name,
      type: values.type,
      subtype: values.subtype?.trim() ? values.subtype.trim() : null,
      currentBalance: values.currentBalance,
      currency: values.currency.toUpperCase(),
      includeInCash: values.includeInCash,
    };

    const onDone = { onSuccess: () => onOpenChange(false) };

    if (account) update.mutate({ accountId: account.id, input: payload }, onDone);
    else create.mutate(payload, onDone);
  };

  const isPending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit manual account' : 'Add manual account'}</DialogTitle>
          <DialogDescription>
            Manual balances are not synced. Update them yourself when they change.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <div className="space-y-2">
            <Label htmlFor="manual-name">Account name</Label>
            <Input id="manual-name" {...form.register('name')} aria-invalid={Boolean(form.formState.errors.name)} />
            {form.formState.errors.name ? (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="manual-type">Type</Label>
              <Select
                value={form.watch('type')}
                onValueChange={(value) => form.setValue('type', value as ManualAccountForm['type'])}
              >
                <SelectTrigger id="manual-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="depository">Cash / Depository</SelectItem>
                  <SelectItem value="credit">Credit</SelectItem>
                  <SelectItem value="investment">Investment</SelectItem>
                  <SelectItem value="loan">Loan</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="manual-subtype">Subtype</Label>
              <Input id="manual-subtype" placeholder="savings" {...form.register('subtype')} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="manual-balance">Current balance</Label>
              <Input
                id="manual-balance"
                type="number"
                step="0.01"
                inputMode="decimal"
                {...form.register('currentBalance', { valueAsNumber: true })}
                aria-invalid={Boolean(form.formState.errors.currentBalance)}
              />
              {form.formState.errors.currentBalance ? (
                <p className="text-sm text-destructive">
                  {form.formState.errors.currentBalance.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="manual-currency">Currency</Label>
              <Input id="manual-currency" maxLength={3} className="uppercase" {...form.register('currency')} />
              {form.formState.errors.currency ? (
                <p className="text-sm text-destructive">{form.formState.errors.currency.message}</p>
              ) : null}
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg bg-muted/50 p-3">
            <div className="space-y-0.5">
              <Label htmlFor="manual-cash">Count as cash</Label>
              <p className="text-xs text-muted-foreground">
                Include this balance in Total Cash on the Overview.
              </p>
            </div>
            <Switch
              id="manual-cash"
              checked={form.watch('includeInCash')}
              onCheckedChange={(checked) => form.setValue('includeInCash', checked)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending} loadingText="Saving…">
              {isEditing ? 'Save changes' : 'Add account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
