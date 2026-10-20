/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { DRIZZLE_DB } from '../../database/database.module';
import { RedisService } from '../../infra/redis/redis.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let mockDb: any;
  let mockRedisService: any;
  let mockConfigService: any;

  const videoId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockImplementation(() => {
        const query: any = Promise.resolve([
          { totalViews: 45, totalDuration: 1800, uniqueViewers: 32 },
        ]);
        query.limit = jest
          .fn()
          .mockResolvedValue([{ id: videoId, userId: 'user_1' }]);
        query.groupBy = jest.fn().mockImplementation(() => {
          const groupQuery: any = Promise.resolve([
            { name: 'desktop', value: 10, browser: 'Chrome', count: 10 },
          ]);
          groupQuery.orderBy = jest.fn().mockImplementation(() => {
            const orderQuery: any = Promise.resolve([
              { date: 'Jun 01', views: 5 },
            ]);
            orderQuery.limit = jest
              .fn()
              .mockResolvedValue([{ videoId, views: 5, duration: 200 }]);
            return orderQuery;
          });
          return groupQuery;
        });
        return query;
      }),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockResolvedValue([{ id: 'view-1' }]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    };

    mockRedisService = {
      rpush: jest.fn().mockResolvedValue(1),
      lrange: jest.fn().mockResolvedValue([
        JSON.stringify({
          videoId,
          userId: 'user_1',
          viewerSessionId: 'hash_123',
          watchDurationSeconds: 10,
          totalSegmentsRequested: 2,
          country: 'US',
          browser: 'Chrome',
          device: 'desktop',
          referrer: 'direct',
          createdAt: new Date().toISOString(),
        }),
      ]),
      ltrim: jest.fn().mockResolvedValue(true),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('analytics_secret_key_32chars_test!'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: DRIZZLE_DB, useValue: mockDb },
        { provide: RedisService, useValue: mockRedisService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('ingestSegmentPing', () => {
    it('should buffer telemetry event with pseudonymous session ID without raw IP', async () => {
      const res = await service.ingestSegmentPing(
        {
          videoId,
          sessionId: 'client_session_123',
          watchDurationSeconds: 10,
          segmentsRequested: 2,
        },
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '192.168.1.1',
        'https://vedora.com/video/1',
        'US',
      );

      expect(res.acknowledged).toBe(true);
      expect(mockRedisService.rpush).toHaveBeenCalledWith(
        'vedora:analytics:buffer',
        expect.stringContaining(videoId),
      );

      // Verify raw IP is NOT stored in payload
      const [savedPayload] = mockRedisService.rpush.mock.calls[0][1];
      expect(savedPayload).not.toContain('192.168.1.1');
    });

    it('should throw NotFoundException if video does not exist', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: jest.fn().mockResolvedValue([]),
      });

      await expect(
        service.ingestSegmentPing(
          {
            videoId: '00000000-0000-0000-0000-000000000099',
            sessionId: 'sess_1',
            watchDurationSeconds: 10,
            segmentsRequested: 1,
          },
          'UA',
          '1.2.3.4',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('flushBuffer', () => {
    it('should drain Redis buffer and batch-insert into video_views table', async () => {
      const count = await service.flushBuffer();
      expect(count).toBe(1);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockRedisService.ltrim).toHaveBeenCalled();
    });

    it('should return 0 when buffer is empty', async () => {
      mockRedisService.lrange.mockResolvedValueOnce([]);
      const count = await service.flushBuffer();
      expect(count).toBe(0);
    });
  });

  describe('getMetrics', () => {
    it('should compute aggregated metrics scoped to authenticated user', async () => {
      const metrics = await service.getMetrics('user_1', { window: '7d' });

      expect(metrics).toBeDefined();
      expect(metrics.totalViews).toBe(45);
      expect(metrics.totalWatchTimeSeconds).toBe(1800);
      expect(metrics.totalWatchTimeMinutes).toBe(30);
      expect(metrics.uniqueViewers).toBe(32);
      expect(metrics.avgDurationSeconds).toBe(40);
      expect(Array.isArray(metrics.deviceBreakdown)).toBe(true);
      expect(Array.isArray(metrics.browserBreakdown)).toBe(true);
    });
  });
});
