/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TranscoderService, RENDITION_LADDER } from './transcoder.service';
import { FfmpegService } from './ffmpeg.service';
import { DRIZZLE_DB } from '../../database/database.module';
import { RedisService } from '../../infra/redis/redis.service';
import { StorageService } from '../../infra/storage/storage.service';

describe('TranscoderService', () => {
  let service: TranscoderService;
  let mockDb: any;
  let mockRedisService: any;
  let mockStorageService: any;
  let mockConfigService: any;
  let mockFfmpegService: any;

  const testSecret = 'test_webhook_secret_key_32chars!';

  beforeEach(async () => {
    mockDb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([
        {
          id: '00000000-0000-0000-0000-000000000001',
          attempt: 1,
        },
      ]),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          id: '00000000-0000-0000-0000-000000000001',
          user_id: 'user_1',
          status: 'processing',
          master_m3u8_key: null,
          transcoded_size: null,
        },
      ]),
    };

    const inMemoryLocks = new Map<string, string>();
    mockRedisService = {
      isHealthy: jest.fn().mockReturnValue(true),
      ping: jest.fn().mockResolvedValue(true),
      get: jest.fn().mockImplementation((k: string) => {
        return Promise.resolve(inMemoryLocks.get(k) || null);
      }),
      set: jest.fn().mockResolvedValue(true),
      del: jest.fn().mockImplementation((k: string) => {
        inMemoryLocks.delete(k);
        return Promise.resolve(1);
      }),
      setnxWithExpiry: jest
        .fn()
        .mockImplementation((k: string, v: string) => {
          inMemoryLocks.set(k, v);
          return Promise.resolve(true);
        }),
      releaseLock: jest
        .fn()
        .mockImplementation((k: string, v: string) => {
          if (inMemoryLocks.get(k) === v) inMemoryLocks.delete(k);
          return Promise.resolve(true);
        }),
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
          fs.writeFileSync(filePath, 'dummy content');
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
        if (
          key === 'transcoder.webhookSecret' ||
          key === 'apiKeyDigestSecret'
        ) {
          return testSecret;
        }
        return defaultVal;
      }),
    };

    mockFfmpegService = {
      terminateActiveProcess: jest.fn().mockResolvedValue(true),
      probeMedia: jest.fn().mockResolvedValue({
        duration: 20,
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
        const dummyFile = path.join(
          os.tmpdir(),
          `dummy-test-${Date.now()}.m3u8`,
        );
        fs.writeFileSync(dummyFile, '#EXTM3U\n');
        return {
          masterPlaylistPath: dummyFile,
          masterPlaylistContent:
            '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2928000\n720p/index.m3u8\n',
          generatedFiles: [
            {
              relativePath: 'master.m3u8',
              absolutePath: dummyFile,
              sizeBytes: 50,
              contentType: 'application/vnd.apple.mpegurl',
            },
          ],
          totalTranscodedBytes: 50n,
          probedDuration: 20,
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

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Rendition Ladder', () => {
    it('should define specifications for 360p, 480p, 720p, and 1080p', () => {
      expect(RENDITION_LADDER['360p']).toEqual({
        name: '360p',
        width: 640,
        height: 360,
        videoBitrateKbps: 800,
        audioBitrateKbps: 96,
        fps: 30,
        segmentDurationSec: 4,
      });

      expect(RENDITION_LADDER['720p'].width).toBe(1280);
      expect(RENDITION_LADDER['720p'].videoBitrateKbps).toBe(2800);
      expect(RENDITION_LADDER['1080p'].fps).toBe(60);
      expect(RENDITION_LADDER['1080p'].videoBitrateKbps).toBe(5000);
    });
  });

  describe('Manifest Generation', () => {
    it('should generate a valid HLS Master playlist with bandwidth and stream info', () => {
      const manifest = service.generateMasterPlaylist('vid-123', [
        '360p',
        '720p',
      ]);
      expect(manifest).toContain('#EXTM3U');
      expect(manifest).toContain('#EXT-X-VERSION:3');
      expect(manifest).toContain('RESOLUTION=640x360');
      expect(manifest).toContain('360p/index.m3u8');
      expect(manifest).toContain('RESOLUTION=1280x720');
      expect(manifest).toContain('720p/index.m3u8');
    });

    it('should generate a valid HLS Variant playlist with target duration and segments', () => {
      const variant = service.generateVariantPlaylist('720p', 12);
      expect(variant).toContain('#EXTM3U');
      expect(variant).toContain('#EXT-X-TARGETDURATION:4');
      expect(variant).toContain('segment_000.ts');
      expect(variant).toContain('segment_001.ts');
      expect(variant).toContain('segment_002.ts');
      expect(variant).toContain('#EXT-X-ENDLIST');
    });
  });

  describe('Job Enqueueing and Execution', () => {
    it('should push job data to Redis queue on enqueue', async () => {
      await service.enqueueTranscodeJob({
        videoId: 'vid-123',
        userId: 'user-1',
        storageKey: 'videos/vid-123/raw.mp4',
        resolutions: ['720p'],
        title: 'Test Video',
        slug: 'test-video',
        duration: 30,
      });

      expect(mockRedisService.rpush).toHaveBeenCalledWith(
        'vedora:transcode:queue',
        expect.stringContaining('vid-123'),
      );
    });

    it('should execute transcoding, upload manifests, and set status to ready', async () => {
      await service.executeTranscoding({
        videoId: 'vid-123',
        userId: 'user-1',
        storageKey: 'videos/vid-123/raw.mp4',
        resolutions: ['720p'],
        title: 'Test Video',
        slug: 'test-video',
        duration: 20,
      });

      // Check DB update called twice: once for processing, once for ready
      expect(mockDb.update).toHaveBeenCalledTimes(2);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ready',
          master_m3u8_key: 'videos/vid-123/master.m3u8',
        }),
      );
      expect(mockStorageService.uploadDirectBuffer).toHaveBeenCalled();
    });
  });

  describe('Webhook Verification & Handling', () => {
    const videoId = '00000000-0000-0000-0000-000000000001';
    const payloadDto = {
      videoId,
      masterKey: `videos/${videoId}/master.m3u8`,
      totalDuration: 120,
      renditions: ['720p'],
      transcodedSize: 50000000,
      status: 'completed' as const,
      attempt: 1,
    };
    const rawPayload = JSON.stringify(payloadDto);

    function createValidSignature(payload: string): string {
      return crypto
        .createHmac('sha256', testSecret)
        .update(payload)
        .digest('hex');
    }

    it('should reject webhooks with missing or invalid signature', async () => {
      await expect(
        service.handleWebhook(undefined, rawPayload, payloadDto),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        service.handleWebhook('invalid_signature', rawPayload, payloadDto),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should accept valid signature and update video status to ready', async () => {
      const validSig = createValidSignature(rawPayload);
      const res = await service.handleWebhook(validSig, rawPayload, payloadDto);

      expect(res.success).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ready',
          master_m3u8_key: payloadDto.masterKey,
          duration: 120,
          transcoded_size: 50000000n,
        }),
      );
    });

    it('should be idempotent if video is already ready', async () => {
      mockDb.limit.mockResolvedValueOnce([
        {
          id: videoId,
          user_id: 'user_1',
          status: 'ready',
          master_m3u8_key: payloadDto.masterKey,
        },
      ]);

      const validSig = createValidSignature(rawPayload);
      const res = await service.handleWebhook(validSig, rawPayload, payloadDto);

      expect(res.success).toBe(true);
      expect(res.message).toContain('idempotent');
    });
  });
});
