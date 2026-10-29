import * as crypto from 'crypto';
import * as argon2 from 'argon2';

export const API_KEY_PREFIX = 'VDR';
export const API_KEY_REGEX = /^VDR_([a-f0-9]{32})_([A-Za-z0-9_-]{32,})$/;

export interface GeneratedApiKey {
  key: string;
  keyId: string;
  uuid: string;
  prefix: string;
}

export interface ParsedApiKey {
  valid: boolean;
  keyId?: string;
  uuid?: string;
  secret?: string;
}

/**
 * Generate cryptographically secure API key:
 * Format: VDR_<32-character-hex-key-id>_<base64url-secret>
 */
export function generateApiKey(): GeneratedApiKey {
  const keyId = crypto.randomBytes(16).toString('hex'); // 32 hex chars
  const secret = crypto.randomBytes(32).toString('base64url'); // 43 base64url chars
  const key = `${API_KEY_PREFIX}_${keyId}_${secret}`;
  const uuid = keyIdToUuid(keyId);
  const prefix = `${API_KEY_PREFIX}_${keyId.slice(0, 8)}...`;

  return { key, keyId, uuid, prefix };
}

/**
 * Validates and extracts keyId and secret from the plaintext key
 */
export function parseApiKey(key: string): ParsedApiKey {
  if (!key || typeof key !== 'string') {
    return { valid: false };
  }

  const match = API_KEY_REGEX.exec(key.trim());
  if (!match) {
    return { valid: false };
  }

  const [, keyId, secret] = match;
  return {
    valid: true,
    keyId,
    uuid: keyIdToUuid(keyId),
    secret,
  };
}

/**
 * Converts 32-character hex keyId into standard UUID format (8-4-4-4-12)
 */
export function keyIdToUuid(keyId: string): string {
  if (keyId.length !== 32) {
    throw new Error('Key ID must be 32 hex characters');
  }
  return `${keyId.slice(0, 8)}-${keyId.slice(8, 12)}-${keyId.slice(12, 16)}-${keyId.slice(16, 20)}-${keyId.slice(20)}`;
}

/**
 * Converts standard UUID format into 32-character hex keyId
 */
export function uuidToKeyId(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase();
}

/**
 * Compute Argon2id hash of the full plaintext key
 */
export async function hashApiKey(key: string): Promise<string> {
  return argon2.hash(key, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16, // 64 MB
    timeCost: 3,
    parallelism: 1,
  });
}

/**
 * Verify plaintext key against stored Argon2id hash
 */
export async function verifyApiKeyHash(
  hash: string,
  key: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, key);
  } catch {
    return false;
  }
}

/**
 * Derive HMAC-SHA256 digest for cache indexing
 */
export function deriveKeyDigest(key: string, hmacSecret: string): string {
  return crypto.createHmac('sha256', hmacSecret).update(key).digest('hex');
}

/**
 * Timing-safe comparison of two hex-encoded cryptographic digests
 * Validates equal buffer length before calling crypto.timingSafeEqual
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
