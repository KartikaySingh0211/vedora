import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FfmpegService, MediaProbeResult } from './ffmpeg.service';

describe('FfmpegService', () => {
  let service: FfmpegService;
  let tmpDir: string;
  let testVideoPath: string;
  let silentVideoPath: string;
  let corruptVideoPath: string;
  let audioOnlyPath: string;

  beforeAll(() => {
    tmpDir = path.join(os.tmpdir(), `vedora-ffmpeg-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    testVideoPath = path.join(tmpDir, 'test-with-audio.mp4');
    silentVideoPath = path.join(tmpDir, 'test-silent.mp4');
    corruptVideoPath = path.join(tmpDir, 'corrupt.mp4');
    audioOnlyPath = path.join(tmpDir, 'test-audio-only.aac');

    // Generate real 1-second synthetic video with audio
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
        testVideoPath,
      ]);

      // Generate real 1-second silent synthetic video (no audio stream)
      cp.execFileSync(ffmpeg.path, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1:size=640x360:rate=30',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-an',
        silentVideoPath,
      ]);

      // Generate real 1-second audio-only file (no video stream)
      cp.execFileSync(ffmpeg.path, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=1000:duration=1',
        '-c:a',
        'aac',
        '-vn',
        audioOnlyPath,
      ]);

      // Write corrupt file
      fs.writeFileSync(corruptVideoPath, Buffer.from('NOT A REAL MP4 FILE HEADER'));
    } catch (err: unknown) {
      console.warn('Could not generate synthetic test videos:', err);
    }
  });

  afterAll(() => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // Cleanup best effort
    }
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FfmpegService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(() => undefined),
          },
        },
      ],
    }).compile();

    service = module.get<FfmpegService>(FfmpegService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should locate valid ffmpeg and ffprobe executable paths', () => {
    const ffmpegPath = service.getFfmpegPath();
    const ffprobePath = service.getFfprobePath();

    expect(ffmpegPath).toBeTruthy();
    expect(ffprobePath).toBeTruthy();
    expect(fs.existsSync(ffmpegPath) || ffmpegPath === 'ffmpeg').toBe(true);
  });

  describe('probeMedia', () => {
    it('should successfully probe a real video file with audio', async () => {
      if (!fs.existsSync(testVideoPath)) return;

      const probe = await service.probeMedia(testVideoPath);
      expect(probe.hasVideo).toBe(true);
      expect(probe.width).toBe(640);
      expect(probe.height).toBe(360);
      expect(probe.hasAudio).toBe(true);
      expect(probe.videoCodec).toBe('h264');
      expect(probe.duration).toBeGreaterThanOrEqual(1);
    });

    it('should detect when audio is absent in a silent video', async () => {
      if (!fs.existsSync(silentVideoPath)) return;

      const probe = await service.probeMedia(silentVideoPath);
      expect(probe.hasVideo).toBe(true);
      expect(probe.hasAudio).toBe(false);
      expect(probe.audioCodec).toBeNull();
    });

    it('should fail with meaningful error when file does not exist', async () => {
      await expect(
        service.probeMedia(path.join(tmpDir, 'non-existent.mp4')),
      ).rejects.toThrow('Media file not found');
    });

    it('should fail with meaningful error on corrupted file', async () => {
      if (!fs.existsSync(corruptVideoPath)) return;

      await expect(service.probeMedia(corruptVideoPath)).rejects.toThrow(
        /Media probe failed|Invalid ffprobe output|no compatible video stream/,
      );
    });

    it('should reject when an audio-only file with no video stream is provided', async () => {
      if (!fs.existsSync(audioOnlyPath)) return;

      await expect(service.probeMedia(audioOnlyPath)).rejects.toThrow(
        'no compatible video stream detected',
      );
    });
  });

  describe('selectRenditions (No Upscaling Rules)', () => {
    it('should not upscale 720p source to 1080p', () => {
      const probe: MediaProbeResult = {
        width: 1280,
        height: 720,
        duration: 60,
        fps: 30,
        videoCodec: 'h264',
        audioCodec: 'aac',
        hasVideo: true,
        hasAudio: true,
        bitrate: 2000000,
        formatName: 'mov,mp4',
      };

      const selected = service.selectRenditions(probe, [
        '360p',
        '720p',
        '1080p',
      ]);
      const names = selected.map((r) => r.name);

      expect(names).toContain('720p');
      expect(names).toContain('360p');
      expect(names).not.toContain('1080p');
    });

    it('should not upscale 360p source to 720p or 1080p', () => {
      const probe: MediaProbeResult = {
        width: 640,
        height: 360,
        duration: 30,
        fps: 30,
        videoCodec: 'h264',
        audioCodec: 'aac',
        hasVideo: true,
        hasAudio: true,
        bitrate: 800000,
        formatName: 'mp4',
      };

      const selected = service.selectRenditions(probe, ['720p', '1080p']);
      const names = selected.map((r) => r.name);

      expect(names).toContain('360p');
      expect(names).not.toContain('720p');
      expect(names).not.toContain('1080p');
    });

    it('should allow 1080p rendition for 1080p or 4K sources', () => {
      const probe: MediaProbeResult = {
        width: 1920,
        height: 1080,
        duration: 100,
        fps: 60,
        videoCodec: 'h264',
        audioCodec: 'aac',
        hasVideo: true,
        hasAudio: true,
        bitrate: 5000000,
        formatName: 'mp4',
      };

      const selected = service.selectRenditions(probe, [
        '360p',
        '720p',
        '1080p',
      ]);
      const names = selected.map((r) => r.name);

      expect(names).toContain('1080p');
      expect(names).toContain('720p');
      expect(names).toContain('360p');
    });
  });

  describe('transcodeToHls', () => {
    it('should transcode real video into playable HLS master and variant playlists', async () => {
      if (!fs.existsSync(testVideoPath)) return;

      const probe = await service.probeMedia(testVideoPath);
      const renditions = service.selectRenditions(probe, ['360p']);
      const outputDir = path.join(tmpDir, 'hls-output');

      const result = await service.transcodeToHls({
        inputPath: testVideoPath,
        outputDir,
        videoId: 'vid-test-01',
        probe,
        renditions,
        timeoutMs: 60000,
      });

      expect(result.masterPlaylistContent).toContain('#EXTM3U');
      expect(result.masterPlaylistContent).toContain('360p/index.m3u8');
      expect(result.generatedFiles.length).toBeGreaterThanOrEqual(2); // master.m3u8 + 360p/index.m3u8 + segments
      expect(result.totalTranscodedBytes).toBeGreaterThan(0n);

      // Verify files actually exist on disk
      expect(fs.existsSync(path.join(outputDir, 'master.m3u8'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, '360p', 'index.m3u8'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, '360p', 'segment_000.ts'))).toBe(true);
    });

    it('should transcode silent video without audio streams using -an', async () => {
      if (!fs.existsSync(silentVideoPath)) return;

      const probe = await service.probeMedia(silentVideoPath);
      const renditions = service.selectRenditions(probe, ['360p']);
      const outputDir = path.join(tmpDir, 'hls-silent-output');

      const result = await service.transcodeToHls({
        inputPath: silentVideoPath,
        outputDir,
        videoId: 'vid-silent-01',
        probe,
        renditions,
        timeoutMs: 60000,
      });

      expect(result.masterPlaylistContent).toContain('#EXTM3U');
      expect(fs.existsSync(path.join(outputDir, '360p', 'index.m3u8'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, '360p', 'segment_000.ts'))).toBe(true);
    });

    it('should fail and terminate process when FFmpeg execution times out', async () => {
      if (!fs.existsSync(testVideoPath)) return;

      const probe = await service.probeMedia(testVideoPath);
      const renditions = service.selectRenditions(probe, ['360p']);
      const outputDir = path.join(tmpDir, 'hls-timeout-output');

      // 1ms timeout triggers timeout rejection
      await expect(
        service.transcodeToHls({
          inputPath: testVideoPath,
          outputDir,
          videoId: 'vid-timeout-01',
          probe,
          renditions,
          timeoutMs: 1,
        }),
      ).rejects.toThrow(/timed out/i);
    });

    it('should reject with nonzero exit status when FFmpeg encounters fatal encoding errors', async () => {
      if (!fs.existsSync(corruptVideoPath)) return;

      const fakeProbe: MediaProbeResult = {
        width: 640,
        height: 360,
        duration: 1,
        fps: 30,
        videoCodec: 'h264',
        audioCodec: 'aac',
        hasVideo: true,
        hasAudio: false,
        bitrate: 800000,
        formatName: 'mp4',
      };
      const renditions = service.selectRenditions(fakeProbe, ['360p']);
      const outputDir = path.join(tmpDir, 'hls-fail-output');

      await expect(
        service.transcodeToHls({
          inputPath: corruptVideoPath,
          outputDir,
          videoId: 'vid-corrupt-01',
          probe: fakeProbe,
          renditions,
          timeoutMs: 30000,
        }),
      ).rejects.toThrow(/FFmpeg failed with exit code/i);
    });
  });
});
