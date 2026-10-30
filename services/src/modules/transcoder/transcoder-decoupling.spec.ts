import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TranscoderService, QUEUE_KEY, PROCESSING_QUEUE_KEY } from './transcoder.service';
import { CACHE_KEYS } from '../../common/cache-keys';
import { TranscoderProcessor } from './transcoder.processor';
import { FfmpegService } from './ffmpeg.service';
import { StorageService } from '../../infra/storage/storage.service';
import { RedisService } from '../../infra/redis/redis.service';
import { DRIZZLE_DB } from '../../database/database.module';
import * as schema from '../../database/schema';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

describe('Transcoder Decoupling Architecture (Phase 4)', () => {
  let transcoderService: TranscoderService;
  let transcoderProcessor: TranscoderProcessor;
  let mockDb: any;
  let mockRedis: any;
  let mockFfmpeg: any;
  let mockStorage: any;
  let inMemoryLocks: Map<string, string>;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    inMemoryLocks = new Map<string, string>();

    mockDb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([
        {
          id: 'test-video-decoupling-1',
          attempt: 1,
        },
      ]),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      limit: jest.fn().mockImplementation((n?: number) => {
        if (n === 1) {
          return Promise.resolve([
            {
              id: 'test-video-decoupling-1',
              user_id: 'user_dec_1',
              status: 'uploaded',
              enqueue_state: 'pending',
              attempt: 1,
              master_m3u8_key: null,
              transcoded_size: null,
              heartbeat_lease: new Date(Date.now() + 60000),
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    };

    inMemoryLocks = new Map<string, string>();
    mockRedis = {
      rpush: jest.fn().mockResolvedValue(1),
      lpop: jest.fn().mockResolvedValue(null),
      rpoplpush: jest.fn().mockResolvedValue(null),
      lrem: jest.fn().mockResolvedValue(1),
      lrange: jest.fn().mockResolvedValue([]),
      llen: jest.fn().mockResolvedValue(0),
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
      get: jest.fn().mockImplementation((k: string) => {
        return Promise.resolve(inMemoryLocks.get(k) || null);
      }),
      set: jest.fn().mockResolvedValue(true),
      del: jest.fn().mockImplementation((k: string) => {
        inMemoryLocks.delete(k);
        return Promise.resolve(1);
      }),
      isHealthy: jest.fn().mockReturnValue(true),
      ping: jest.fn().mockResolvedValue(true),
    };

    mockFfmpeg = {
      terminateActiveProcess: jest.fn().mockResolvedValue(true),
      probeMedia: jest.fn().mockResolvedValue({
        duration: 10,
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
      transcodeToHls: jest.fn().mockResolvedValue({
        generatedFiles: [],
        totalTranscodedBytes: 500000n,
        probedDuration: 10,
        masterPlaylistContent: '#EXTM3U\n#EXT-X-VERSION:3\n',
      }),
    };

    mockStorage = {
      downloadObjectToFile: jest
        .fn()
        .mockImplementation(async (key: string, filePath: string) => {
          fs.writeFileSync(filePath, 'dummy video binary content');
          return true;
        }),
      uploadDirectBuffer: jest.fn().mockResolvedValue({ success: true, key: 'test-key' }),
      getDefaultBucketId: jest.fn().mockReturnValue('bucket-1'),
      getPublicUrl: jest.fn((key: string) => `https://cdn.vedora.com/${key}`),
    };

    const mockConfig = {
      get: jest.fn((key: string, def?: any) => {
        if (key === 'transcoder.webhookSecret') return 'valid_secret_with_at_least_32_characters_ok';
        return def;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscoderService,
        TranscoderProcessor,
        { provide: DRIZZLE_DB, useValue: mockDb },
        { provide: RedisService, useValue: mockRedis },
        { provide: FfmpegService, useValue: mockFfmpeg },
        { provide: StorageService, useValue: mockStorage },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    transcoderService = module.get<TranscoderService>(TranscoderService);
    transcoderProcessor = module.get<TranscoderProcessor>(TranscoderProcessor);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe('1. APP_ROLE Role Isolation', () => {
    it('should skip queue polling and sweeper when APP_ROLE=api', async () => {
      process.env.APP_ROLE = 'api';
      const processSpy = jest.spyOn(transcoderService, 'processNextJob').mockResolvedValue(false);
      const sweepSpy = jest.spyOn(transcoderService, 'recoverStuckJobs').mockResolvedValue([]);

      await transcoderProcessor.handleQueuePolling();
      await transcoderProcessor.handleRecoverySweeper();

      expect(processSpy).not.toHaveBeenCalled();
      expect(sweepSpy).not.toHaveBeenCalled();
    });

    it('should execute queue polling and sweeper when APP_ROLE=worker', async () => {
      process.env.APP_ROLE = 'worker';
      const processSpy = jest.spyOn(transcoderService, 'processNextJob').mockResolvedValue(false);
      const sweepSpy = jest.spyOn(transcoderService, 'recoverStuckJobs').mockResolvedValue([]);

      await transcoderProcessor.handleQueuePolling();
      await transcoderProcessor.handleRecoverySweeper();

      expect(processSpy).toHaveBeenCalledTimes(1);
      expect(sweepSpy).toHaveBeenCalledTimes(1);
    });

    it('should default to monolith role behavior when APP_ROLE is unset', async () => {
      delete process.env.APP_ROLE;
      const processSpy = jest.spyOn(transcoderService, 'processNextJob').mockResolvedValue(false);

      await transcoderProcessor.handleQueuePolling();

      expect(processSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. Atomic Enqueue Marker & Concurrency Fencing', () => {
    it('should atomically transition enqueue_state to enqueued and push to Redis', async () => {
      const enqueued = await transcoderService.enqueueTranscodeJob({
        videoId: 'vid-atomic-1',
        userId: 'user-1',
        storageKey: 'raw/vid.mp4',
        resolutions: ['720p'],
        title: 'Atomic Test',
        slug: 'atomic-test',
        duration: 10,
      });

      expect(enqueued).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          enqueue_state: 'enqueued',
          active_job_id: 'vdr_job_vid-atomic-1_1',
          attempt: 1,
        }),
      );
      expect(mockRedis.rpush).toHaveBeenCalledWith(
        QUEUE_KEY,
        expect.stringContaining('"jobId":"vdr_job_vid-atomic-1_1"'),
      );
    });

    it('should reject duplicate concurrent enqueue when database update returns no row', async () => {
      // Simulate Drizzle update returning empty array (row already enqueued)
      mockDb.returning.mockResolvedValueOnce([]);

      const enqueued = await transcoderService.enqueueTranscodeJob({
        videoId: 'vid-concurrent-1',
        userId: 'user-1',
        storageKey: 'raw/vid.mp4',
        resolutions: ['720p'],
        title: 'Concurrent Test',
        slug: 'concurrent-test',
        duration: 10,
      });

      expect(enqueued).toBe(false);
      expect(mockRedis.rpush).not.toHaveBeenCalled();
    });

    it('should revert enqueue_state to pending if Redis push throws connection error', async () => {
      mockRedis.rpush.mockRejectedValueOnce(new Error('Redis connection refused: ECONNREFUSED'));

      const enqueued = await transcoderService.enqueueTranscodeJob({
        videoId: 'vid-redis-fail-1',
        userId: 'user-1',
        storageKey: 'raw/vid.mp4',
        resolutions: ['720p'],
        title: 'Fail Test',
        slug: 'fail-test',
        duration: 10,
      });

      expect(enqueued).toBe(false);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          enqueue_state: 'pending',
          active_job_id: null,
        }),
      );
    });
  });

  describe('3. Database Fencing on Claim & Ready', () => {
    it('should abort execution if worker is fenced out on claim (attempt mismatch)', async () => {
      // Simulate fenced claim failing (e.g. attempt incremented by recovery sweeper)
      mockDb.returning.mockResolvedValueOnce([]); // fencedClaim returns empty

      await transcoderService.executeTranscoding({
        jobId: 'vdr_job_vid-fence-1_1',
        videoId: 'vid-fence-1',
        userId: 'user-1',
        storageKey: 'raw/vid.mp4',
        resolutions: ['720p'],
        attempt: 1,
        title: 'Fence Test',
        slug: 'fence-test',
        duration: 10,
      });

      // Child process should never be spawned, storage download never called
      expect(mockStorage.downloadObjectToFile).not.toHaveBeenCalled();
      expect(mockRedis.releaseLock).toHaveBeenCalled();
    });

    it('should abort execution and release lock if worker is fenced out on claim (video status not claimable)', async () => {
      // Worker B claims Redis lock, but DB claim returns 0 rows because video is already ready or failed
      mockDb.returning.mockResolvedValueOnce([]);

      await transcoderService.executeTranscoding({
        jobId: 'vdr_job_vid-fence-unclaimable_1',
        videoId: 'vid-fence-unclaimable',
        userId: 'user-1',
        storageKey: 'raw/vid.mp4',
        resolutions: ['720p'],
        attempt: 1,
        title: 'Unclaimable Test',
        slug: 'unclaimable-test',
        duration: 10,
      });

      expect(mockStorage.downloadObjectToFile).not.toHaveBeenCalled();
      expect(mockRedis.releaseLock).toHaveBeenCalled();
    });

    it('should throw and prevent commit if attempt fencing fails on ready transition', async () => {
      // First returning (claim) succeeds, second returning (ready transition) returns empty
      mockDb.returning
        .mockResolvedValueOnce([{ id: 'vid-fence-2' }]) // claim succeeds
        .mockResolvedValueOnce([]); // ready transition fenced out!

      await expect(
        transcoderService.executeTranscoding({
          jobId: 'vdr_job_vid-fence-2_1',
          videoId: 'vid-fence-2',
          userId: 'user-1',
          storageKey: 'raw/vid.mp4',
          resolutions: ['720p'],
          attempt: 1,
          title: 'Fence Ready Test',
          slug: 'fence-ready-test',
          duration: 10,
        }),
      ).rejects.toThrow('Database fencing prevented commit');

      // Database should NOT have committed ready
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
        }),
      );
    });
  });

  describe('4. Heartbeat Renewal Failure & Child Process Cancellation', () => {
    it('should abort and terminate child process if lock renewal returns false', async () => {
      jest.useFakeTimers();

      mockRedis.renewLock.mockResolvedValueOnce(false);

      // Start transcoding with a long mock
      let resolveTranscode: (val: any) => void = () => {};
      const transcodePromise = new Promise((resolve) => {
        resolveTranscode = resolve;
      });
      mockFfmpeg.transcodeToHls.mockReturnValueOnce(transcodePromise);

      const executionPromise = transcoderService.executeTranscoding({
        jobId: 'vdr_job_vid-renew-fail_1',
        videoId: 'vid-renew-fail',
        userId: 'user-1',
        storageKey: 'raw/vid.mp4',
        resolutions: ['720p'],
        attempt: 1,
        title: 'Renew Fail',
        slug: 'renew-fail',
        duration: 10,
      });

      // Advance clock by 30 seconds to trigger heartbeat renewal
      await jest.advanceTimersByTimeAsync(30_500);

      expect(mockFfmpeg.terminateActiveProcess).toHaveBeenCalledWith('vid-renew-fail', 5000);

      resolveTranscode({
        generatedFiles: [],
        totalTranscodedBytes: 500000n,
        probedDuration: 10,
        masterPlaylistContent: '#EXTM3U\n',
      });

      await expect(executionPromise).rejects.toThrow('Lock lost');

      jest.useRealTimers();
    });

    it('should abort and terminate child process if database heartbeat lease renewal is fenced out', async () => {
      jest.useFakeTimers();

      mockRedis.renewLock.mockResolvedValueOnce(true); // Redis renewal succeeds
      // First returning (claim) succeeds, second returning (heartbeat renewal update) returns empty
      mockDb.returning
        .mockResolvedValueOnce([{ id: 'vid-renew-db-fail' }])
        .mockResolvedValueOnce([]); // DB heartbeat renewal fenced out

      let resolveTranscode: (val: any) => void = () => {};
      const transcodePromise = new Promise((resolve) => {
        resolveTranscode = resolve;
      });
      mockFfmpeg.transcodeToHls.mockReturnValueOnce(transcodePromise);

      const executionPromise = transcoderService.executeTranscoding({
        jobId: 'vdr_job_vid-renew-db-fail_1',
        videoId: 'vid-renew-db-fail',
        userId: 'user-1',
        storageKey: 'raw/vid.mp4',
        resolutions: ['720p'],
        attempt: 1,
        title: 'Renew DB Fail',
        slug: 'renew-db-fail',
        duration: 10,
      });

      // Advance clock by 30 seconds to trigger heartbeat renewal
      await jest.advanceTimersByTimeAsync(30_500);

      expect(mockFfmpeg.terminateActiveProcess).toHaveBeenCalledWith('vid-renew-db-fail', 5000);

      resolveTranscode({
        generatedFiles: [],
        totalTranscodedBytes: 500000n,
        probedDuration: 10,
        masterPlaylistContent: '#EXTM3U\n',
      });

      await expect(executionPromise).rejects.toThrow('Lock lost');

      jest.useRealTimers();
    });
  });

  describe('5. Graceful Shutdown & Child Process Await', () => {
    it('should mark service shutting down and await active child process termination', async () => {
      // Artificially simulate active video transcoding
      (transcoderService as any).activeVideoId = 'active-proc-video';

      await transcoderService.shutdown('SIGTERM');

      expect(mockFfmpeg.terminateActiveProcess).toHaveBeenCalledWith('active-proc-video', 10000);
      expect((transcoderService as any).isShuttingDown).toBe(true);
    });
  });

  describe('6. Expired Worker Lease Recovery & Maximum Retries', () => {
    it('should re-enqueue expired lease up to 3 attempts with incremented attempt', async () => {
      mockDb.limit
        .mockResolvedValueOnce([]) // Step 1: stale dispatches
        .mockResolvedValueOnce([]) // Step 2: stranded uploads
        .mockResolvedValueOnce([   // Step 3: expired lease with attempt 1
          {
            id: 'expired-lease-vid',
            user_id: 'user_1',
            status: 'processing',
            attempt: 1,
            storage_key: 'raw/vid.mp4',
            resolutions: ['720p'],
            title: 'Expired Video',
            slug: 'expired-video',
            duration: 10,
          },
        ]);
      mockRedis.get.mockResolvedValueOnce(null); // Lock expired

      const recovered = await transcoderService.recoverStuckJobs();

      expect(recovered).toContain('expired-lease-vid');
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 2,
          active_job_id: 'vdr_job_expired-lease-vid_2',
          enqueue_state: 'enqueued',
        }),
      );
      expect(mockRedis.rpush).toHaveBeenCalledWith(
        QUEUE_KEY,
        expect.stringContaining('"attempt":2'),
      );
    });

    it('should transition video to terminal failed status when lease expires at attempt 3', async () => {
      mockDb.limit
        .mockResolvedValueOnce([]) // Step 1: stale dispatches
        .mockResolvedValueOnce([]) // Step 2: stranded uploads
        .mockResolvedValueOnce([   // Step 3: expired lease with attempt 3
          {
            id: 'max-retry-vid',
            user_id: 'user_1',
            status: 'processing',
            attempt: 3,
            storage_key: 'raw/vid.mp4',
            resolutions: ['720p'],
            title: 'Max Video',
            slug: 'max-video',
            duration: 10,
          },
        ]);
      mockRedis.get.mockResolvedValueOnce(null); // Lock expired

      const recovered = await transcoderService.recoverStuckJobs();

      expect(recovered).toContain('max-retry-vid');
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          last_error: 'Transcoding job exceeded maximum 3 retry attempts',
          attempt: 3,
          enqueue_state: 'pending',
        }),
      );
    });
  });

  describe('7. P0.1 Database Fencing on Failure Transitions (Worker, Webhook, Sweeper)', () => {
    it('should reject worker failure transition when ownerToken is missing or empty', async () => {
      const marked1 = await transcoderService.markWorkerJobFailed('vid-no-token', 'Missing token', 1, '');
      const marked2 = await transcoderService.markWorkerJobFailed('vid-no-token', 'Whitespace token', 1, '   ');

      expect(marked1).toBe(false);
      expect(marked2).toBe(false);
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should reject failure transition when video is in uploaded status (status != processing)', async () => {
      // Drizzle update with status='processing' condition matches 0 rows when status is 'uploaded'
      mockDb.returning.mockResolvedValueOnce([]);

      const marked = await transcoderService.markWorkerJobFailed('vid-uploaded', 'Stale failure', 1, 'token-1');

      expect(marked).toBe(false);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          attempt: 1,
        }),
      );
    });

    it('should reject failure transition when video is already in ready status', async () => {
      // Drizzle update matches 0 rows when video is already ready
      mockDb.returning.mockResolvedValueOnce([]);

      const marked = await transcoderService.markWorkerJobFailed('vid-ready-overwrite', 'Late failure', 1, 'token-1');

      expect(marked).toBe(false);
    });

    it('should reject failure transition when video is already in failed status', async () => {
      // Drizzle update matches 0 rows when status is already failed
      mockDb.returning.mockResolvedValueOnce([]);

      const marked = await transcoderService.markWorkerJobFailed('vid-already-failed', 'Duplicate failure', 1, 'token-1');

      expect(marked).toBe(false);
    });

    it('should reject failure update if attempt 1 attempts to mark failed after attempt 2 took ownership', async () => {
      mockDb.returning.mockResolvedValueOnce([]);

      const marked = await transcoderService.markWorkerJobFailed('vid-stale-attempt', 'Worker crash', 1, 'token-1');

      expect(marked).toBe(false);
    });

    it('should reject failure update from stale worker A when worker B superseded ownership for same attempt', async () => {
      // Worker A attempts to mark failed using stale ownerToken 'token-worker-A'
      // DB condition eq(schema.videos.active_job_id, 'token-worker-A') returns 0 rows because active_job_id is now 'token-worker-B'
      mockDb.returning.mockResolvedValueOnce([]);

      const marked = await transcoderService.markWorkerJobFailed(
        'vid-same-attempt-stale',
        'Worker A failed after lock lost',
        1,
        'token-worker-A',
      );

      expect(marked).toBe(false);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          attempt: 1,
        }),
      );
    });

    it('should reject worker failure transition when heartbeat lease is expired even if token matches', async () => {
      // Drizzle query matching gt(schema.videos.heartbeat_lease, new Date()) returns empty if lease expired
      mockDb.returning.mockResolvedValueOnce([]);

      const marked = await transcoderService.markWorkerJobFailed(
        'vid-expired-lease',
        'Worker failed after lease expiry',
        1,
        'token-worker-A',
      );

      expect(marked).toBe(false);
    });

    it('should allow current worker with matching ownerToken and valid lease to mark video failed', async () => {
      mockDb.returning.mockResolvedValueOnce([{ id: 'vid-same-attempt-valid' }]);

      const marked = await transcoderService.markWorkerJobFailed(
        'vid-same-attempt-valid',
        'Worker B encounters genuine error',
        1,
        'token-worker-B',
      );

      expect(marked).toBe(true);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          attempt: 1,
          last_error: 'Worker B encounters genuine error',
        }),
      );
    });

    it('should allow current worker to correctly mark its own failed attempt via markVideoFailed wrapper', async () => {
      mockDb.returning.mockResolvedValueOnce([{ id: 'vid-valid-fail' }]);

      const marked = await transcoderService.markVideoFailed('vid-valid-fail', 'Real transcode error', 2, 'token-worker-2');

      expect(marked).toBe(true);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          attempt: 2,
          last_error: 'Real transcode error',
        }),
      );
    });

    it('should reject cloud transcoder webhook failure when active worker holds a valid heartbeat lease', async () => {
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 'vid-webhook-active-worker',
          user_id: 'user_1',
          status: 'processing',
          attempt: 2,
          master_m3u8_key: null,
        },
      ]);
      // Active worker lease prevents webhook from updating: returning returns empty
      mockDb.returning.mockResolvedValueOnce([]);

      const payloadObj = {
        videoId: 'vid-webhook-active-worker',
        status: 'failed',
        errorMessage: 'Spurious webhook failure',
        attempt: 2,
      };
      const rawPayload = JSON.stringify(payloadObj);
      const sig = `sha256=${crypto.createHmac('sha256', 'valid_secret_with_at_least_32_characters_ok').update(rawPayload).digest('hex')}`;

      const res = await transcoderService.handleWebhook(sig, rawPayload, payloadObj as any);

      expect(res.success).toBe(false);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          attempt: 2,
        }),
      );
    });

    it('should allow cloud transcoder webhook failure when heartbeat lease is null or expired', async () => {
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 'vid-webhook-fail',
          user_id: 'user_1',
          status: 'processing',
          attempt: 2,
          master_m3u8_key: null,
        },
      ]);
      mockDb.returning.mockResolvedValueOnce([{ id: 'vid-webhook-fail' }]);

      const markSpy = jest.spyOn(transcoderService, 'markWebhookJobFailed');

      const payloadObj = {
        videoId: 'vid-webhook-fail',
        status: 'failed',
        errorMessage: 'FFmpeg segfault in cloud worker',
        attempt: 2,
      };
      const rawPayload = JSON.stringify(payloadObj);
      const sig = `sha256=${crypto.createHmac('sha256', 'valid_secret_with_at_least_32_characters_ok').update(rawPayload).digest('hex')}`;

      const res = await transcoderService.handleWebhook(sig, rawPayload, payloadObj as any);

      expect(res.success).toBe(false);
      expect(markSpy).toHaveBeenCalledWith('vid-webhook-fail', 'FFmpeg segfault in cloud worker', 2);
    });

    it('should reject webhook when attempt is missing from payload', async () => {
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 'vid-webhook-missing-attempt',
          user_id: 'user_1',
          status: 'processing',
          attempt: 1,
          master_m3u8_key: null,
        },
      ]);
      const payloadObj = {
        videoId: 'vid-webhook-missing-attempt',
        status: 'completed',
        masterKey: 'videos/vid-webhook-missing-attempt/master.m3u8',
        totalDuration: 60,
        renditions: ['720p'],
        transcodedSize: 1000000,
      };
      const rawPayload = JSON.stringify(payloadObj);
      const sig = `sha256=${crypto.createHmac('sha256', 'valid_secret_with_at_least_32_characters_ok').update(rawPayload).digest('hex')}`;

      await expect(
        transcoderService.handleWebhook(sig, rawPayload, payloadObj as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject webhook when attempt is non-positive or not an integer', async () => {
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 'vid-webhook-invalid-attempt',
          user_id: 'user_1',
          status: 'processing',
          attempt: 1,
          master_m3u8_key: null,
        },
      ]);
      const payloadObj = {
        videoId: 'vid-webhook-invalid-attempt',
        status: 'completed',
        masterKey: 'videos/vid-webhook-invalid-attempt/master.m3u8',
        totalDuration: 60,
        renditions: ['720p'],
        transcodedSize: 1000000,
        attempt: 0, // non-positive
      };
      const rawPayload = JSON.stringify(payloadObj);
      const sig = `sha256=${crypto.createHmac('sha256', 'valid_secret_with_at_least_32_characters_ok').update(rawPayload).digest('hex')}`;

      await expect(
        transcoderService.handleWebhook(sig, rawPayload, payloadObj as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject webhook success while a local worker has a valid lease and active lock', async () => {
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 'vid-webhook-success-active-worker',
          user_id: 'user_1',
          status: 'processing',
          attempt: 1,
          master_m3u8_key: null,
          heartbeat_lease: new Date(Date.now() + 60_000), // active lease
        },
      ]);
      mockRedis.get.mockResolvedValueOnce('active-worker-token'); // worker holds Redis lock

      const payloadObj = {
        videoId: 'vid-webhook-success-active-worker',
        status: 'completed',
        masterKey: 'videos/vid-webhook-success-active-worker/master.m3u8',
        totalDuration: 60,
        renditions: ['720p'],
        transcodedSize: 1000000,
        attempt: 1,
      };
      const rawPayload = JSON.stringify(payloadObj);
      const sig = `sha256=${crypto.createHmac('sha256', 'valid_secret_with_at_least_32_characters_ok').update(rawPayload).digest('hex')}`;

      const res = await transcoderService.handleWebhook(sig, rawPayload, payloadObj as any);

      expect(res.success).toBe(false);
      expect(res.message).toContain('Fenced out: active local worker is currently processing this video');
      // DB update for ready was not committed
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should allow webhook success after the worker lease expires or for external cloud job', async () => {
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 'vid-webhook-success-expired-lease',
          user_id: 'user_1',
          status: 'processing',
          attempt: 1,
          master_m3u8_key: null,
          heartbeat_lease: new Date(Date.now() - 10_000), // expired lease
        },
      ]);
      mockRedis.get.mockResolvedValueOnce(null); // no active Redis lock
      mockDb.returning.mockResolvedValueOnce([{ id: 'vid-webhook-success-expired-lease' }]);

      const payloadObj = {
        videoId: 'vid-webhook-success-expired-lease',
        status: 'completed',
        masterKey: 'videos/vid-webhook-success-expired-lease/master.m3u8',
        totalDuration: 90,
        renditions: ['720p'],
        transcodedSize: 2000000,
        attempt: 1,
      };
      const rawPayload = JSON.stringify(payloadObj);
      const sig = `sha256=${crypto.createHmac('sha256', 'valid_secret_with_at_least_32_characters_ok').update(rawPayload).digest('hex')}`;

      const res = await transcoderService.handleWebhook(sig, rawPayload, payloadObj as any);

      expect(res.success).toBe(true);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ready',
          master_m3u8_key: 'videos/vid-webhook-success-expired-lease/master.m3u8',
          active_job_id: null,
          enqueue_state: 'pending',
        }),
      );
    });

    it('should reject stale webhook success from an older attempt', async () => {
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 'vid-webhook-stale-attempt',
          user_id: 'user_1',
          status: 'processing',
          attempt: 2, // Database is on attempt 2
          master_m3u8_key: null,
          heartbeat_lease: null,
        },
      ]);
      mockRedis.get.mockResolvedValueOnce(null);
      // DB update condition attempt=1 returns 0 rows because DB row has attempt=2
      mockDb.returning.mockResolvedValueOnce([]);

      const payloadObj = {
        videoId: 'vid-webhook-stale-attempt',
        status: 'completed',
        masterKey: 'videos/vid-webhook-stale-attempt/master.m3u8',
        totalDuration: 45,
        renditions: ['720p'],
        transcodedSize: 500000,
        attempt: 1, // Stale webhook reporting attempt 1
      };
      const rawPayload = JSON.stringify(payloadObj);
      const sig = `sha256=${crypto.createHmac('sha256', 'valid_secret_with_at_least_32_characters_ok').update(rawPayload).digest('hex')}`;

      const res = await transcoderService.handleWebhook(sig, rawPayload, payloadObj as any);

      expect(res.success).toBe(false);
      expect(res.message).toContain('Fenced out');
    });

    it('should allow local worker to complete successfully after a rejected webhook attempt', async () => {
      const vidId = 'vid-worker-after-webhook';
      const lockKey = CACHE_KEYS.transcodeLock(vidId);

      // 1. Worker claims row
      mockDb.returning.mockResolvedValueOnce([{ id: vidId }]); // claim succeeds

      // 2. An intervening webhook arrives while worker is processing
      mockDb.limit.mockResolvedValueOnce([
        {
          id: vidId,
          user_id: 'user_1',
          status: 'processing',
          attempt: 1,
          master_m3u8_key: null,
          heartbeat_lease: new Date(Date.now() + 60_000), // active worker lease
        },
      ]);
      // In-memory lock has worker lock
      inMemoryLocks.set(lockKey, 'worker-token-123');

      const webhookPayload = {
        videoId: vidId,
        status: 'completed',
        masterKey: `videos/${vidId}/master.m3u8`,
        totalDuration: 30,
        renditions: ['720p'],
        transcodedSize: 100000,
        attempt: 1,
      };
      const rawPayload = JSON.stringify(webhookPayload);
      const sig = `sha256=${crypto.createHmac('sha256', 'valid_secret_with_at_least_32_characters_ok').update(rawPayload).digest('hex')}`;

      // Webhook is rejected
      const webhookRes = await transcoderService.handleWebhook(sig, rawPayload, webhookPayload as any);
      expect(webhookRes.success).toBe(false);

      // 3. Local worker finishes transcoding and commits ready
      mockDb.returning.mockResolvedValueOnce([{ id: vidId }]); // ready commit succeeds

      await expect(
        transcoderService.executeTranscoding({
          jobId: `vdr_job_${vidId}_1`,
          videoId: vidId,
          userId: 'user-1',
          storageKey: 'raw/vid.mp4',
          resolutions: ['720p'],
          attempt: 1,
          title: 'Worker After Webhook',
          slug: 'worker-after-webhook',
          duration: 30,
        }),
      ).resolves.not.toThrow();

      // Worker verified files, uploaded direct buffer, and set ready
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ready',
          master_m3u8_key: `videos/${vidId}/master.m3u8`,
        }),
      );
    });
  });

  describe('8. P0.2 Graceful Shutdown Job Recovery', () => {
    it('should not mark video failed when worker receives SIGTERM during processing', async () => {
      const markSpy = jest.spyOn(transcoderService, 'markWorkerJobFailed');

      // Make transcodeToHls trigger shutdown midway
      mockFfmpeg.transcodeToHls.mockImplementationOnce(async () => {
        await transcoderService.shutdown('SIGTERM');
        throw new Error('Process killed: SIGTERM');
      });

      await expect(
        transcoderService.executeTranscoding({
          jobId: 'vdr_job_vid-sigterm_1',
          videoId: 'vid-sigterm',
          userId: 'user-1',
          storageKey: 'raw/vid.mp4',
          resolutions: ['720p'],
          attempt: 1,
          title: 'Sigterm Test',
          slug: 'sigterm-test',
        }),
      ).rejects.toThrow();

      // markVideoFailed should NOT be called on shutdown
      expect(markSpy).not.toHaveBeenCalled();
    });

    it('should preserve attempt and active_job_id and keep job recoverable on shutdown', async () => {
      (transcoderService as any).isShuttingDown = true;

      mockFfmpeg.transcodeToHls.mockRejectedValueOnce(new Error('Process terminated'));

      await expect(
        transcoderService.executeTranscoding({
          jobId: 'vdr_job_vid-recoverable_1',
          videoId: 'vid-recoverable',
          userId: 'user-1',
          storageKey: 'raw/vid.mp4',
          resolutions: ['720p'],
          attempt: 1,
          title: 'Recoverable Test',
          slug: 'recoverable-test',
        }),
      ).rejects.toThrow();

      // Reset to enqueued with null heartbeat lease, preserving attempt 1
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          enqueue_state: 'enqueued',
          heartbeat_lease: null,
        }),
      );
    });

    it('should await FFmpeg termination before releasing distributed lock', async () => {
      const callOrder: string[] = [];
      mockFfmpeg.terminateActiveProcess.mockImplementationOnce(async () => {
        callOrder.push('terminateActiveProcess');
        return true;
      });
      mockRedis.releaseLock.mockImplementationOnce(async () => {
        callOrder.push('releaseLock');
        return true;
      });

      (transcoderService as any).isShuttingDown = true;
      mockFfmpeg.transcodeToHls.mockRejectedValueOnce(new Error('Interrupted'));

      await expect(
        transcoderService.executeTranscoding({
          jobId: 'vdr_job_vid-order_1',
          videoId: 'vid-order',
          userId: 'user-1',
          storageKey: 'raw/vid.mp4',
          resolutions: ['720p'],
          attempt: 1,
          title: 'Order Test',
          slug: 'order-test',
        }),
      ).rejects.toThrow();

      expect(callOrder).toEqual(['terminateActiveProcess', 'releaseLock']);
    });

    it('should safely requeue job to QUEUE_KEY from PROCESSING_QUEUE_KEY on shutdown in processNextJob', async () => {
      const sampleJob = {
        jobId: 'vdr_job_vid-requeue_1',
        videoId: 'vid-requeue',
        userId: 'user-1',
        storageKey: 'raw/vid.mp4',
        resolutions: ['720p'],
        attempt: 1,
        title: 'Requeue Test',
        slug: 'requeue-test',
      };
      const rawJob = JSON.stringify(sampleJob);

      mockRedis.rpoplpush.mockResolvedValueOnce(rawJob);
      // Simulate shutdown occurring while executeTranscoding is executing
      jest.spyOn(transcoderService, 'executeTranscoding').mockImplementationOnce(async () => {
        (transcoderService as any).isShuttingDown = true;
        throw new Error('Interrupted by SIGTERM');
      });

      await transcoderService.processNextJob();

      // Should rpush rawJob back to QUEUE_KEY before removing from PROCESSING_QUEUE_KEY
      expect(mockRedis.rpush).toHaveBeenCalledWith(QUEUE_KEY, rawJob);
      expect(mockRedis.lrem).toHaveBeenCalledWith(PROCESSING_QUEUE_KEY, 1, rawJob);
    });

    it('should handle repeated shutdown signals idempotently', async () => {
      (transcoderService as any).activeVideoId = 'vid-idempotent';

      await transcoderService.shutdown('SIGTERM');
      await transcoderService.shutdown('SIGINT');

      // terminateActiveProcess should only be invoked once
      expect(mockFfmpeg.terminateActiveProcess).toHaveBeenCalledTimes(1);
    });
  });

  describe('9. P1.1 Concurrent Sweeper Recovery Fencing', () => {
    it('should ensure exactly one sweeper enqueues next attempt when two sweepers race', async () => {
      const expiredVid = {
        id: 'vid-concurrent-sweeper',
        user_id: 'user_1',
        status: 'processing',
        attempt: 1,
        storage_key: 'raw/vid.mp4',
        resolutions: ['720p'],
        title: 'Sweeper Race',
        slug: 'sweeper-race',
        duration: 10,
      };

      // Sweeper 1 setup: DB returns updated row
      mockDb.limit
        .mockResolvedValueOnce([]) // Step 1
        .mockResolvedValueOnce([]) // Step 2
        .mockResolvedValueOnce([expiredVid]); // Step 3
      mockRedis.get.mockResolvedValueOnce(null); // No lock
      mockDb.returning.mockResolvedValueOnce([{ id: expiredVid.id }]); // Sweeper 1 wins race

      const recovered1 = await transcoderService.recoverStuckJobs();
      expect(recovered1).toContain(expiredVid.id);
      expect(mockRedis.rpush).toHaveBeenCalledWith(
        QUEUE_KEY,
        expect.stringContaining('"attempt":2'),
      );

      // Reset mock counts
      jest.clearAllMocks();

      // Sweeper 2 setup: DB returns empty array (row attempt was already changed to 2 by Sweeper 1)
      mockDb.limit
        .mockResolvedValueOnce([]) // Step 1
        .mockResolvedValueOnce([]) // Step 2
        .mockResolvedValueOnce([expiredVid]); // Step 3 (stale snapshot before commit)
      mockRedis.get.mockResolvedValueOnce(null); // No lock
      mockDb.returning.mockResolvedValueOnce([]); // Sweeper 2 fenced out!

      const recovered2 = await transcoderService.recoverStuckJobs();
      expect(recovered2).not.toContain(expiredVid.id);
      // Sweeper 2 must NOT push to Redis
      expect(mockRedis.rpush).not.toHaveBeenCalled();
    });

    it('should conditionally update DB before re-enqueuing in processing queue recovery (Step 4)', async () => {
      const interruptedJob = {
        jobId: 'vdr_job_proc-rec-vid_1',
        videoId: 'proc-rec-vid',
        userId: 'user-1',
        storageKey: 'raw/vid.mp4',
        resolutions: ['720p'],
        attempt: 1,
        title: 'Proc Rec',
        slug: 'proc-rec',
        duration: 10,
      };
      const rawJob = JSON.stringify(interruptedJob);

      mockDb.limit
        .mockResolvedValueOnce([]) // Step 1
        .mockResolvedValueOnce([]) // Step 2
        .mockResolvedValueOnce([]) // Step 3
        .mockResolvedValueOnce([{ status: 'processing', attempt: 1 }]); // Step 4 select video

      mockRedis.lrange
        .mockResolvedValueOnce([rawJob]); // Step 4 inFlight

      mockRedis.get.mockResolvedValueOnce(null); // No active lock
      mockDb.returning.mockResolvedValueOnce([]); // DB conditional update fails (0 rows, e.g. already incremented)

      const recovered = await transcoderService.recoverStuckJobs();

      expect(recovered).not.toContain('proc-rec-vid');
      // Must remove stale payload from processing queue but NOT push to transcode queue
      expect(mockRedis.lrem).toHaveBeenCalledWith(PROCESSING_QUEUE_KEY, 1, rawJob);
      expect(mockRedis.rpush).not.toHaveBeenCalled();
    });
  });

  describe('10. P1.2 Pre-Upload & Upload Loop Distributed Lock Verification', () => {
    it('should abort execution if lock ownership is lost immediately before R2 uploads', async () => {
      // Simulate lock loss before upload: mockRedis.get returns null
      mockRedis.get.mockResolvedValueOnce(null);

      await expect(
        transcoderService.executeTranscoding({
          jobId: 'vdr_job_vid-pre-upload-lock_1',
          videoId: 'vid-pre-upload-lock',
          userId: 'user-1',
          storageKey: 'raw/vid.mp4',
          resolutions: ['720p'],
          attempt: 1,
          title: 'Pre-Upload Lock',
          slug: 'pre-upload-lock',
        }),
      ).rejects.toThrow('Distributed lock lost for video vid-pre-upload-lock prior to R2 storage upload.');

      expect(mockStorage.uploadDirectBuffer).not.toHaveBeenCalled();
    });

    it('should abort execution and prevent R2 uploads if Redis is unavailable or throws during lock verification', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('Redis connection refused: ECONNREFUSED'));

      await expect(
        transcoderService.executeTranscoding({
          jobId: 'vdr_job_vid-redis-down-lock_1',
          videoId: 'vid-redis-down-lock',
          userId: 'user-1',
          storageKey: 'raw/vid.mp4',
          resolutions: ['720p'],
          attempt: 1,
          title: 'Redis Down Lock',
          slug: 'redis-down-lock',
        }),
      ).rejects.toThrow('Distributed lock lost for video vid-redis-down-lock prior to R2 storage upload.');

      expect(mockStorage.uploadDirectBuffer).not.toHaveBeenCalled();
    });

    it('should abort execution if lock ownership is lost during R2 file uploads', async () => {
      const dummyFilePath = path.join(os.tmpdir(), 'dummy-segment.ts');
      fs.writeFileSync(dummyFilePath, 'dummy MPEG-TS data');

      mockFfmpeg.transcodeToHls.mockResolvedValueOnce({
        generatedFiles: [
          {
            absolutePath: dummyFilePath,
            relativePath: '720p/segment_000.ts',
            contentType: 'video/mp2t',
          },
        ],
        totalTranscodedBytes: 1000n,
        probedDuration: 8,
        masterPlaylistContent: '#EXTM3U\n',
      });

      // Override get during upload loop to return stolen token
      let getCalls = 0;
      mockRedis.get.mockImplementation((k: string) => {
        getCalls++;
        if (getCalls === 1) {
          // Pre-upload check: returns valid token stored by setnxWithExpiry
          return Promise.resolve(inMemoryLocks.get(k) || null);
        }
        return Promise.resolve('stolen-lock-token');
      });

      await expect(
        transcoderService.executeTranscoding({
          jobId: 'vdr_job_vid-during-upload-lock_1',
          videoId: 'vid-during-upload-lock',
          userId: 'user-1',
          storageKey: 'raw/vid.mp4',
          resolutions: ['720p'],
          attempt: 1,
          title: 'During-Upload Lock',
          slug: 'during-upload-lock',
        }),
      ).rejects.toThrow('Distributed lock lost');

      if (fs.existsSync(dummyFilePath)) {
        fs.unlinkSync(dummyFilePath);
      }
    });
  });
});
