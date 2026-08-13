import { requireSupabase } from '@/lib/supabase/client';

/**
 * Plaid connection operations.
 *
 * Every call here goes to a Supabase Edge Function. None of these can be done
 * from the browser: they need PLAID_SECRET and the Item's access token, neither
 * of which ever leaves the server. The browser sends its Supabase JWT and gets
 * back only safe metadata.
 *
 * These functions are wired to their real endpoints from the first commit. If
 * the Edge Functions are not deployed yet, or Plaid credentials are not
 * configured, the call fails with a specific, actionable error rather than
 * falling back to sample data.
 */

export class EdgeFunctionError extends Error {
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'EdgeFunctionError';
    this.code = code;
    this.requestId = requestId;
  }
}

type ErrorEnvelope = {
  error?: { code?: string; message?: string; requestId?: string };
};

/**
 * Invokes an Edge Function and normalises its failure modes.
 *
 * supabase-js reports a non-2xx response as a FunctionsHttpError whose body
 * must be read separately, so the structured error envelope our functions
 * return is extracted here rather than at each call site.
 */
async function invoke<TResponse, TBody extends Record<string, unknown> = Record<string, never>>(
  functionName: string,
  body?: TBody,
): Promise<TResponse> {
  const supabase = requireSupabase();
  // supabase-js types this response loosely; narrowing it here keeps the rest
  // of the function type-safe instead of propagating `any` into error handling.
  const response = (await supabase.functions.invoke<TResponse>(functionName, {
    body: body ?? {},
  })) as { data: TResponse | null; error: Error | null };
  const { data, error } = response;

  if (error) {
    let envelope: ErrorEnvelope | null = null;
    const context = (error as { context?: Response }).context;

    if (context && typeof context.json === 'function') {
      try {
        envelope = (await context.clone().json()) as ErrorEnvelope;
      } catch {
        envelope = null;
      }
    }

    if (envelope?.error) {
      throw new EdgeFunctionError(
        envelope.error.code ?? 'EDGE_FUNCTION_ERROR',
        envelope.error.message ?? 'The request could not be completed.',
        envelope.error.requestId,
      );
    }

    // A 404 here almost always means the function has not been deployed yet,
    // which is a setup problem, not a bank problem. Say which.
    if (context?.status === 404) {
      throw new EdgeFunctionError(
        'EDGE_FUNCTION_NOT_DEPLOYED',
        `The ${functionName} function is not deployed. Run "supabase functions deploy ${functionName}" — see MANUAL_SETUP.md.`,
      );
    }

    throw new EdgeFunctionError('EDGE_FUNCTION_ERROR', error.message);
  }

  if (data === null) {
    throw new EdgeFunctionError('EMPTY_RESPONSE', 'The server returned an empty response.');
  }

  return data;
}

export type CreateLinkTokenResponse = {
  linkToken: string;
  expiration: string;
  requestId: string;
};

export function createLinkToken(): Promise<CreateLinkTokenResponse> {
  return invoke<CreateLinkTokenResponse>('plaid-create-link-token');
}

/** Update-mode token, used to re-authenticate an Item without losing history. */
export function createUpdateLinkToken(plaidItemId: string): Promise<CreateLinkTokenResponse> {
  return invoke<CreateLinkTokenResponse, { plaidItemId: string }>(
    'plaid-create-update-link-token',
    { plaidItemId },
  );
}

export type ExchangePublicTokenResponse = {
  institutionName: string;
  plaidItemId: string;
  accountsAdded: number;
  transactionsAdded: number;
  /** True when the Item already existed and was re-linked rather than duplicated. */
  wasExistingItem: boolean;
};

export function exchangePublicToken(input: {
  publicToken: string;
  institutionId: string | null;
  institutionName: string | null;
}): Promise<ExchangePublicTokenResponse> {
  return invoke<ExchangePublicTokenResponse, Record<string, unknown>>(
    'plaid-exchange-public-token',
    {
      publicToken: input.publicToken,
      institutionId: input.institutionId,
      institutionName: input.institutionName,
    },
  );
}

export type ItemSyncResult = {
  plaidItemId: string;
  institutionName: string;
  status: 'SUCCESS' | 'FAILED';
  accountsUpdated: number;
  transactionsAdded: number;
  transactionsModified: number;
  transactionsRemoved: number;
  errorCode: string | null;
  errorMessage: string | null;
};

export type RefreshResponse = {
  results: ItemSyncResult[];
  /** SUCCESS when every Item synced, PARTIAL when some failed, FAILED when none worked. */
  overallStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
};

/** Refreshes every connected Item, tolerating individual failures. */
export function refreshAllConnections(): Promise<RefreshResponse> {
  return invoke<RefreshResponse>('plaid-refresh');
}

export function refreshConnection(plaidItemId: string): Promise<RefreshResponse> {
  return invoke<RefreshResponse, { plaidItemId: string }>('plaid-refresh', { plaidItemId });
}

export type RemoveItemResponse = {
  plaidItemId: string;
  /** Historical accounts and transactions are retained, not deleted. */
  historyRetained: true;
};

export function removeConnection(plaidItemId: string): Promise<RemoveItemResponse> {
  return invoke<RemoveItemResponse, { plaidItemId: string }>('plaid-remove-item', { plaidItemId });
}
