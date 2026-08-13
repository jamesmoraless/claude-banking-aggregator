/**
 * Centralised server configuration.
 *
 * The ONLY place `Deno.env.get` is called. Business logic asks this module for
 * typed configuration rather than reaching for environment variables directly,
 * so a missing secret produces one clear error naming the variable instead of
 * an `undefined` surfacing three layers deep as a confusing Plaid rejection.
 *
 * Nothing here is ever logged or returned in a response.
 */

export class ConfigurationError extends Error {
  readonly code = 'CONFIGURATION_ERROR';
  readonly missing: string[];

  constructor(missing: string[], context: string) {
    super(
      `${context} is not configured. Missing Edge Function secret${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}. See MANUAL_SETUP.md.`,
    );
    this.name = 'ConfigurationError';
    this.missing = missing;
  }
}

function read(name: string): string | null {
  const value = Deno.env.get(name);
  return value && value.trim().length > 0 ? value.trim() : null;
}

function require(names: string[], context: string): Record<string, string> {
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const name of names) {
    const value = read(name);
    if (value === null) missing.push(name);
    else values[name] = value;
  }

  if (missing.length > 0) throw new ConfigurationError(missing, context);
  return values;
}

// ---------------------------------------------------------------------------
// Supabase — injected automatically by the platform.
// ---------------------------------------------------------------------------

export type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
  anonKey: string;
};

export function getSupabaseConfig(): SupabaseConfig {
  const values = require(
    ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'],
    'Supabase',
  );
  return {
    url: values.SUPABASE_URL!,
    serviceRoleKey: values.SUPABASE_SERVICE_ROLE_KEY!,
    anonKey: values.SUPABASE_ANON_KEY!,
  };
}

// ---------------------------------------------------------------------------
// Plaid
// ---------------------------------------------------------------------------

export type PlaidEnvironment = 'sandbox' | 'production';

export type PlaidConfig = {
  clientId: string;
  secret: string;
  environment: PlaidEnvironment;
  baseUrl: string;
  webhookUrl: string | null;
  redirectUri: string | null;
};

const PLAID_HOSTS: Record<PlaidEnvironment, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

export function getPlaidConfig(): PlaidConfig {
  const values = require(['PLAID_CLIENT_ID', 'PLAID_SECRET', 'PLAID_ENV'], 'Plaid');

  const environment = values.PLAID_ENV!.toLowerCase();
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new ConfigurationError(
      ['PLAID_ENV'],
      `Plaid (PLAID_ENV must be "sandbox" or "production", received "${environment}")`,
    );
  }

  return {
    clientId: values.PLAID_CLIENT_ID!,
    secret: values.PLAID_SECRET!,
    environment,
    baseUrl: PLAID_HOSTS[environment],
    webhookUrl: read('PLAID_WEBHOOK_URL'),
    redirectUri: read('PLAID_REDIRECT_URI'),
  };
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

export type AnthropicConfig = {
  apiKey: string;
  model: string;
  maxTokens: number;
};

export function getAnthropicConfig(): AnthropicConfig {
  const values = require(['ANTHROPIC_API_KEY'], 'Atlas AI');
  return {
    apiKey: values.ANTHROPIC_API_KEY!,
    model: read('ANTHROPIC_MODEL') ?? 'claude-sonnet-5',
    maxTokens: Number(read('ANTHROPIC_MAX_TOKENS') ?? '4096'),
  };
}

/** True when the Chat feature can run. Lets the UI show a config state. */
export function isAnthropicConfigured(): boolean {
  return read('ANTHROPIC_API_KEY') !== null;
}

// ---------------------------------------------------------------------------
// Access token encryption
// ---------------------------------------------------------------------------

export function getEncryptionKeyMaterial(): string {
  const values = require(['ACCESS_TOKEN_ENCRYPTION_KEY'], 'Access token encryption');
  return values.ACCESS_TOKEN_ENCRYPTION_KEY!;
}
