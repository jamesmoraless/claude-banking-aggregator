import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { envResult } from '@/config/env';
import type { Database } from '@/types/database.types';

/**
 * The single Supabase browser client.
 *
 * There is exactly one of these, and it is the real client from the first
 * commit — there is no mock, no adapter to swap and no fixture mode. When
 * configuration is missing the client is simply absent, and callers surface a
 * configuration state rather than fabricating data.
 */

export type AtlasSupabaseClient = SupabaseClient<Database, 'public'>;

function createBrowserClient(): AtlasSupabaseClient | null {
  if (!envResult.ok) return null;

  return createClient<Database, 'public'>(
    envResult.env.supabaseUrl,
    envResult.env.supabasePublishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: 'cash-atlas-auth',
      },
      global: {
        headers: { 'x-application-name': 'cash-atlas-web' },
      },
      db: { schema: 'public' },
    },
  );
}

export const supabase: AtlasSupabaseClient | null = createBrowserClient();

/** Thrown when a data path runs without valid Supabase configuration. */
export class ConfigurationError extends Error {
  readonly code = 'SUPABASE_NOT_CONFIGURED';

  constructor() {
    super(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then restart the dev server. See MANUAL_SETUP.md.',
    );
    this.name = 'ConfigurationError';
  }
}

/**
 * Every query and mutation goes through this. It guarantees that a data path
 * either talks to the real backend or fails loudly — never quietly returns
 * placeholder numbers.
 */
export function requireSupabase(): AtlasSupabaseClient {
  if (!supabase) throw new ConfigurationError();
  return supabase;
}
