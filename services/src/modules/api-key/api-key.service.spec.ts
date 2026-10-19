import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ApiKeyService } from './api-key.service';
import { ApiKeyCacheService } from './api-key-cache.service';
import { ApiKeyActivityService } from './api-key-activity.service';
import { DRIZZLE_DB } from '../../database/database.module';
import { RedisService } from '../../infra/redis/redis.service';
import {
  generateApiKey,
  hashApiKey,
  deriveKeyDigest,
} from '../../utils/api-key.util';

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let cacheService: ApiKeyCacheService;
  let activityService: ApiKeyActivityService;

  const mockDb = {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockResolvedValue([{}]),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockResolvedValue([]),
    limit: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  };

  const mockRedisService = {
    isHealthy: jest.fn().mockReturnValue(true),
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true),
    setnxWithExpiry: jest.fn().mockResolvedValue(true),
    hset: jest.fn().mockResolvedValue(true),
    hgetall: jest.fn().mockResolvedValue({}),
    hdel: jest.fn().mockResolvedValue(true),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('test_secret_for_digest_indexing_12345'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyService,
        ApiKeyCacheService,
        {
          provide: ApiKeyActivityService,
          useValue: {
            recordActivity: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: DRIZZLE_DB,
          useValue: mockDb,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ApiKeyService>(ApiKeyService);
    cacheService = module.get<ApiKeyCacheService>(ApiKeyCacheService);
    activityService = module.get<ApiKeyActivityService>(ApiKeyActivityService);
  });

  describe('createApiKey', () => {
    it('should generate an API key, save Argon2id hash in DB, and populate caches', async () => {
      const userId = 'user_123';
      const result = await service.createApiKey(userId);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('key');
      expect(result).toHaveProperty('prefix');
      expect(result.key).toMatch(/^VDR_[a-f0-9]{32}_[A-Za-z0-9_-]{32,}$/);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: userId,
          prefix: result.prefix,
        }),
      );
      expect(mockRedisService.set).toHaveBeenCalled();
    });
  });

  describe('verifyApiKey', () => {
    it('should return null immediately for malformed key format without DB lookup', async () => {
      const result = await service.verifyApiKey('malformed-key');
      expect(result).toBeNull();
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('Level 1: should verify from LRU cache without hitting Redis or DB', async () => {
      const { key, keyId, uuid } = generateApiKey();
      const digest = deriveKeyDigest(
        key,
        'test_secret_for_digest_indexing_12345',
      );

      // Pre-populate LRU cache
      cacheService.setInLru(keyId, {
        userId: 'user_lru',
        digest,
        revoked: false,
        cachedAt: Date.now(),
      });

      const result = await service.verifyApiKey(key);
      expect(result).toEqual({
        userId: 'user_lru',
        keyId,
        uuid,
      });

      expect(mockRedisService.get).not.toHaveBeenCalled();
      expect(mockDb.select).not.toHaveBeenCalled();
      const recordSpy = jest.spyOn(activityService, 'recordActivity');
      expect(recordSpy).toHaveBeenCalledWith(keyId, uuid);
    });

    it('Level 2: should verify from Redis when LRU misses, and rehydrate LRU', async () => {
      const { key, keyId, uuid } = generateApiKey();
      const digest = deriveKeyDigest(
        key,
        'test_secret_for_digest_indexing_12345',
      );

      // Redis has the key
      mockRedisService.get.mockResolvedValueOnce(
        JSON.stringify({
          userId: 'user_redis',
          digest,
          revoked: false,
          cachedAt: Date.now(),
        }),
      );

      const result = await service.verifyApiKey(key);
      expect(result).toEqual({
        userId: 'user_redis',
        keyId,
        uuid,
      });

      expect(mockDb.select).not.toHaveBeenCalled();
      // Should now be cached in LRU
      const fromLru = cacheService.getFromLru(keyId);
      expect(fromLru?.userId).toBe('user_redis');
    });

    it('Level 3: should query DB, verify Argon2id hash, and populate caches on cache misses', async () => {
      const { key, keyId, uuid } = generateApiKey();
      const hash = await hashApiKey(key);

      mockRedisService.get.mockResolvedValueOnce(null);
      mockDb.limit.mockResolvedValueOnce([
        {
          id: uuid,
          user_id: 'user_db',
          value: hash,
          revoked_at: null,
        },
      ]);

      const result = await service.verifyApiKey(key);
      expect(result).toEqual({
        userId: 'user_db',
        keyId,
        uuid,
      });

      expect(mockDb.select).toHaveBeenCalled();
      // Should populate caches
      const fromLru = cacheService.getFromLru(keyId);
      expect(fromLru?.userId).toBe('user_db');
      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it('should reject a revoked key even if found in cache or DB', async () => {
      const { key, keyId } = generateApiKey();
      const digest = deriveKeyDigest(
        key,
        'test_secret_for_digest_indexing_12345',
      );

      // Cached as revoked
      cacheService.setInLru(keyId, {
        userId: 'user_revoked',
        digest,
        revoked: true,
        cachedAt: Date.now(),
      });

      const result = await service.verifyApiKey(key);
      expect(result).toBeNull();
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should safely fall back to PostgreSQL if Redis is down', async () => {
      mockRedisService.isHealthy.mockReturnValue(false);
      mockRedisService.get.mockResolvedValueOnce(null);

      const { key, uuid } = generateApiKey();
      const hash = await hashApiKey(key);

      mockDb.limit.mockResolvedValueOnce([
        {
          id: uuid,
          user_id: 'user_fallback',
          value: hash,
          revoked_at: null,
        },
      ]);

      const result = await service.verifyApiKey(key);
      expect(result?.userId).toBe('user_fallback');
    });
  });

  describe('revokeApiKey', () => {
    it('should mark key as revoked in DB and invalidate both LRU and Redis caches', async () => {
      const userId = 'user_123';
      const { keyId, uuid } = generateApiKey();

      mockDb.limit.mockResolvedValueOnce([
        {
          id: uuid,
          user_id: userId,
          revoked_at: null,
        },
      ]);

      // Seed LRU
      cacheService.setInLru(keyId, {
        userId,
        digest: 'd',
        revoked: false,
        cachedAt: Date.now(),
      });

      const res = await service.revokeApiKey(userId, uuid);
      expect(res.success).toBe(true);

      // Cache should be cleared
      expect(cacheService.getFromLru(keyId)).toBeNull();
      expect(mockRedisService.del).toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalled();
    });
  });
});
