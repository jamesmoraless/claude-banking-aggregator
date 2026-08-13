import { AlertCircle, Link2 } from 'lucide-react';
import * as React from 'react';
import { usePlaidLink } from 'react-plaid-link';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';

import { EdgeFunctionError } from './api';
import { useCreateUpdateLinkToken, useRefreshConnections } from './hooks';

/**
 * Reconnects an Item through Plaid Link's update mode.
 *
 * Update mode re-authenticates an EXISTING Item rather than creating a new one,
 * so account ids, transaction history and the sync cursor all survive. Creating
 * a fresh Item instead would duplicate every account and re-import history the
 * user already has.
 *
 * Once the user is back through their bank, a refresh runs immediately — the
 * whole point of reconnecting is that the data was stale.
 */
export function ReconnectButton({ plaidItemId }: { plaidItemId: string }) {
  const [linkToken, setLinkToken] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const createToken = useCreateUpdateLinkToken();
  const refresh = useRefreshConnections();

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: () => {
      setLinkToken(null);
      refresh.mutate(plaidItemId);
    },
    onExit: (exitError) => {
      setLinkToken(null);
      if (exitError) {
        logger.warn('Plaid update mode exited with an error', { errorCode: exitError.error_code });
        setError(exitError.display_message ?? 'Reconnecting failed. Please try again.');
      }
    },
  });

  const openLink = open as () => void;

  React.useEffect(() => {
    if (linkToken && ready) openLink();
  }, [linkToken, ready, openLink]);

  const isBusy = createToken.isPending || refresh.isPending || Boolean(linkToken);

  return (
    <>
      <Button
        size="sm"
        loading={isBusy}
        loadingText={refresh.isPending ? 'Syncing…' : 'Opening your bank…'}
        onClick={() => {
          setError(null);
          createToken.mutate(plaidItemId, {
            onSuccess: (result) => setLinkToken(result.linkToken),
            onError: (tokenError) => {
              setError(
                tokenError instanceof EdgeFunctionError
                  ? tokenError.message
                  : 'Could not start reconnection. Please try again.',
              );
            },
          });
        }}
      >
        <Link2 aria-hidden="true" />
        Reconnect
      </Button>

      {error ? (
        <Alert variant="destructive" className="mt-2 w-full">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
