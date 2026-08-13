import * as React from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { useCreateRule } from '@/features/rules/hooks';
import {
  ECONOMIC_TYPE_LABELS,
  type EconomicType,
  TRANSFER_SUBTYPE_LABELS,
  TRANSFER_SUBTYPES,
  type TransferSubtype,
} from '@/lib/financial/classification';
import type { Tables } from '@/types/database.types';

/**
 * Creates a reusable rule from a transaction the user is already looking at.
 *
 * Pre-filled from that transaction, because "always treat this merchant this
 * way" is the thought people actually have — not "let me go and author a rule".
 */
export function CreateRuleDialog({
  open,
  onOpenChange,
  transaction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: Tables<'transactions_classified'>;
}) {
  const createRule = useCreateRule();

  const suggestedValue = transaction.merchant_name ?? transaction.name;
  const [matchValue, setMatchValue] = React.useState(suggestedValue);
  const [resultType, setResultType] = React.useState<EconomicType>(
    transaction.effective_type === 'UNKNOWN' ? 'EXPENSE' : transaction.effective_type,
  );
  const [subtype, setSubtype] = React.useState<TransferSubtype>(
    transaction.effective_transfer_subtype ?? 'ACCOUNT_TO_ACCOUNT',
  );

  React.useEffect(() => {
    if (!open) return;
    setMatchValue(transaction.merchant_name ?? transaction.name);
    setResultType(transaction.effective_type === 'UNKNOWN' ? 'EXPENSE' : transaction.effective_type);
    setSubtype(transaction.effective_transfer_subtype ?? 'ACCOUNT_TO_ACCOUNT');
  }, [open, transaction]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = matchValue.trim();
    if (trimmed.length === 0) return;

    createRule.mutate(
      {
        name: `${ECONOMIC_TYPE_LABELS[resultType]}: ${trimmed}`,
        enabled: true,
        priority: 100,
        match_field: 'MERCHANT_OR_NAME',
        match_operator: 'CONTAINS',
        match_value: trimmed,
        result_type: resultType,
        result_transfer_subtype: resultType === 'TRANSFER' ? subtype : null,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a classification rule</DialogTitle>
          <DialogDescription>
            Applies to future transactions whose merchant or description contains this text.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="rule-match">When merchant or description contains</Label>
            <Input
              id="rule-match"
              value={matchValue}
              onChange={(event) => setMatchValue(event.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Matching is case-insensitive. Keep it short and distinctive.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-result">Classify as</Label>
            <Select value={resultType} onValueChange={(value) => setResultType(value as EconomicType)}>
              <SelectTrigger id="rule-result">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['INCOME', 'EXPENSE', 'TRANSFER', 'REFUND', 'ADJUSTMENT'] as EconomicType[]).map(
                  (type) => (
                    <SelectItem key={type} value={type}>
                      {ECONOMIC_TYPE_LABELS[type]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          {resultType === 'TRANSFER' ? (
            <div className="space-y-2">
              <Label htmlFor="rule-subtype">Transfer type</Label>
              <Select value={subtype} onValueChange={(value) => setSubtype(value as TransferSubtype)}>
                <SelectTrigger id="rule-subtype">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSFER_SUBTYPES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {TRANSFER_SUBTYPE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <Alert>
            <AlertDescription>
              Rules apply the next time transactions are classified. Existing classifications you set
              by hand are not overwritten.
            </AlertDescription>
          </Alert>

          {createRule.isError ? (
            <Alert variant="destructive">
              <AlertDescription>We couldn&apos;t save that rule. Please try again.</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={createRule.isPending} loadingText="Saving…">
              Create rule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
