import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { DrizzleDb } from '../../database/database.module';
import { RedisService } from '../../infra/redis/redis.service';

@Injectable()
export class ApiKeyActivityService {
  private readonly logger = new Logger(ApiKeyActivityService.name);

  private readonly HASH_KEY = 'vedora:api_key:last_used:v1';
  private readonly LOCK_PREFIX = 'vedora:api_key:last_used_lock:v1:';
  private readonly FLUSH_LOCK_KEY = 'vedora:api_key:flush_lock';
  private readonly DEBOUNCE_SECONDS = 60;

  // In-memory fallback if Redis is unavailable
  private memoryActivity = new Map<string, string>();
  private memoryLocks = new Map<string, number>();

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Debounced activity tracking for authenticated API keys
   */
  async recordActivity(keyId: string, uuid: string): Promise<void> {
    const timestamp = new Date().toISOString();

    if (this.redisService.isHealthy()) {
      const lockKey = `${this.LOCK_PREFIX}${keyId}`;
      const acquired = await this.redisService.setnxWithExpiry(
        lockKey,
        '1',
        this.DEBOUNCE_SECONDS,
      );

      if (acquired) {
        await this.redisService.hset(this.HASH_KEY, uuid, timestamp);
      }
    } else {
      // Safe fallback when Redis is offline
      const now = Date.now();
      const lastRecorded = this.memoryLocks.get(keyId) || 0;
      if (now - lastRecorded >= this.DEBOUNCE_SECONDS * 1000) {
        this.memoryLocks.set(keyId, now);
        this.memoryActivity.set(uuid, timestamp);
      }
    }
  }

  /**
   * Scheduled flush every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async flushActivityToDatabase(): Promise<void> {
    const isRedisUp = this.redisService.isHealthy();

    // In a multi-instance deployment, acquire distributed flush lock
    let distributedLockAcquired = true;
    if (isRedisUp) {
      distributedLockAcquired = await this.redisService.setnxWithExpiry(
        this.FLUSH_LOCK_KEY,
        '1',
        120, // 2 minutes lock
      );
    }

    if (!distributedLockAcquired) {
      return; // Another instance is handling this flush cycle
    }

    try {
      const pendingUpdates: Record<string, string> = {};

      if (isRedisUp) {
        const redisData = await this.redisService.hgetall(this.HASH_KEY);
        Object.assign(pendingUpdates, redisData);
      }

      // Merge any memory fallback items
      for (const [uuid, ts] of this.memoryActivity.entries()) {
        pendingUpdates[uuid] = ts;
      }

      const uuids = Object.keys(pendingUpdates);
      if (uuids.length === 0) {
        return;
      }

      this.logger.log(
        `Flushing ${uuids.length} API key last_used timestamps to PostgreSQL`,
      );

      // Parameterized batch update to prevent SQL injection and update valid records only
      await this.db.transaction(async (tx) => {
        for (const uuid of uuids) {
          const isoDate = pendingUpdates[uuid];
          await tx.execute(
            sql`UPDATE api_key 
                SET last_used_at = ${new Date(isoDate)} 
                WHERE id = ${uuid}::uuid AND revoked_at IS NULL`,
          );
        }
      });

      // Clear successfully flushed entries from Redis and memory
      if (isRedisUp) {
        await this.redisService.hdel(this.HASH_KEY, uuids);
      }
      for (const uuid of uuids) {
        this.memoryActivity.delete(uuid);
      }

      this.logger.log(`Successfully flushed ${uuids.length} timestamps`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to flush last_used timestamps to DB: ${msg}. Preserving queued activity.`,
      );
      // Activity is preserved in Redis / memory for next run
    } finally {
      if (isRedisUp && distributedLockAcquired) {
        await this.redisService.del(this.FLUSH_LOCK_KEY);
      }
    }
  }
}
