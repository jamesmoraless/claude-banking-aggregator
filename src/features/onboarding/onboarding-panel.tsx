import { Building2, Eye, Lock, RefreshCw } from 'lucide-react';
import * as React from 'react';

import { Card, CardContent } from '@/components/ui/card';

/**
 * First-run experience.
 *
 * Shown instead of a zero-filled dashboard. A brand-new user's cash is unknown,
 * not zero, and presenting "$0.00" across four metric cards reads as a broken
 * account rather than as an empty one.
 *
 * It also states plainly what connecting a bank does and does not allow, since
 * that is the question anyone hesitates over before handing over bank access.
 */
export function OnboardingPanel({ connectAction }: { connectAction: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-6 sm:p-10">
        <div className="mx-auto max-w-2xl space-y-8 text-center">
          <div className="space-y-3">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary-subtle text-primary">
              <Building2 className="size-6" aria-hidden="true" />
            </span>
            <h2 className="text-xl font-semibold tracking-tight">No accounts connected</h2>
            <p className="mx-auto max-w-lg text-sm leading-relaxed text-muted-foreground">
              Connect your first financial institution to start building your financial overview.
              Cash Atlas uses Plaid to read your balances and transactions, then works out what you
              actually earned and spent — with transfers between your own accounts taken out.
            </p>
          </div>

          <div className="grid gap-4 text-left sm:grid-cols-3">
            <OnboardingPoint
              icon={Eye}
              title="What gets imported"
              description="Account names, balances and transaction history — typically the last 24 months."
            />
            <OnboardingPoint
              icon={Lock}
              title="Read-only access"
              description="Cash Atlas cannot move money. Your bank credentials go to Plaid, never to us."
            />
            <OnboardingPoint
              icon={RefreshCw}
              title="Stays current"
              description="Your bank notifies Plaid of new transactions, and Cash Atlas syncs them automatically."
            />
          </div>

          <div className="flex justify-center">{connectAction}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function OnboardingPoint({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4">
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
