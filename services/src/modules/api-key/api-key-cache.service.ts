import { Injectable, Logger } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { RedisService } from '../../infra/redis/redis.service';

export interface CachedKeyRecord {
  userId: string;
  digest: string;
  revoked: boolean;
  cachedAt: number;
}

@Injectable()
export class ApiKeyCacheService {
  private readonly logger = new Logger(ApiKeyCacheService.name);
  private readonly lruCache: LRUCache<string, CachedKeyRecord>;

  // Redis namespace according to Vedora specification
  private readonly REDIS_PREFIX = 'vedora:api_key:v1:';
  private readonly LRU_PREFIX = 'v1:';

  private readonly LRU_SOFT_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly REDIS_HARD_TTL_SEC = 10 * 60; // 10 minutes

  constructor(private readonly redisService: RedisService) {
    this.lruCache = new LRUCache<string, CachedKeyRecord>({
      max: 100000,
      ttl: this.LRU_SOFT_TTL_MS,
    });
  }

  // --- Level 1: LRU ---
  getFromLru(keyId: string): CachedKeyRecord | null {
    const lruKey = `${this.LRU_PREFIX}${keyId}`;
    const record = this.lruCache.get(lruKey);
    if (!record) return null;

    // Check soft TTL expiration
    if (Date.now() - record.cachedAt > this.LRU_SOFT_TTL_MS) {
      this.lruCache.delete(lruKey);
      return null;
    }

    return record;
  }

  setInLru(keyId: string, record: CachedKeyRecord): void {
    const lruKey = `${this.LRU_PREFIX}${keyId}`;
    this.lruCache.set(lruKey, record);
  }

  invalidateLru(keyId: string): void {
    const lruKey = `${this.LRU_PREFIX}${keyId}`;
    this.lruCache.delete(lruKey);
  }

  // --- Level 2: Redis ---
  async getFromRedis(keyId: string): Promise<CachedKeyRecord | null> {
    const redisKey = `${this.REDIS_PREFIX}${keyId}`;
    const data = await this.redisService.get(redisKey);
    if (!data) return null;

    try {
      return JSON.parse(data) as CachedKeyRecord;
    } catch {
      await this.redisService.del(redisKey);
      return null;
    }
  }

  async setInRedis(keyId: string, record: CachedKeyRecord): Promise<void> {
    const redisKey = `${this.REDIS_PREFIX}${keyId}`;
    await this.redisService.set(
      redisKey,
      JSON.stringify(record),
      this.REDIS_HARD_TTL_SEC,
    );
  }

  async invalidateRedis(keyId: string): Promise<void> {
    const redisKey = `${this.REDIS_PREFIX}${keyId}`;
    await this.redisService.del(redisKey);
  }

  /**
   * Invalidate both Level 1 (LRU) and Level 2 (Redis) caches
   */
  async invalidateAll(keyId: string): Promise<void> {
    this.invalidateLru(keyId);
    await this.invalidateRedis(keyId);
  }
}
