import { Controller, Get, Inject, Res, VERSION_NEUTRAL } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DRIZZLE_DB } from '../../database/database.module';
import type { DrizzleDb } from '../../database/database.module';
import { RedisService } from '../../infra/redis/redis.service';
import { sql } from 'drizzle-orm';
import { HealthResponseDto } from './dto/health-response.dto';

@ApiTags('Health')
@Controller({ path: 'health', version: [VERSION_NEUTRAL, '1'] })
export class HealthController {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Health check endpoint',
    description:
      'Evaluates connectivity to Neon PostgreSQL database and Redis cluster. Returns 200 when operational, or 503 when degraded.',
  })
  @ApiOkResponse({
    description: 'System health status and dependency connectivity details',
    type: HealthResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'System degraded when database connection fails',
    type: HealthResponseDto,
  })
  async checkHealth(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthResponseDto> {
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
    if (!isSystemHealthy) {
      res.status(503);
    }

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
