import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DRIZZLE_DB } from '../../database/database.module';
import type { DrizzleDb } from '../../database/database.module';
import { RedisService } from '../../infra/redis/redis.service';
import { sql } from 'drizzle-orm';

@ApiTags('Health')
@Controller({ path: 'health', version: [VERSION_NEUTRAL, '1'] })
export class HealthController {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  async checkHealth() {
    let dbStatus = 'down';
    try {
      await this.db.execute(sql`SELECT 1`);
      dbStatus = 'up';
    } catch {
      dbStatus = 'down';
    }

    const redisConnected = this.redisService.isHealthy();
    const redisPing = await this.redisService.ping();
    const redisStatus =
      redisPing || redisConnected ? 'up' : 'down (fallback to db active)';

    const isSystemHealthy = dbStatus === 'up';

    return {
      status: isSystemHealthy ? 'ok' : 'degraded',
      service: 'vedora-services',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      dependencies: {
        database: dbStatus,
        redis: redisStatus,
      },
    };
  }
}
