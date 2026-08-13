import { getEncryptionKeyMaterial } from '../config/env.ts';
import { AppError } from '../errors/app-error.ts';

/**
 * Plaid access token encryption.
 *
 * AES-256-GCM via WebCrypto. GCM is authenticated, so a tampered ciphertext
 * fails to decrypt rather than silently producing garbage that we would then
 * send to Plaid.
 *
 * Defence in depth: the tokens already live in a table with RLS enabled and no
 * policies, unreachable from the browser. Encrypting them additionally means a
 * database dump — a backup file, a compromised read replica — does not hand
 * over live bank access, because the key lives only in Edge Function secrets.
 *
 * A fresh random IV is generated per encryption. Reusing an IV under GCM is
 * catastrophic, so it is never derived from anything.
 */

const ALGORITHM = 'AES-GCM';
const IV_BYTES = 12; // 96 bits, the value GCM is specified for.
const KEY_BYTES = 32; // AES-256.

/** Current key version, stored alongside the ciphertext to allow rotation. */
export const CURRENT_KEY_VERSION = 1;

export type EncryptedToken = {
  ciphertext: string;
  iv: string;
  keyVersion: number;
};

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const material = getEncryptionKeyMaterial();
  let raw: Uint8Array<ArrayBuffer>;

  try {
    raw = base64ToBytes(material);
  } catch {
    throw new AppError(
      'CONFIGURATION_ERROR',
      'ACCESS_TOKEN_ENCRYPTION_KEY is not valid base64. Generate one with: openssl rand -base64 32',
    );
  }

  if (raw.length !== KEY_BYTES) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      `ACCESS_TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${raw.length}. Generate one with: openssl rand -base64 32`,
    );
  }

  cachedKey = await crypto.subtle.importKey('raw', raw, ALGORITHM, false, ['encrypt', 'decrypt']);
  return cachedKey;
}

export async function encryptAccessToken(accessToken: string): Promise<EncryptedToken> {
  if (accessToken.trim().length === 0) {
    throw AppError.internal('Refusing to encrypt an empty access token');
  }

  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    new TextEncoder().encode(accessToken),
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export async function decryptAccessToken(stored: EncryptedToken): Promise<string> {
  if (stored.keyVersion !== CURRENT_KEY_VERSION) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      'This connection was encrypted with a different key version. Reconnect the institution.',
      `keyVersion=${stored.keyVersion}`,
    );
  }

  const key = await getKey();

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: base64ToBytes(stored.iv) },
      key,
      base64ToBytes(stored.ciphertext),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // Authentication failure: wrong key, or the ciphertext was altered. Both
    // mean the token is unusable, and neither should leak detail.
    throw new AppError(
      'CONFIGURATION_ERROR',
      'This connection could not be decrypted. If ACCESS_TOKEN_ENCRYPTION_KEY changed, the institution must be reconnected.',
    );
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// Backed by a concrete ArrayBuffer: WebCrypto's BufferSource does not accept
// a Uint8Array over a possibly-shared buffer.
function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
