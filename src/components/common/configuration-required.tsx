import { FileText, Settings2 } from 'lucide-react';

import { AtlasLogo } from '@/components/common/logo';
import { Card, CardContent } from '@/components/ui/card';
import type { EnvIssue } from '@/config/env';

/**
 * Shown instead of the application when required frontend configuration is
 * missing.
 *
 * This is a deliberate state, not an error page. Cash Atlas has no offline or
 * demo mode: without Supabase credentials there is nothing truthful to display,
 * so it says exactly which variables are missing and where to fix them rather
 * than rendering an empty dashboard that looks like a broken account.
 */
export function ConfigurationRequired({ issues }: { issues: EnvIssue[] }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-xl">
        <CardContent className="space-y-6 p-8">
          <div className="space-y-3">
            <AtlasLogo className="h-8" />
            <div className="space-y-1.5">
              <h1 className="text-xl font-semibold tracking-tight">Cash Atlas isn&apos;t connected yet</h1>
              <p className="text-sm text-muted-foreground">
                Supabase configuration is missing, so there is no financial data to show. Complete the
                setup steps and restart the dev server.
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Settings2 className="size-4 text-muted-foreground" aria-hidden="true" />
              Environment variables
            </p>
            <ul className="space-y-1.5">
              {issues.map((issue) => (
                <li key={issue.key} className="text-sm">
                  <code className="rounded bg-card px-1.5 py-0.5 font-mono text-xs text-destructive">
                    {issue.key}
                  </code>{' '}
                  <span className="text-muted-foreground">{issue.message}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
              How to fix this
            </p>
            <ol className="list-inside list-decimal space-y-2 text-muted-foreground">
              <li>
                Copy the template: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">cp .env.example .env.local</code>
              </li>
              <li>
                Fill in <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">VITE_SUPABASE_URL</code> and{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">VITE_SUPABASE_PUBLISHABLE_KEY</code>{' '}
                from your Supabase project, or from the output of{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">pnpm db:start</code>.
              </li>
              <li>
                Restart the dev server. Vite only reads environment variables at startup.
              </li>
            </ol>
            <p className="text-muted-foreground">
              Full instructions, including Plaid and Anthropic setup, are in{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">MANUAL_SETUP.md</code>.
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
