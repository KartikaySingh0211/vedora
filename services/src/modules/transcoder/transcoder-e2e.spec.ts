import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TranscoderService } from './transcoder.service';
import { FfmpegService } from './ffmpeg.service';
import { DRIZZLE_DB } from '../../database/database.module';
import { RedisService } from '../../infra/redis/redis.service';
import { StorageService } from '../../infra/storage/storage.service';

describe('TranscoderService Real FFmpeg Pipeline', () => {
  let service: TranscoderService;
  let ffmpegService: FfmpegService;
  let mockDb: any;
  let mockRedisService: any;
  let storageService: StorageService;
  let tmpDir: string;
  let realVideoKey: string;
  let realVideoPath: string;

  beforeAll(() => {
    tmpDir = path.join(os.tmpdir(), `vedora-transcoder-e2e-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Create objects storage directory
    const objectsDir = path.join(process.cwd(), 'storage_local', 'objects');
    fs.mkdirSync(objectsDir, { recursive: true });

    realVideoKey = `raw/test-bucket/${Date.now()}-real-sample.mp4`;
    realVideoPath = path.join(objectsDir, realVideoKey.replace(/[/\\]/g, '_'));

    // Synthesize real 1-second 640x360 test video into local storage
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ffmpeg = require('@ffmpeg-installer/ffmpeg');
      cp.execFileSync(ffmpeg.path, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1:size=640x360:rate=30',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=1000:duration=1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        realVideoPath,
      ]);
    } catch (err: unknown) {
      console.warn('Could not generate sample video for e2e test:', err);
    }
  });

  afterAll(() => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      if (fs.existsSync(realVideoPath)) {
        fs.unlinkSync(realVideoPath);
      }
    } catch {
      // Best effort cleanup
    }
  });

  beforeEach(async () => {
    mockDb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          id: 'test-video-id-01',
          user_id: 'user_1',
          status: 'uploaded',
          master_m3u8_key: null,
          transcoded_size: null,
        },
      ]),
    };

    mockRedisService = {
      rpush: jest.fn().mockResolvedValue(1),
      lpop: jest.fn().mockResolvedValue(null),
      llen: jest.fn().mockResolvedValue(0),
      setnxWithExpiry: jest.fn().mockResolvedValue(true),
      del: jest.fn().mockResolvedValue(true),
      isHealthy: jest.fn().mockReturnValue(true),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultVal?: any) => {
        if (key === 'port') return 8080;
        return defaultVal;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscoderService,
        FfmpegService,
        StorageService,
        { provide: DRIZZLE_DB, useValue: mockDb },
        { provide: RedisService, useValue: mockRedisService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<TranscoderService>(TranscoderService);
    ffmpegService = module.get<FfmpegService>(FfmpegService);
    storageService = module.get<StorageService>(StorageService);
  });

  it('should process a real uploaded video file into HLS playlists and segments', async () => {
    if (!fs.existsSync(realVideoPath)) return;

    const uploadedBuffers: Record<string, Buffer> = {};
    jest
      .spyOn(storageService, 'uploadDirectBuffer')
      .mockImplementation(async (key, buf) => {
        uploadedBuffers[key] = buf;
        return { success: true, key };
      });

    await service.executeTranscoding({
      videoId: 'test-video-id-01',
      userId: 'user-01',
      storageKey: realVideoKey,
      resolutions: ['720p', '360p'],
      title: 'Real Sample Video',
      slug: 'real-sample-video',
      duration: 1,
    });

    // 1. Verify status transitions
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        master_m3u8_key: 'videos/test-video-id-01/master.m3u8',
      }),
    );

    // 2. Verify master manifest was uploaded and valid
    expect(uploadedBuffers['videos/test-video-id-01/master.m3u8']).toBeDefined();
    const masterText = uploadedBuffers[
      'videos/test-video-id-01/master.m3u8'
    ].toString('utf8');
    expect(masterText).toContain('#EXTM3U');
    expect(masterText).toContain('360p/index.m3u8');
    // 720p should not be present because source is 640x360 (no upscaling)
    expect(masterText).not.toContain('720p/index.m3u8');

    // 3. Verify variant playlist was uploaded
    expect(
      uploadedBuffers['videos/test-video-id-01/360p/index.m3u8'],
    ).toBeDefined();
    const variantText = uploadedBuffers[
      'videos/test-video-id-01/360p/index.m3u8'
    ].toString('utf8');
    expect(variantText).toContain('#EXT-X-TARGETDURATION');
    expect(variantText).toContain('segment_000.ts');

    // 4. Verify actual .ts segment was uploaded
    expect(
      uploadedBuffers['videos/test-video-id-01/360p/segment_000.ts'],
    ).toBeDefined();
    expect(
      uploadedBuffers['videos/test-video-id-01/360p/segment_000.ts'].length,
    ).toBeGreaterThan(0);
  });

  it('should mark video as failed and release lock when given a non-existent or corrupt file', async () => {
    await expect(
      service.executeTranscoding({
        videoId: 'corrupt-vid-id',
        userId: 'user-01',
        storageKey: 'raw/non-existent-video.mp4',
        resolutions: ['720p'],
        title: 'Corrupt Video',
        slug: 'corrupt-video',
        duration: 0,
      }),
    ).rejects.toThrow();

    // Verify video was marked failed
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
      }),
    );

    // Verify lock was released
    expect(mockRedisService.del).toHaveBeenCalled();
  });
});
