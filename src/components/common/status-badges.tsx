import {
  AlertCircle,
  ArrowLeftRight,
  Ban,
  CheckCircle2,
  Clock,
  HelpCircle,
  PenLine,
  RotateCcw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  ECONOMIC_TYPE_LABELS,
  type EconomicType,
  TRANSFER_SUBTYPE_LABELS,
  type TransferSubtype,
} from '@/lib/financial/classification';
import type { Enums } from '@/types/database.types';

/**
 * Status vocabulary.
 *
 * Every badge pairs an icon with a text label. None of them rely on colour
 * alone, so "Reconnect required" is still legible in greyscale, and a screen
 * reader announces the words rather than a colour.
 */

const ITEM_STATUS_CONFIG: Record<
  Enums<'plaid_item_status'>,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral'; icon: typeof CheckCircle2 }
> = {
  ACTIVE: { label: 'Connected', variant: 'success', icon: CheckCircle2 },
  LOGIN_REQUIRED: { label: 'Reconnect required', variant: 'danger', icon: AlertCircle },
  PENDING_EXPIRATION: { label: 'Consent expiring', variant: 'warning', icon: Clock },
  ERROR: { label: 'Sync error', variant: 'danger', icon: AlertCircle },
  REVOKED: { label: 'Access revoked', variant: 'danger', icon: Ban },
  DISCONNECTED: { label: 'Disconnected', variant: 'neutral', icon: Ban },
};

export function ConnectionStatusBadge({
  status,
  className,
}: {
  status: Enums<'plaid_item_status'> | null | undefined;
  className?: string;
}) {
  if (!status) {
    return (
      <Badge variant="neutral" className={className}>
        <PenLine aria-hidden="true" />
        Manual
      </Badge>
    );
  }

  const config = ITEM_STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className={className}>
      <Icon aria-hidden="true" />
      {config.label}
    </Badge>
  );
}

const TYPE_ICONS: Record<EconomicType, typeof TrendingUp> = {
  INCOME: TrendingUp,
  EXPENSE: TrendingDown,
  REFUND: RotateCcw,
  TRANSFER: ArrowLeftRight,
  ADJUSTMENT: PenLine,
  UNKNOWN: HelpCircle,
};

const TYPE_VARIANTS: Record<
  EconomicType,
  'success' | 'neutral' | 'info' | 'warning' | 'outline'
> = {
  INCOME: 'success',
  EXPENSE: 'neutral',
  REFUND: 'info',
  TRANSFER: 'info',
  ADJUSTMENT: 'outline',
  UNKNOWN: 'warning',
};

export function ClassificationBadge({
  type,
  transferSubtype,
  className,
}: {
  type: EconomicType;
  transferSubtype?: TransferSubtype | null;
  className?: string;
}) {
  const Icon = TYPE_ICONS[type];
  const label =
    type === 'TRANSFER' && transferSubtype
      ? TRANSFER_SUBTYPE_LABELS[transferSubtype]
      : ECONOMIC_TYPE_LABELS[type];

  return (
    <Badge variant={TYPE_VARIANTS[type]} className={className}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}

export function PendingBadge() {
  return (
    <Badge variant="neutral" title="Pending transactions are excluded from spending totals until they post">
      <Clock aria-hidden="true" />
      Pending
    </Badge>
  );
}

export function OverriddenBadge() {
  return (
    <Badge variant="outline" title="You classified this transaction manually">
      <PenLine aria-hidden="true" />
      Manual
    </Badge>
  );
}

export function ExcludedBadge() {
  return (
    <Badge variant="neutral" title="Excluded from all spending and income totals">
      <Ban aria-hidden="true" />
      Excluded
    </Badge>
  );
}

const MATCH_STATUS_CONFIG: Record<
  Enums<'transfer_match_status'>,
  { label: string; variant: 'success' | 'warning' | 'neutral' | 'info' }
> = {
  AUTO_MATCHED: { label: 'Auto-matched', variant: 'info' },
  NEEDS_REVIEW: { label: 'Needs review', variant: 'warning' },
  USER_CONFIRMED: { label: 'Confirmed', variant: 'success' },
  USER_REJECTED: { label: 'Rejected', variant: 'neutral' },
};

export function TransferMatchBadge({ status }: { status: Enums<'transfer_match_status'> }) {
  const config = MATCH_STATUS_CONFIG[status];
  return (
    <Badge variant={config.variant}>
      <ArrowLeftRight aria-hidden="true" />
      {config.label}
    </Badge>
  );
}

/**
 * Confidence, expressed as a percentage with a qualitative label. A bare "87%"
 * does not tell the user whether that is good.
 */
export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  const variant = confidence >= 0.9 ? 'success' : confidence >= 0.7 ? 'info' : 'warning';
  const qualifier = confidence >= 0.9 ? 'High' : confidence >= 0.7 ? 'Moderate' : 'Low';

  return (
    <Badge variant={variant} title={`${qualifier} confidence this is an internal transfer`}>
      {qualifier} confidence · {percent}%
    </Badge>
  );
}
