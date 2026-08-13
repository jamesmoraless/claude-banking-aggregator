import { z } from 'zod';

/**
 * Centralised frontend environment validation.
 *
 * Only VITE_-prefixed variables exist here, and every one of them is public by
 * definition: Vite inlines them into the JavaScript bundle. Server secrets
 * (PLAID_SECRET, ANTHROPIC_API_KEY, ACCESS_TOKEN_ENCRYPTION_KEY, the Supabase
 * service-role key) are Edge Function secrets and must never appear in this
 * file or anywhere under src/.
 *
 * Validation deliberately does NOT throw at module load. A hard throw during
 * import produces a blank page, which tells the developer nothing. Instead the
 * result is a discriminated union that the app renders as an actionable
 * configuration screen pointing at MANUAL_SETUP.md.
 */

const envSchema = z.object({
  VITE_SUPABASE_URL: z
    .string()
    .min(1, 'is required')
    .url('must be a URL, e.g. https://your-project.supabase.co')
    .refine((value) => !value.endsWith('/'), 'must not have a trailing slash'),
  VITE_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, 'is required')
    .refine(
      (value) => !value.startsWith('sb_secret_') && !value.startsWith('service_role'),
      'looks like a SECRET key. Only the publishable/anon key may be used in the browser.',
    ),
  VITE_APP_URL: z.string().url().optional().or(z.literal('')),
});

export type AppEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  appUrl: string;
  isProduction: boolean;
};

export type EnvIssue = { key: string; message: string };

export type EnvResult =
  | { ok: true; env: AppEnv }
  | { ok: false; issues: EnvIssue[] };

function readEnv(source: Record<string, unknown>): EnvResult {
  const parsed = envSchema.safeParse({
    VITE_SUPABASE_URL: source.VITE_SUPABASE_URL ?? '',
    VITE_SUPABASE_PUBLISHABLE_KEY: source.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
    VITE_APP_URL: source.VITE_APP_URL ?? '',
  });

  if (!parsed.success) {
    const issues: EnvIssue[] = parsed.error.issues.map((issue) => ({
      key: String(issue.path[0] ?? 'unknown'),
      message: issue.message,
    }));
    return { ok: false, issues };
  }

  return {
    ok: true,
    env: {
      supabaseUrl: parsed.data.VITE_SUPABASE_URL,
      supabasePublishableKey: parsed.data.VITE_SUPABASE_PUBLISHABLE_KEY,
      appUrl:
        parsed.data.VITE_APP_URL && parsed.data.VITE_APP_URL.length > 0
          ? parsed.data.VITE_APP_URL
          : typeof window !== 'undefined'
            ? window.location.origin
            : '',
      isProduction: Boolean(source.PROD),
    },
  };
}

/** Exported for tests; the app uses `envResult`. */
export const parseEnv = readEnv;

export const envResult: EnvResult = readEnv(import.meta.env);

export const isConfigured = envResult.ok;

/**
 * Returns validated configuration or throws. Callers that can render a
 * configuration state should branch on `envResult.ok` instead.
 */
export function requireEnv(): AppEnv {
  if (!envResult.ok) {
    const detail = envResult.issues.map((issue) => `${issue.key} ${issue.message}`).join('; ');
    throw new Error(`Cash Atlas is not configured: ${detail}. See MANUAL_SETUP.md.`);
  }
  return envResult.env;
}
