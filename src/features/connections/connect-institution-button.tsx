import { AlertCircle, Plus } from 'lucide-react';
import * as React from 'react';
import { usePlaidLink } from 'react-plaid-link';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, type ButtonProps } from '@/components/ui/button';
import { logger } from '@/lib/logger';

import { EdgeFunctionError } from './api';
import { useCreateLinkToken, useExchangePublicToken } from './hooks';

/**
 * "Connect institution" — the real Plaid Link flow.
 *
 * The sequence is entirely server-mediated:
 *
 *   click → plaid-create-link-token (Edge Function, holds PLAID_SECRET)
 *         → Plaid Link opens in the browser with a short-lived link_token
 *         → user authenticates with their bank, Plaid returns a public_token
 *         → plaid-exchange-public-token (Edge Function) swaps it for an access
 *           token, stores it encrypted, syncs accounts and starts transaction
 *           sync
 *         → queries invalidate and the real accounts appear
 *
 * The browser never sees an access token, and no step of this is stubbed. Until
 * the Edge Functions are deployed and Plaid credentials are set, the first call
 * fails and the reason is shown — which is the correct behaviour, not a bug.
 */
export function ConnectInstitutionButton({
  variant = 'default',
  size = 'default',
  label = 'Connect institution',
  onConnected,
  className,
}: {
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  label?: string;
  onConnected?: () => void;
  className?: string;
}) {
  const [linkToken, setLinkToken] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const createToken = useCreateLinkToken();
  const exchange = useExchangePublicToken();

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (publicToken, metadata) => {
      setLinkToken(null);
      exchange.mutate(
        {
          publicToken,
          institutionId: metadata.institution?.institution_id ?? null,
          institutionName: metadata.institution?.name ?? null,
        },
        {
          onSuccess: () => onConnected?.(),
          onError: (mutationError) => {
            setError(
              mutationError instanceof EdgeFunctionError
                ? mutationError.message
                : 'We connected to your bank but could not finish setting it up. Try again.',
            );
          },
        },
      );
    },
    onExit: (exitError) => {
      setLinkToken(null);
      // Abandoning Plaid Link is normal and is not an error worth surfacing.
      if (exitError) {
        logger.warn('Plaid Link exited with an error', { errorCode: exitError.error_code });
        setError(
          exitError.display_message ??
            'Your bank could not be connected right now. Please try again.',
        );
      }
    },
  });

  // react-plaid-link types `open` as a bare Function; narrow it so the call is
  // checked rather than treated as an unsafe invocation.
  const openLink = open as () => void;

  // Plaid Link must be opened as soon as it is ready, while the token is fresh.
  React.useEffect(() => {
    if (linkToken && ready) openLink();
  }, [linkToken, ready, openLink]);

  const handleClick = () => {
    setError(null);
    createToken.mutate(undefined, {
      onSuccess: (result) => setLinkToken(result.linkToken),
      onError: (tokenError) => {
        setError(
          tokenError instanceof EdgeFunctionError
            ? tokenError.message
            : 'Could not start the connection process. Please try again.',
        );
      },
    });
  };

  const isBusy = createToken.isPending || exchange.isPending || Boolean(linkToken);

  return (
    <div className={className}>
      <Button
        variant={variant}
        size={size}
        onClick={handleClick}
        loading={isBusy}
        loadingText={exchange.isPending ? 'Setting up your accounts…' : 'Opening your bank…'}
      >
        <Plus aria-hidden="true" />
        {label}
      </Button>

      {error ? (
        <Alert variant="destructive" className="mt-3 text-left">
          <AlertCircle aria-hidden="true" />
          <div>
            <AlertTitle>Couldn&apos;t connect</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
        </Alert>
      ) : null}
    </div>
  );
}
