import { Test, TestingModule } from '@nestjs/testing';
import {
  Controller,
  Get,
  Post,
  Body,
  INestApplication,
  ValidationPipe,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ThrottlerModule, Throttle } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import helmet from 'helmet';
import { AppThrottlerGuard } from '../guards/app-throttler.guard';
import { SegmentPingDto } from '../modules/analytics/dto/segment-ping.dto';
import { AllExceptionsFilter } from '../utils/all-exceptions.filter';

@Controller('test-security')
class TestSecurityController {
  @Get('public')
  publicEndpoint() {
    return { ok: true };
  }

  @Get('throttled-tight')
  @Throttle({ default: { limit: 2, ttl: 60000 } })
  throttledTight() {
    return { limited: false };
  }

  @Post('analytics-ping')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  testPing(@Body() dto: SegmentPingDto) {
    return { acknowledged: true, videoId: dto.videoId };
  }

  @Post('analytics-validation')
  @HttpCode(HttpStatus.OK)
  testValidation(@Body() dto: SegmentPingDto) {
    return { validated: true, videoId: dto.videoId };
  }

  @Get('authenticated-user')
  testAuth(@Req() req: any) {
    if (!req.headers['authorization']) {
      return { authenticated: false };
    }
    return { authenticated: true, user: req.user };
  }
}

describe('Security & Rate Limiting Integration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            name: 'default',
            ttl: 60000,
            limit: 20,
          },
        ]),
      ],
      controllers: [TestSecurityController],
      providers: [
        {
          provide: APP_GUARD,
          useClass: AppThrottlerGuard,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();

    // Mirror production main.ts configuration
    app.use(
      helmet({
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        contentSecurityPolicy: false,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Helmet HTTP Headers', () => {
    it('should set cross-origin-resource-policy to cross-origin for video and player compatibility', async () => {
      const res = await request(app.getHttpServer()).get(
        '/test-security/public',
      );
      expect(res.status).toBe(200);
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('should set security headers (X-Content-Type-Options and X-Frame-Options)', async () => {
      const res = await request(app.getHttpServer()).get(
        '/test-security/public',
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });
  });

  describe('Rate Limiting Enforcement', () => {
    it('should allow requests within the configured rate limit', async () => {
      const res1 = await request(app.getHttpServer()).get(
        '/test-security/throttled-tight',
      );
      expect(res1.status).toBe(200);
      expect(res1.body).toEqual({ limited: false });

      const res2 = await request(app.getHttpServer()).get(
        '/test-security/throttled-tight',
      );
      expect(res2.status).toBe(200);
    });

    it('should reject requests exceeding the rate limit with HTTP 429 Too Many Requests', async () => {
      // 3rd request should hit the limit (limit is 2)
      const res = await request(app.getHttpServer()).get(
        '/test-security/throttled-tight',
      );
      expect(res.status).toBe(429);
      expect(res.body.statusCode).toBe(429);
      expect(res.body.error).toBe('ThrottlerException');
      expect(res.body.message).toContain('Too Many Requests');
    });
  });

  describe('Public Analytics Endpoint Protection', () => {
    const validPing = {
      videoId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      sessionId: 'sess_client_test_123',
      watchDurationSeconds: 10,
      segmentsRequested: 2,
    };

    it('should allow public access without requiring authentication headers', async () => {
      const res = await request(app.getHttpServer())
        .post('/test-security/analytics-ping')
        .send(validPing);

      expect(res.status).toBe(200);
      expect(res.body.acknowledged).toBe(true);
      expect(res.body.videoId).toBe(validPing.videoId);
    });

    it('should enforce rate limits on repeated public analytics pings', async () => {
      // Send pings up to the limit of 3
      await request(app.getHttpServer())
        .post('/test-security/analytics-ping')
        .send(validPing);
      await request(app.getHttpServer())
        .post('/test-security/analytics-ping')
        .send(validPing);

      // 4th request must be throttled
      const res4 = await request(app.getHttpServer())
        .post('/test-security/analytics-ping')
        .send(validPing);

      expect(res4.status).toBe(429);
      expect(res4.body.statusCode).toBe(429);
      expect(res4.body.error).toBe('ThrottlerException');
    });

    it('should reject invalid payload when videoId is not a UUIDv4', async () => {
      const res = await request(app.getHttpServer())
        .post('/test-security/analytics-validation')
        .send({
          ...validPing,
          videoId: 'not-a-valid-uuid',
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('videoId must be a valid UUIDv4');
    });

    it('should reject payload when watchDurationSeconds exceeds upper bound of 60', async () => {
      const res = await request(app.getHttpServer())
        .post('/test-security/analytics-validation')
        .send({
          ...validPing,
          watchDurationSeconds: 61,
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('watchDurationSeconds must not be greater than 60');
    });

    it('should reject payload when watchDurationSeconds is below 1', async () => {
      const res = await request(app.getHttpServer())
        .post('/test-security/analytics-validation')
        .send({
          ...validPing,
          watchDurationSeconds: 0,
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('watchDurationSeconds must not be less than 1');
    });

    it('should reject payload when segmentsRequested exceeds upper bound of 20', async () => {
      const res = await request(app.getHttpServer())
        .post('/test-security/analytics-validation')
        .send({
          ...validPing,
          segmentsRequested: 21,
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('segmentsRequested must not be greater than 20');
    });

    it('should reject payload when sessionId exceeds 128 characters', async () => {
      const res = await request(app.getHttpServer())
        .post('/test-security/analytics-validation')
        .send({
          ...validPing,
          sessionId: 'x'.repeat(129),
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('sessionId must be shorter than or equal to 128 characters');
    });

    it('should reject payload with unauthorized non-whitelisted properties', async () => {
      const res = await request(app.getHttpServer())
        .post('/test-security/analytics-validation')
        .send({
          ...validPing,
          maliciousField: 'exploit_attempt',
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('property maliciousField should not exist');
    });
  });
});
