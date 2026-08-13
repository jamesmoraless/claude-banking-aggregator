import { z } from 'zod';

import { AppError } from '../errors/app-error.ts';

/**
 * Request validation at the external boundary.
 *
 * Every Edge Function validates its body here before a controller sees it, so
 * business logic can assume well-formed input. Note what is absent: no schema
 * accepts a `userId`. The authenticated user comes from the verified JWT, and
 * there is deliberately nowhere for a client to supply one.
 */

export const uuidSchema = z.string().uuid('must be a valid id');

export const exchangePublicTokenSchema = z.object({
  // Plaid public tokens look like public-production-<uuid>. Validated loosely:
  // the authoritative check is Plaid rejecting it.
  publicToken: z.string().min(10, 'is required').max(200),
  institutionId: z.string().max(100).nullable().optional(),
  institutionName: z.string().max(200).nullable().optional(),
});

export const itemIdSchema = z.object({
  plaidItemId: uuidSchema,
});

export const optionalItemIdSchema = z.object({
  plaidItemId: uuidSchema.optional().nullable(),
});

export const syncAccountsSchema = z.object({
  plaidItemId: uuidSchema.optional().nullable(),
});

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
});

export const chatRequestSchema = z.object({
  // Bounded so a client cannot drive unbounded token spend by replaying a
  // enormous history.
  messages: z.array(chatMessageSchema).min(1).max(40),
});

/**
 * Validates a parsed body, converting Zod issues into one safe message.
 *
 * Field paths are included because they help the developer and reveal nothing
 * sensitive; received values never are.
 */
export function validate<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);

  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'} ${issue.message}`)
      .join('; ');
    throw AppError.invalidRequest(`The request was not valid: ${detail}`);
  }

  return result.data;
}
