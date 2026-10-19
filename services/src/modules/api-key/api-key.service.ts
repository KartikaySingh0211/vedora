import {
  Injectable,
  Inject,
  NotFoundException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and, desc } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { DrizzleDb } from '../../database/database.module';
import { api_key } from '../../database/schema';
import { ApiKeyCacheService } from './api-key-cache.service';
import { ApiKeyActivityService } from './api-key-activity.service';
import {
  generateApiKey,
  parseApiKey,
  hashApiKey,
  verifyApiKeyHash,
  deriveKeyDigest,
  uuidToKeyId,
} from '../../utils/api-key.util';

export interface ApiKeyVerificationResult {
  userId: string;
  keyId: string;
  uuid: string;
}

export interface ApiKeyResponseDto {
  id: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface CreatedApiKeyResponseDto {
  id: string;
  key: string;
  prefix: string;
  createdAt: Date;
}

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);
  private readonly hmacSecret: string;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly configService: ConfigService,
    private readonly cacheService: ApiKeyCacheService,
    private readonly activityService: ApiKeyActivityService,
  ) {
    this.hmacSecret = this.configService.get<string>(
      'apiKeyDigestSecret',
      'vedora_default_digest_secret',
    );
  }

  /**
   * Create a new API key for the authenticated user
   */
  async createApiKey(userId: string): Promise<CreatedApiKeyResponseDto> {
    if (!userId) {
      throw new UnauthorizedException('User ID is required');
    }

    const { key, keyId, uuid, prefix } = generateApiKey();
    const hashedKey = await hashApiKey(key);
    const now = new Date();

    await this.db.insert(api_key).values({
      id: uuid,
      user_id: userId,
      prefix,
      value: hashedKey,
      created_at: now,
    });

    // Populate initial caches with HMAC digest for fast verification
    const digest = deriveKeyDigest(key, this.hmacSecret);
    const cachedRecord = {
      userId,
      digest,
      revoked: false,
      cachedAt: Date.now(),
    };

    this.cacheService.setInLru(keyId, cachedRecord);
    await this.cacheService.setInRedis(keyId, cachedRecord);

    return {
      id: uuid,
      key,
      prefix,
      createdAt: now,
    };
  }

  /**
   * List all API keys for the authenticated user
   */
  async listApiKeys(userId: string): Promise<ApiKeyResponseDto[]> {
    if (!userId) {
      throw new UnauthorizedException('User ID is required');
    }

    const records = await this.db
      .select({
        id: api_key.id,
        prefix: api_key.prefix,
        createdAt: api_key.created_at,
        lastUsedAt: api_key.last_used_at,
        revokedAt: api_key.revoked_at,
      })
      .from(api_key)
      .where(eq(api_key.user_id, userId))
      .orderBy(desc(api_key.created_at));

    return records;
  }

  /**
   * Revoke an API key and promptly invalidate all cache entries
   */
  async revokeApiKey(
    userId: string,
    keyIdOrUuid: string,
  ): Promise<{ success: boolean; id: string }> {
    const uuid = keyIdOrUuid.includes('-')
      ? keyIdOrUuid
      : this.safeKeyIdToUuid(keyIdOrUuid);

    // Fetch key and verify ownership
    const existing = await this.db
      .select()
      .from(api_key)
      .where(and(eq(api_key.id, uuid), eq(api_key.user_id, userId)))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException(
        'API key not found or does not belong to you',
      );
    }

    const keyRecord = existing[0];
    if (keyRecord.revoked_at) {
      // Already revoked
      return { success: true, id: uuid };
    }

    // Invalidate caches FIRST to prevent concurrent read rehydration
    const hexKeyId = uuidToKeyId(uuid);
    await this.cacheService.invalidateAll(hexKeyId);

    // Update database
    await this.db
      .update(api_key)
      .set({ revoked_at: new Date() })
      .where(and(eq(api_key.id, uuid), eq(api_key.user_id, userId)));

    // Re-invalidate caches after DB write to prevent race conditions
    await this.cacheService.invalidateAll(hexKeyId);

    return { success: true, id: uuid };
  }

  /**
   * Regenerate an API key: revoke old key and issue new one
   */
  async regenerateApiKey(
    userId: string,
    keyIdOrUuid: string,
  ): Promise<CreatedApiKeyResponseDto> {
    await this.revokeApiKey(userId, keyIdOrUuid);
    return this.createApiKey(userId);
  }

  /**
   * 3-Level API Key verification:
   * Level 1: LRU cache
   * Level 2: Redis
   * Level 3: PostgreSQL + Argon2id
   */
  async verifyApiKey(
    plaintextKey: string,
  ): Promise<ApiKeyVerificationResult | null> {
    const parsed = parseApiKey(plaintextKey);
    if (!parsed.valid || !parsed.keyId || !parsed.uuid) {
      return null;
    }

    const { keyId, uuid } = parsed;
    const computedDigest = deriveKeyDigest(plaintextKey, this.hmacSecret);

    // --- LEVEL 1: Local LRU Cache ---
    const lruRecord = this.cacheService.getFromLru(keyId);
    if (lruRecord) {
      if (lruRecord.revoked) {
        return null;
      }
      if (lruRecord.digest === computedDigest) {
        void this.activityService.recordActivity(keyId, uuid);
        return { userId: lruRecord.userId, keyId, uuid };
      }
    }

    // --- LEVEL 2: Distributed Redis Cache ---
    const redisRecord = await this.cacheService.getFromRedis(keyId);
    if (redisRecord) {
      if (redisRecord.revoked) {
        this.cacheService.setInLru(keyId, redisRecord);
        return null;
      }
      if (redisRecord.digest === computedDigest) {
        // Rehydrate LRU cache
        this.cacheService.setInLru(keyId, {
          ...redisRecord,
          cachedAt: Date.now(),
        });
        void this.activityService.recordActivity(keyId, uuid);
        return { userId: redisRecord.userId, keyId, uuid };
      }
    }

    // --- LEVEL 3: Neon PostgreSQL ---
    const records = await this.db
      .select()
      .from(api_key)
      .where(eq(api_key.id, uuid))
      .limit(1);

    if (records.length === 0) {
      return null;
    }

    const dbRecord = records[0];

    // Reject revoked keys
    if (dbRecord.revoked_at) {
      // Cache revoked state to avoid future DB hits
      const revokedRecord = {
        userId: dbRecord.user_id,
        digest: computedDigest,
        revoked: true,
        cachedAt: Date.now(),
      };
      this.cacheService.setInLru(keyId, revokedRecord);
      await this.cacheService.setInRedis(keyId, revokedRecord);
      return null;
    }

    // Verify plaintext key against Argon2id hash stored in value column
    const isValid = await verifyApiKeyHash(dbRecord.value, plaintextKey);
    if (!isValid) {
      return null;
    }

    // Key is verified! Populate caches
    const verifiedRecord = {
      userId: dbRecord.user_id,
      digest: computedDigest,
      revoked: false,
      cachedAt: Date.now(),
    };

    this.cacheService.setInLru(keyId, verifiedRecord);
    await this.cacheService.setInRedis(keyId, verifiedRecord);

    void this.activityService.recordActivity(keyId, uuid);
    return { userId: dbRecord.user_id, keyId, uuid };
  }

  private safeKeyIdToUuid(keyId: string): string {
    try {
      return `${keyId.slice(0, 8)}-${keyId.slice(8, 12)}-${keyId.slice(12, 16)}-${keyId.slice(16, 20)}-${keyId.slice(20)}`;
    } catch {
      throw new NotFoundException('Invalid key identifier format');
    }
  }
}
