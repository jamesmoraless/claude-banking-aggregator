import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseConfig } from '../config/env.ts';
import { AppError } from '../errors/app-error.ts';

/**
 * Request authentication.
 *
 * The authenticated user is derived from the JWT the browser presented, and
 * from nothing else. A `user_id` in a request body is never trusted — there is
 * deliberately no code path that reads one.
 *
 * Note that `verify_jwt = true` in config.toml already rejects unauthenticated
 * requests before this runs. This is the second layer: it establishes *which*
 * user, which the platform check does not.
 */

export type AuthenticatedUser = {
  id: string;
  email: string | null;
};

export async function authenticateRequest(request: Request): Promise<AuthenticatedUser> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw AppError.unauthorized();
  }

  const token = header.slice('Bearer '.length).trim();
  if (token.length === 0) throw AppError.unauthorized();

  const config = getSupabaseConfig();

  // The anon key plus the caller's token: getUser then validates the token
  // against GoTrue rather than trusting its contents.
  const client = createClient(config.url, config.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser();

  if (error || !data.user) {
    throw AppError.unauthorized('Your session has expired. Please sign in again.');
  }

  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Asserts the caller is the service role.
 *
 * Used by the scheduled sync, which pg_cron invokes with the service-role key.
 * Without this, any signed-in user could trigger a sync across their own Items
 * on an endpoint intended for the scheduler.
 */
export async function requireServiceRole(request: Request): Promise<void> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();

  const token = header.slice('Bearer '.length).trim();
  const config = getSupabaseConfig();

  // Constant-time comparison: this is a secret equality check.
  if (!timingSafeEqual(token, config.serviceRoleKey)) {
    throw new AppError('FORBIDDEN', 'This endpoint is not available.');
  }

  await Promise.resolve();
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const first = encoder.encode(a);
  const second = encoder.encode(b);

  // Lengths differing is itself informative, but comparing a fixed number of
  // bytes keeps the loop constant for equal-length inputs, which is the case
  // that matters.
  if (first.length !== second.length) return false;

  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first[index]! ^ second[index]!;
  }
  return difference === 0;
}

/**
 * A client that acts AS the calling user.
 *
 * Row Level Security applies and `auth.uid()` resolves, which the reporting
 * RPCs depend on — they are SECURITY INVOKER and scope themselves by
 * `auth.uid()`. Running them on the service-role client would make `auth.uid()`
 * null, silently returning every user's rows.
 *
 * Every read performed on the assistant's behalf goes through this client, so
 * the database itself enforces the boundary rather than the tool layer
 * remembering to.
 */
export function createUserScopedClient(request: Request): SupabaseClient {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();

  const config = getSupabaseConfig();

  return createClient(config.url, config.anonKey, {
    global: { headers: { Authorization: header } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * The privileged client used by all server-side data access.
 *
 * Bypasses RLS, so every repository built on it must scope by user_id
 * explicitly. That user_id always comes from `authenticateRequest`.
 */
export function createAdminClient(): SupabaseClient {
  const config = getSupabaseConfig();
  return createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'cash-atlas-edge' } },
  });
}
