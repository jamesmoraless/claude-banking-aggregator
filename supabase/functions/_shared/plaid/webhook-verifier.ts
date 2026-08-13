import { AppError } from '../errors/app-error.ts';
import type { Logger } from '../logging/logger.ts';
import type { PlaidClient } from './client.ts';

/**
 * Plaid webhook authenticity verification.
 *
 * Implements Plaid's documented scheme. The webhook endpoint is the one
 * function without `verify_jwt` — Plaid cannot present a Supabase JWT — so this
 * IS its authentication. Without it, anyone could POST a fabricated
 * `SYNC_UPDATES_AVAILABLE` and make us hammer Plaid on demand.
 *
 * Four things are checked, and all four must hold:
 *
 *   1. The `Plaid-Verification` header is an ES256 JWT.
 *   2. Its signature verifies against the public key Plaid publishes for the
 *      `kid` in its header.
 *   3. Its `iat` is recent, so a captured request cannot be replayed later.
 *   4. The SHA-256 of the RAW body matches the `request_body_sha256` claim, so
 *      the payload cannot be swapped for a validly-signed header.
 *
 * Point 4 is why the raw body text must be passed in rather than a re-serialised
 * object: `JSON.stringify(JSON.parse(body))` is not byte-identical to `body`,
 * and the hash would not match.
 */

const MAX_AGE_SECONDS = 5 * 60;

type JwtHeader = { alg: string; kid: string; typ?: string };
type JwtClaims = { iat: number; request_body_sha256: string };

const keyCache = new Map<string, CryptoKey>();

export async function verifyPlaidWebhook(input: {
  verificationHeader: string | null;
  rawBody: string;
  plaid: PlaidClient;
  logger: Logger;
}): Promise<void> {
  if (!input.verificationHeader) {
    throw new AppError('UNAUTHORIZED', 'Missing webhook verification header.');
  }

  const parts = input.verificationHeader.split('.');
  if (parts.length !== 3) {
    throw new AppError('UNAUTHORIZED', 'Malformed webhook verification header.');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  const header = decodeJson<JwtHeader>(encodedHeader, 'header');

  // ES256 only. Accepting `alg` from the token without constraining it is the
  // classic JWT confusion attack — "alg: none" or an HMAC alg verified against
  // a public key would both let a forged token through.
  if (header.alg !== 'ES256') {
    throw new AppError('UNAUTHORIZED', 'Unsupported webhook signature algorithm.');
  }
  if (!header.kid) {
    throw new AppError('UNAUTHORIZED', 'Webhook verification header has no key id.');
  }

  const key = await loadVerificationKey(header.kid, input.plaid);

  const signature = base64UrlToBytes(encodedSignature);
  const signedContent = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);

  const signatureValid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    signature,
    signedContent,
  );

  if (!signatureValid) {
    input.logger.warn('Webhook signature verification failed', { kid: header.kid });
    throw new AppError('UNAUTHORIZED', 'Webhook signature could not be verified.');
  }

  const claims = decodeJson<JwtClaims>(encodedPayload, 'payload');

  const ageSeconds = Math.floor(Date.now() / 1000) - claims.iat;
  if (!Number.isFinite(ageSeconds) || ageSeconds > MAX_AGE_SECONDS || ageSeconds < -60) {
    throw new AppError('UNAUTHORIZED', 'Webhook verification token has expired.');
  }

  const bodyHash = await sha256Hex(input.rawBody);
  if (!timingSafeEqualHex(bodyHash, claims.request_body_sha256)) {
    input.logger.warn('Webhook body hash mismatch');
    throw new AppError('UNAUTHORIZED', 'Webhook body does not match its signature.');
  }
}

/**
 * Fetches and caches Plaid's public verification key.
 *
 * Cached per instance because Plaid rotates keys infrequently and a webhook
 * burst would otherwise fetch the same key repeatedly.
 */
async function loadVerificationKey(keyId: string, plaid: PlaidClient): Promise<CryptoKey> {
  const cached = keyCache.get(keyId);
  if (cached) return cached;

  const response = await plaid.getWebhookVerificationKey(keyId);
  const jwk = response.key;

  if (jwk.expired_at !== null) {
    throw new AppError('UNAUTHORIZED', 'Webhook was signed with an expired key.');
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );

  keyCache.set(keyId, key);
  return key;
}

function decodeJson<T>(segment: string, label: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
  } catch {
    throw new AppError('UNAUTHORIZED', `Webhook verification ${label} could not be decoded.`);
  }
}

// Backed by a concrete ArrayBuffer, which is what WebCrypto's BufferSource
// requires.
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const withPadding = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPadding);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
