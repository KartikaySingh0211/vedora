/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TranscoderService } from './transcoder.service';
import { FfmpegService } from './ffmpeg.service';
import { DRIZZLE_DB } from '../../database/database.module';
import { RedisService, IRedisService } from '../../infra/redis/redis.service';
import { StorageService } from '../../infra/storage/storage.service';
import { TranscoderWebhookDto } from './dto/transcoder-webhook.dto';

describe('Transcoder Phase 1 Security & Reliability Regressions', () => {
  let service: TranscoderService;
  let mockDb: any;
  let mockRedisService: jest.Mocked<IRedisService>;
  let mockStorageService: any;
  let mockConfigService: any;
  let mockFfmpegService: any;

  const testSecret = 'deterministic_test_secret_32bytes_long!';
  const videoId = '11111111-2222-3333-4444-555555555555';

  function createValidSignature(payload: Buffer | string, secret = testSecret): string {
    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
    return crypto.createHmac('sha256', secret).update(buf).digest('hex');
  }

  beforeEach(async () => {
    mockDb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          id: videoId,
          user_id: 'user_1',
          status: 'processing',
          master_m3u8_key: null,
          transcoded_size: null,
        },
      ]),
    };

    mockRedisService = {
      isHealthy: jest.fn().mockReturnValue(true),
      ping: jest.fn().mockResolvedValue(true),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      del: jest.fn().mockResolvedValue(true),
      setnxWithExpiry: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(true),
      renewLock: jest.fn().mockResolvedValue(true),
      hset: jest.fn().mockResolvedValue(true),
      hgetall: jest.fn().mockResolvedValue({}),
      hdel: jest.fn().mockResolvedValue(true),
      rpush: jest.fn().mockResolvedValue(1),
      lpop: jest.fn().mockResolvedValue(null),
      lrange: jest.fn().mockResolvedValue([]),
      ltrim: jest.fn().mockResolvedValue(true),
      llen: jest.fn().mockResolvedValue(0),
      rpoplpush: jest.fn().mockResolvedValue(null),
      lrem: jest.fn().mockResolvedValue(1),
    };

    mockStorageService = {
      downloadObjectToFile: jest
        .fn()
        .mockImplementation(async (key: string, filePath: string) => {
          fs.writeFileSync(filePath, 'dummy binary content');
          return true;
        }),
      uploadDirectBuffer: jest
        .fn()
        .mockResolvedValue({ success: true, key: 'test-key' }),
      getDefaultBucketId: jest.fn().mockReturnValue('bucket-1'),
      getPublicUrl: jest.fn((key: string) => `https://cdn.vedora.com/${key}`),
    };

    mockConfigService = {
      get: jest.fn((key: string, defaultVal?: any) => {
        if (key === 'transcoder.webhookSecret') return testSecret;
        return defaultVal;
      }),
    };

    mockFfmpegService = {
      probeMedia: jest.fn().mockResolvedValue({
        duration: 30,
        width: 1280,
        height: 720,
        fps: 30,
        hasVideo: true,
        hasAudio: true,
      }),
      selectRenditions: jest.fn().mockReturnValue([
        {
          name: '720p',
          width: 1280,
          height: 720,
          videoBitrateKbps: 2800,
          audioBitrateKbps: 128,
          fps: 30,
          segmentDurationSec: 4,
        },
      ]),
      transcodeToHls: jest.fn().mockImplementation(async () => {
        const dummyMaster = path.join(os.tmpdir(), `test-master-${Date.now()}.m3u8`);
        fs.writeFileSync(dummyMaster, '#EXTM3U\n');
        return {
          masterPlaylistPath: dummyMaster,
          masterPlaylistContent: '#EXTM3U\n#EXT-X-VERSION:3\n720p/index.m3u8\n',
          generatedFiles: [
            {
              relativePath: 'master.m3u8',
              absolutePath: dummyMaster,
              sizeBytes: 60,
              contentType: 'application/vnd.apple.mpegurl',
            },
          ],
          totalTranscodedBytes: 60n,
          probedDuration: 30,
        };
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscoderService,
        { provide: DRIZZLE_DB, useValue: mockDb },
        { provide: RedisService, useValue: mockRedisService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: FfmpegService, useValue: mockFfmpegService },
      ],
    }).compile();

    service = module.get<TranscoderService>(TranscoderService);
  });

  describe('Task 1.1: Webhook Secret Validation & Safe Startup Failure', () => {
    it('should throw Error at startup in onModuleInit when TRANSCODER_WEBHOOK_SECRET is missing', async () => {
      mockConfigService.get.mockReturnValueOnce(undefined);
      await expect(service.onModuleInit()).rejects.toThrow(
        /TRANSCODER_WEBHOOK_SECRET is required and must be at least 32 characters long/,
      );
    });

    it('should throw Error in validateWebhookConfig when secret is an empty string or whitespace-only', () => {
      mockConfigService.get.mockReturnValueOnce('');
      expect(() => service.validateWebhookConfig()).toThrow(
        /TRANSCODER_WEBHOOK_SECRET is required and must be at least 32 characters long/,
      );

      mockConfigService.get.mockReturnValueOnce('   ');
      expect(() => service.validateWebhookConfig()).toThrow(
        /TRANSCODER_WEBHOOK_SECRET is required and must be at least 32 characters long/,
      );
    });

    it('should throw Error in validateWebhookConfig when secret is shorter than 32 characters after trimming', () => {
      // 16 characters
      mockConfigService.get.mockReturnValueOnce('too_short_secret');
      expect(() => service.validateWebhookConfig()).toThrow(
        /TRANSCODER_WEBHOOK_SECRET is required and must be at least 32 characters long/,
      );

      // 31 characters (1 below minimum)
      const thirtyOneChars = 'a'.repeat(31);
      mockConfigService.get.mockReturnValueOnce(thirtyOneChars);
      expect(() => service.validateWebhookConfig()).toThrow(
        /TRANSCODER_WEBHOOK_SECRET is required and must be at least 32 characters long/,
      );

      // 31 characters padded with whitespace
      mockConfigService.get.mockReturnValueOnce(`   ${thirtyOneChars}   `);
      expect(() => service.validateWebhookConfig()).toThrow(
        /TRANSCODER_WEBHOOK_SECRET is required and must be at least 32 characters long/,
      );
    });

    it('should accept secret when it is exactly 32 characters long after trimming', () => {
      const exactly32Chars = '12345678901234567890123456789012';
      expect(exactly32Chars.length).toBe(32);

      // Exactly 32 characters
      mockConfigService.get.mockReturnValueOnce(exactly32Chars);
      expect(() => service.validateWebhookConfig()).not.toThrow();

      // Exactly 32 characters surrounded by whitespace
      mockConfigService.get.mockReturnValueOnce(`   ${exactly32Chars}   `);
      expect(() => service.validateWebhookConfig()).not.toThrow();
    });

    it('should reject webhook verification with UnauthorizedException when secret is unconfigured or shorter than 32 characters', () => {
      mockConfigService.get.mockReturnValueOnce(undefined);
      expect(() =>
        service.verifyWebhookSignature('sig123', Buffer.from('payload')),
      ).toThrow(UnauthorizedException);

      mockConfigService.get.mockReturnValueOnce('short_key');
      expect(() =>
        service.verifyWebhookSignature('sig123', Buffer.from('payload')),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('Task 1.2: Raw Body Webhook Signature Verification', () => {
    const sampleDto: TranscoderWebhookDto = {
      videoId,
      masterKey: `videos/${videoId}/master.m3u8`,
      totalDuration: 45,
      renditions: ['720p'],
      transcodedSize: 1200000,
      status: 'completed',
    };
    const rawBodyBuffer = Buffer.from(JSON.stringify(sampleDto), 'utf8');

    it('should reject webhooks when raw body is missing or empty', async () => {
      const validSig = createValidSignature(rawBodyBuffer);
      await expect(
        service.handleWebhook(validSig, undefined, sampleDto),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.handleWebhook(validSig, Buffer.alloc(0), sampleDto),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.handleWebhook(validSig, '', sampleDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject webhooks when x-transcoder-signature header is missing', async () => {
      await expect(
        service.handleWebhook(undefined, rawBodyBuffer, sampleDto),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject webhooks when signature is completely invalid or mismatched length', async () => {
      await expect(
        service.handleWebhook('short_sig', rawBodyBuffer, sampleDto),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject webhooks when raw body has been tampered with by even one byte', async () => {
      const validSig = createValidSignature(rawBodyBuffer);
      const tamperedBuffer = Buffer.from(
        JSON.stringify({ ...sampleDto, totalDuration: 46 }),
        'utf8',
      );

      await expect(
        service.handleWebhook(validSig, tamperedBuffer, sampleDto),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should accept valid signature computed over exact raw request body buffer', async () => {
      const validSig = createValidSignature(rawBodyBuffer);
      const res = await service.handleWebhook(validSig, rawBodyBuffer, sampleDto);

      expect(res.success).toBe(true);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ready',
          master_m3u8_key: sampleDto.masterKey,
          duration: 45,
        }),
      );
    });

    it('should support sha256= prefix in signature header', async () => {
      const validSig = `sha256=${createValidSignature(rawBodyBuffer)}`;
      const res = await service.handleWebhook(validSig, rawBodyBuffer, sampleDto);
      expect(res.success).toBe(true);
    });

    it('should handle idempotent callback when video is already ready', async () => {
      mockDb.limit.mockResolvedValueOnce([
        {
          id: videoId,
          user_id: 'user_1',
          status: 'ready',
          master_m3u8_key: sampleDto.masterKey,
        },
      ]);

      const validSig = createValidSignature(rawBodyBuffer);
      const res = await service.handleWebhook(validSig, rawBodyBuffer, sampleDto);
      expect(res.success).toBe(true);
      expect(res.message).toContain('idempotent');
    });

    it('should mark video as failed when webhook reports failed status', async () => {
      const failedDto: TranscoderWebhookDto = {
        videoId,
        masterKey: '',
        totalDuration: 0,
        renditions: [],
        transcodedSize: 0,
        status: 'failed',
        errorMessage: 'Media decoding error in cloud fleet',
      };
      const rawFailed = Buffer.from(JSON.stringify(failedDto), 'utf8');
      const validSig = createValidSignature(rawFailed);

      const res = await service.handleWebhook(validSig, rawFailed, failedDto);
      expect(res.success).toBe(false);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
        }),
      );
    });
  });

  describe('Task 1.3 & 1.5: Transcoder & Storage Failures Never Produce READY', () => {
    const jobPayload = {
      videoId,
      userId: 'user-1',
      storageKey: 'videos/vid-1/source.mp4',
      resolutions: ['720p'],
      title: 'Test',
      slug: 'test',
      duration: 30,
    };

    it('should fail and never mark ready if source video cannot be downloaded', async () => {
      mockStorageService.downloadObjectToFile.mockResolvedValueOnce(false);

      await expect(service.executeTranscoding(jobPayload)).rejects.toThrow();

      // Ensure status was updated to processing initially, then to failed, NEVER to ready
      const updateCalls = mockDb.set.mock.calls;
      const statusUpdates = updateCalls.map((c: any[]) => c[0].status);
      expect(statusUpdates).toContain('processing');
      expect(statusUpdates).toContain('failed');
      expect(statusUpdates).not.toContain('ready');
      expect(mockRedisService.releaseLock).toHaveBeenCalled();
    });

    it('should fail and never mark ready if FFmpeg transcoding throws an error', async () => {
      mockFfmpegService.transcodeToHls.mockRejectedValueOnce(
        new Error('FFmpeg process terminated with signal SIGSEGV'),
      );

      await expect(service.executeTranscoding(jobPayload)).rejects.toThrow(
        /FFmpeg process terminated/,
      );

      const updateCalls = mockDb.set.mock.calls;
      const statusUpdates = updateCalls.map((c: any[]) => c[0].status);
      expect(statusUpdates).toContain('failed');
      expect(statusUpdates).not.toContain('ready');
      expect(mockRedisService.releaseLock).toHaveBeenCalled();
    });

    it('should fail and never mark ready if storage upload fails for an output asset', async () => {
      mockStorageService.uploadDirectBuffer.mockResolvedValueOnce({
        success: false,
        error: 'S3 Connection Reset',
      });

      await expect(service.executeTranscoding(jobPayload)).rejects.toThrow(
        /Failed to upload transcoded asset/,
      );

      const updateCalls = mockDb.set.mock.calls;
      const statusUpdates = updateCalls.map((c: any[]) => c[0].status);
      expect(statusUpdates).toContain('failed');
      expect(statusUpdates).not.toContain('ready');
      expect(mockRedisService.releaseLock).toHaveBeenCalled();
    });

    it('should fail and never mark ready if master playlist content is missing', async () => {
      mockFfmpegService.transcodeToHls.mockResolvedValueOnce({
        masterPlaylistPath: '/tmp/master.m3u8',
        masterPlaylistContent: '',
        generatedFiles: [],
        totalTranscodedBytes: 0n,
        probedDuration: 0,
      });

      await expect(service.executeTranscoding(jobPayload)).rejects.toThrow(
        /Master playlist content missing/,
      );

      const updateCalls = mockDb.set.mock.calls;
      const statusUpdates = updateCalls.map((c: any[]) => c[0].status);
      expect(statusUpdates).toContain('failed');
      expect(statusUpdates).not.toContain('ready');
    });
  });

  describe('Task 1.4: Queue Processing & Stuck-Job Recovery', () => {
    it('should re-enqueue interrupted job when lock has expired and attempts < 3', async () => {
      const strandedJob = {
        videoId: 'stranded-video-1',
        attempts: 1,
        resolutions: ['720p'],
        storageKey: 'key-1',
      };
      mockRedisService.lrange.mockResolvedValueOnce([JSON.stringify(strandedJob)]);
      mockRedisService.get.mockResolvedValueOnce(null); // No active lock
      mockDb.limit.mockResolvedValueOnce([
        { status: 'processing' },
      ]);

      const recovered = await service.recoverStuckJobs();

      expect(recovered).toContain('stranded-video-1');
      expect(mockRedisService.lrem).toHaveBeenCalledWith(
        'vedora:transcode:processing',
        1,
        expect.any(String),
      );
      expect(mockRedisService.rpush).toHaveBeenCalledWith(
        'vedora:transcode:queue',
        expect.stringContaining('"attempts":2'),
      );
    });

    it('should mark video as failed when recovery attempts exceed 3', async () => {
      const maxRetriedJob = {
        videoId: 'max-retried-video',
        attempts: 3,
        resolutions: ['720p'],
        storageKey: 'key-1',
      };
      mockRedisService.lrange.mockResolvedValueOnce([JSON.stringify(maxRetriedJob)]);
      mockRedisService.get.mockResolvedValueOnce(null); // No active lock
      mockDb.limit.mockResolvedValueOnce([
        { status: 'processing' },
      ]);

      const recovered = await service.recoverStuckJobs();

      expect(recovered).toContain('max-retried-video');
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
        }),
      );
    });
  });
});
