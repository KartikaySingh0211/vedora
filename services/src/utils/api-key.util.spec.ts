import {
  generateApiKey,
  parseApiKey,
  hashApiKey,
  verifyApiKeyHash,
  deriveKeyDigest,
  keyIdToUuid,
  uuidToKeyId,
} from './api-key.util';

describe('ApiKey Utilities', () => {
  it('should generate a valid key matching VDR_<32-hex-key-id>_<base64url-secret>', () => {
    const { key, keyId, uuid, prefix } = generateApiKey();

    expect(key).toMatch(/^VDR_[a-f0-9]{32}_[A-Za-z0-9_-]{32,}$/);
    expect(keyId).toHaveLength(32);
    expect(uuid).toHaveLength(36);
    expect(prefix).toMatch(/^VDR_[a-f0-9]{8}\.\.\.$/);

    const parsed = parseApiKey(key);
    expect(parsed.valid).toBe(true);
    expect(parsed.keyId).toBe(keyId);
    expect(parsed.uuid).toBe(uuid);
  });

  it('should reject invalid key formats immediately before expensive crypto', () => {
    expect(parseApiKey('').valid).toBe(false);
    expect(parseApiKey('invalid_key').valid).toBe(false);
    expect(parseApiKey('VDR_short_secret').valid).toBe(false);
    expect(
      parseApiKey('VDR_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ_secret').valid,
    ).toBe(false); // Non-hex keyId
  });

  it('should convert bidirectionally between 32-hex keyId and UUID', () => {
    const hex = '4f7e2d1a9b8c3e4f5a6b7c8d9e0f1a2b';
    const uuid = keyIdToUuid(hex);
    expect(uuid).toBe('4f7e2d1a-9b8c-3e4f-5a6b-7c8d9e0f1a2b');
    expect(uuidToKeyId(uuid)).toBe(hex);
  });

  it('should hash with Argon2id and verify valid key, and reject invalid key', async () => {
    const { key } = generateApiKey();
    const hash = await hashApiKey(key);

    expect(hash).toContain('$argon2id$');
    const isValid = await verifyApiKeyHash(hash, key);
    expect(isValid).toBe(true);

    const isInvalid = await verifyApiKeyHash(hash, key + 'tampered');
    expect(isInvalid).toBe(false);
  });

  it('should derive consistent HMAC-SHA256 digests with dedicated secret', () => {
    const secret = 'super_secret_hmac_key';
    const key = 'VDR_0123456789abcdef0123456789abcdef_testSecret';

    const digest1 = deriveKeyDigest(key, secret);
    const digest2 = deriveKeyDigest(key, secret);
    const digestDifferentSecret = deriveKeyDigest(key, 'different_secret');

    expect(digest1).toBe(digest2);
    expect(digest1).not.toBe(digestDifferentSecret);
    expect(digest1).toHaveLength(64);
  });
});
