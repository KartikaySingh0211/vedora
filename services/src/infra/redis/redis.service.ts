import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
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
