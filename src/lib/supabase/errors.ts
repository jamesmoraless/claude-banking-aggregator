import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Normalises Supabase failures into one error shape.
 *
 * PostgREST error details can echo query fragments and column names. Those are
 * useful in a log and inappropriate in a UI, so the raw detail is kept on the
 * error object for logging while `describeError` in components/common/states
 * decides what a person actually sees.
 */
export class DataAccessError extends Error {
  readonly code: string;
  readonly detail: string | undefined;
  readonly operation: string;

  constructor(operation: string, error: PostgrestError | Error | null) {
    const code = (error as PostgrestError | null)?.code ?? 'UNKNOWN';
    super(`${operation} failed (${code})`);
    this.name = 'DataAccessError';
    this.code = code;
    this.detail = (error as PostgrestError | null)?.message;
    this.operation = operation;
  }
}

/**
 * Unwraps a Supabase response, throwing on error.
 *
 * Every data function goes through this. A silently swallowed error in a
 * finance app renders as a plausible-looking zero, which is worse than an
 * outage: the user believes it.
 */
export function unwrap<T>(
  operation: string,
  response: { data: T | null; error: PostgrestError | null },
): T {
  if (response.error) throw new DataAccessError(operation, response.error);
  if (response.data === null) throw new DataAccessError(operation, null);
  return response.data;
}

/** Unwraps a response whose data may legitimately be absent. */
export function unwrapMaybe<T>(
  operation: string,
  response: { data: T | null; error: PostgrestError | null },
): T | null {
  if (response.error) throw new DataAccessError(operation, response.error);
  return response.data;
}

/**
 * Unwraps an RPC that returns SETOF but is expected to yield a single row.
 * An empty result is a legitimate "no data yet", not an error.
 */
export function unwrapSingleRow<T>(
  operation: string,
  response: { data: T[] | null; error: PostgrestError | null },
): T | null {
  const rows = unwrapMaybe(operation, response);
  return rows?.[0] ?? null;
}
