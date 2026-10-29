import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface IRedisService {
  isHealthy(): boolean;
  ping(): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
  del(key: string): Promise<boolean>;
  setnxWithExpiry(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(key: string, token: string): Promise<boolean>;
  renewLock(key: string, token: string, ttlSeconds: number): Promise<boolean>;
  hset(hash: string, field: string, value: string): Promise<boolean>;
  hgetall(hash: string): Promise<Record<string, string>>;
  hdel(hash: string, fields: string[]): Promise<boolean>;
  rpush(key: string, value: string): Promise<number>;
  lpop(key: string): Promise<string | null>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  ltrim(key: string, start: number, stop: number): Promise<boolean>;
  llen(key: string): Promise<number>;
  rpoplpush(source: string, destination: string): Promise<string | null>;
  lrem(key: string, count: number, value: string): Promise<number>;
}

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown, IRedisService {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const host = this.configService.get<string>('redis.host', 'localhost');
    const port = this.configService.get<number>('redis.port', 6379);
    const password = this.configService.get<string | undefined>(
      'redis.password',
    );

    try {
      this.client = new Redis({
        host,
        port,
        password: password || undefined,
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy(times) {
          if (times > 5) {
            return null; // Stop retrying after 5 attempts if server is down
          }
          return Math.min(times * 500, 3000);
        },
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.log('Connected to Redis server');
      });

      this.client.on('ready', () => {
        this.isConnected = true;
      });

      this.client.on('close', () => {
        this.isConnected = false;
      });

      this.client.on('error', (err: Error) => {
        this.isConnected = false;
        this.logger.warn(`Redis connection warning: ${err.message}`);
      });

      // Attempt initial connection asynchronously without blocking startup
      this.client.connect().catch((err: Error) => {
        this.isConnected = false;
        this.logger.warn(
          `Redis is currently offline (${err.message}). Safe PostgreSQL fallback will be active.`,
        );
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.isConnected = false;
      this.logger.warn(`Failed to initialize Redis client: ${msg}`);
    }
  }

  isHealthy(): boolean {
    return this.isConnected && this.client !== null;
  }

  async ping(): Promise<boolean> {
    if (!this.client || !this.isConnected) {
      return false;
    }
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client || !this.isConnected) return null;
    try {
      return await this.client.get(key);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis GET failed for key: ${msg}`);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    if (!this.client || !this.isConnected) return false;
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis SET failed: ${msg}`);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    if (!this.client || !this.isConnected) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis DEL failed: ${msg}`);
      return false;
    }
  }

  /**
   * Atomic SET with NX and EX for distributed debounce locks
   */
  async setnxWithExpiry(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (!this.client || !this.isConnected) return false;
    try {
      const res = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis SETNX failed: ${msg}`);
      return false;
    }
  }

  /**
   * Safe lock release: only deletes the key if its current value matches the given token.
   * Uses Redis Lua script for atomicity to prevent deleting locks held by subsequent workers.
   */
  async releaseLock(key: string, token: string): Promise<boolean> {
    if (!this.client || !this.isConnected) return false;
    const lua = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      const result = await this.client.eval(lua, 1, key, token);
      return result === 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis releaseLock failed: ${msg}`);
      return false;
    }
  }

  /**
   * Safe lock renewal (heartbeat): extends TTL only if current value matches the given token.
   * Uses Redis Lua script for atomicity to prevent extending expired or reacquired locks.
   */
  async renewLock(
    key: string,
    token: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (!this.client || !this.isConnected) return false;
    const lua = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("expire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;
    try {
      const result = await this.client.eval(lua, 1, key, token, ttlSeconds);
      return result === 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis renewLock failed: ${msg}`);
      return false;
    }
  }

  async hset(hash: string, field: string, value: string): Promise<boolean> {
    if (!this.client || !this.isConnected) return false;
    try {
      await this.client.hset(hash, field, value);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis HSET failed: ${msg}`);
      return false;
    }
  }

  async hgetall(hash: string): Promise<Record<string, string>> {
    if (!this.client || !this.isConnected) return {};
    try {
      return await this.client.hgetall(hash);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis HGETALL failed: ${msg}`);
      return {};
    }
  }

  async hdel(hash: string, fields: string[]): Promise<boolean> {
    if (!this.client || !this.isConnected || fields.length === 0) return false;
    try {
      await this.client.hdel(hash, ...fields);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis HDEL failed: ${msg}`);
      return false;
    }
  }

  async rpush(key: string, value: string): Promise<number> {
    if (!this.client || !this.isConnected) return 0;
    try {
      return await this.client.rpush(key, value);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis RPUSH failed: ${msg}`);
      return 0;
    }
  }

  async lpop(key: string): Promise<string | null> {
    if (!this.client || !this.isConnected) return null;
    try {
      return await this.client.lpop(key);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis LPOP failed: ${msg}`);
      return null;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.client || !this.isConnected) return [];
    try {
      return await this.client.lrange(key, start, stop);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis LRANGE failed: ${msg}`);
      return [];
    }
  }

  async ltrim(key: string, start: number, stop: number): Promise<boolean> {
    if (!this.client || !this.isConnected) return false;
    try {
      await this.client.ltrim(key, start, stop);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis LTRIM failed: ${msg}`);
      return false;
    }
  }

  async llen(key: string): Promise<number> {
    if (!this.client || !this.isConnected) return 0;
    try {
      return await this.client.llen(key);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis LLEN failed: ${msg}`);
      return 0;
    }
  }

  /**
   * Atomic transfer of element from source list to destination list.
   * Guarantees at-least-once delivery by retaining jobs in processing list until acknowledged.
   */
  async rpoplpush(source: string, destination: string): Promise<string | null> {
    if (!this.client || !this.isConnected) return null;
    try {
      return await this.client.rpoplpush(source, destination);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis RPOPLPUSH failed: ${msg}`);
      return null;
    }
  }

  /**
   * Remove occurrences of elements equal to value from the list stored at key.
   */
  async lrem(key: string, count: number, value: string): Promise<number> {
    if (!this.client || !this.isConnected) return 0;
    try {
      return await this.client.lrem(key, count, value);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis LREM failed: ${msg}`);
      return 0;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        // ignore shutdown error
      }
    }
  }
}
