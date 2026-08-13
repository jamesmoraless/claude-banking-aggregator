import { getPlaidConfig, type PlaidConfig } from '../config/env.ts';
import { AppError } from '../errors/app-error.ts';
import type { Logger } from '../logging/logger.ts';
import type {
  AccountsGetResponse,
  ExchangeResponse,
  InstitutionGetResponse,
  ItemGetResponse,
  LinkTokenResponse,
  PlaidApiErrorBody,
  TransactionsSyncResponse,
  WebhookVerificationKeyResponse,
} from './types.ts';

/**
 * Plaid API client.
 *
 * A thin typed wrapper over Plaid's REST API rather than the Node SDK: the SDK
 * is heavy and Node-oriented, and every call we make is a single JSON POST.
 * All Plaid access goes through this class, so credentials, retry policy and
 * error translation exist in exactly one place.
 *
 * Credentials are attached here and nowhere else. No caller ever holds
 * `PLAID_SECRET`, and no caller constructs a Plaid URL.
 */

const REQUEST_TIMEOUT_MS = 25_000;
const MAX_ATTEMPTS = 3;

/** Plaid error codes meaning the user must re-authenticate through Link. */
const REAUTH_ERROR_CODES = new Set([
  'ITEM_LOGIN_REQUIRED',
  'ITEM_LOCKED',
  'USER_PERMISSION_REVOKED',
  'USER_ACCOUNT_REVOKED',
  'PENDING_EXPIRATION',
  'PENDING_DISCONNECT',
]);

export class PlaidApiError extends AppError {
  readonly plaidErrorCode: string;
  readonly plaidErrorType: string;
  readonly requiresReauth: boolean;

  constructor(body: PlaidApiErrorBody, status: number) {
    const requiresReauth = REAUTH_ERROR_CODES.has(body.error_code);

    super(
      requiresReauth
        ? 'PLAID_ITEM_LOGIN_REQUIRED'
        : status === 429
          ? 'PLAID_RATE_LIMIT'
          : status >= 500
            ? 'PLAID_UNAVAILABLE'
            : 'PLAID_ERROR',
      // Plaid's display_message is written for end users; its error_message is
      // written for developers and can contain request context.
      body.display_message ??
        (requiresReauth
          ? 'Your bank needs you to sign in again before data can update.'
          : 'Your bank could not be reached right now. Please try again.'),
      `${body.error_type}/${body.error_code}: ${body.error_message}`,
    );

    this.name = 'PlaidApiError';
    this.plaidErrorCode = body.error_code;
    this.plaidErrorType = body.error_type;
    this.requiresReauth = requiresReauth;
  }
}

export class PlaidClient {
  private readonly config: PlaidConfig;
  private readonly logger: Logger | undefined;

  constructor(logger?: Logger, config?: PlaidConfig) {
    this.config = config ?? getPlaidConfig();
    this.logger = logger;
  }

  get environment(): string {
    return this.config.environment;
  }

  get webhookUrl(): string | null {
    return this.config.webhookUrl;
  }

  // -------------------------------------------------------------------------
  // Link
  // -------------------------------------------------------------------------

  createLinkToken(userId: string): Promise<LinkTokenResponse> {
    return this.post<LinkTokenResponse>('/link/token/create', {
      client_name: 'Cash Atlas',
      language: 'en',
      country_codes: ['CA', 'US'],
      // The Supabase user id is opaque and stable — exactly what Plaid wants
      // here, and it carries no personal information.
      user: { client_user_id: userId },
      products: ['transactions'],
      transactions: { days_requested: 730 },
      ...(this.config.webhookUrl ? { webhook: this.config.webhookUrl } : {}),
      ...(this.config.redirectUri ? { redirect_uri: this.config.redirectUri } : {}),
    });
  }

  /**
   * Update-mode token: re-authenticates an EXISTING Item.
   *
   * Sending `access_token` without `products` is what puts Link into update
   * mode. Creating a new Item instead would duplicate every account and
   * re-import history the user already has.
   */
  createUpdateLinkToken(userId: string, accessToken: string): Promise<LinkTokenResponse> {
    return this.post<LinkTokenResponse>('/link/token/create', {
      client_name: 'Cash Atlas',
      language: 'en',
      country_codes: ['CA', 'US'],
      user: { client_user_id: userId },
      access_token: accessToken,
      ...(this.config.webhookUrl ? { webhook: this.config.webhookUrl } : {}),
      ...(this.config.redirectUri ? { redirect_uri: this.config.redirectUri } : {}),
    });
  }

  exchangePublicToken(publicToken: string): Promise<ExchangeResponse> {
    return this.post<ExchangeResponse>('/item/public_token/exchange', {
      public_token: publicToken,
    });
  }

  // -------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------

  getAccounts(accessToken: string): Promise<AccountsGetResponse> {
    return this.post<AccountsGetResponse>('/accounts/get', { access_token: accessToken });
  }

  /**
   * One page of incremental transaction updates.
   *
   * A null cursor requests the initial page. `include_original_description`
   * gives us the raw bank description, which is materially better than the
   * cleaned name for transfer matching.
   */
  syncTransactions(
    accessToken: string,
    cursor: string | null,
    count = 500,
  ): Promise<TransactionsSyncResponse> {
    return this.post<TransactionsSyncResponse>('/transactions/sync', {
      access_token: accessToken,
      ...(cursor ? { cursor } : {}),
      count,
      options: {
        include_original_description: true,
        include_personal_finance_category: true,
      },
    });
  }

  getItem(accessToken: string): Promise<ItemGetResponse> {
    return this.post<ItemGetResponse>('/item/get', { access_token: accessToken });
  }

  getInstitution(institutionId: string): Promise<InstitutionGetResponse> {
    return this.post<InstitutionGetResponse>('/institutions/get_by_id', {
      institution_id: institutionId,
      country_codes: ['CA', 'US'],
      options: { include_optional_metadata: true },
    });
  }

  removeItem(accessToken: string): Promise<{ request_id: string }> {
    return this.post<{ request_id: string }>('/item/remove', { access_token: accessToken });
  }

  getWebhookVerificationKey(keyId: string): Promise<WebhookVerificationKeyResponse> {
    return this.post<WebhookVerificationKeyResponse>('/webhook_verification_key/get', {
      key_id: keyId,
    });
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.attempt<T>(path, body);
      } catch (error) {
        lastError = error;

        // Only transient failures are worth retrying. Retrying a rejected
        // token or a revoked Item just delays the real answer.
        const retriable =
          error instanceof PlaidApiError
            ? error.code === 'PLAID_UNAVAILABLE' || error.code === 'PLAID_RATE_LIMIT'
            : error instanceof AppError && error.code === 'TIMEOUT';

        if (!retriable || attempt === MAX_ATTEMPTS) throw error;

        // Exponential backoff with jitter, so many Items refreshing at once do
        // not retry in lockstep.
        const delay = Math.min(2 ** attempt * 250, 4000) + Math.random() * 250;
        this.logger?.warn('Retrying Plaid request', { path, attempt, delayMs: Math.round(delay) });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private async attempt<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PLAID-CLIENT-ID': this.config.clientId,
          'PLAID-SECRET': this.config.secret,
          'Plaid-Version': '2020-09-14',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();

      if (!response.ok) {
        let parsed: PlaidApiErrorBody | null = null;
        try {
          parsed = JSON.parse(text) as PlaidApiErrorBody;
        } catch {
          parsed = null;
        }

        if (parsed?.error_code) throw new PlaidApiError(parsed, response.status);

        throw new AppError(
          response.status >= 500 ? 'PLAID_UNAVAILABLE' : 'PLAID_ERROR',
          'Your bank could not be reached right now. Please try again.',
          `${path} returned ${response.status}`,
        );
      }

      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError('TIMEOUT', 'Your bank took too long to respond.', `${path} timed out`);
      }
      throw new AppError(
        'PLAID_UNAVAILABLE',
        'Your bank could not be reached right now. Please try again.',
        `${path}: ${String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
