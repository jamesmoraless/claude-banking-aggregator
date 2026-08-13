import { AlertTriangle, RotateCcw } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { logger } from '@/lib/logger';

type Props = {
  children: React.ReactNode;
  /** Name of the region this boundary protects, used in logs and copy. */
  region: string;
  fallback?: (props: { reset: () => void; error: Error }) => React.ReactNode;
};

type State = { error: Error | null };

/**
 * Contains a render failure to one region.
 *
 * Boundaries are placed per route and around each independent dashboard card,
 * so a chart that fails to render does not take the balances down with it —
 * the same partial-failure principle the sync layer follows.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logger.error('Render failure', {
      region: this.props.region,
      error: error.message,
      componentStack: info.componentStack?.slice(0, 600),
    });
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback({ reset: this.reset, error });
    }

    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-destructive-subtle text-destructive">
            <AlertTriangle className="size-5" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium">Something went wrong displaying {this.props.region}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              The rest of Cash Atlas is unaffected. Try again, or reload the page if it keeps happening.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={this.reset}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }
}
