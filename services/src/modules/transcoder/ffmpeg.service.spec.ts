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
  let hdVideoPath: string;
  let portraitVideoPath: string;

  beforeAll(() => {
    tmpDir = path.join(os.tmpdir(), `vedora-ffmpeg-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    testVideoPath = path.join(tmpDir, 'test-with-audio.mp4');
    hdVideoPath = path.join(tmpDir, 'test-720p.mp4');
    silentVideoPath = path.join(tmpDir, 'test-silent.mp4');
    corruptVideoPath = path.join(tmpDir, 'corrupt.mp4');
    audioOnlyPath = path.join(tmpDir, 'test-audio-only.aac');
    portraitVideoPath = path.join(tmpDir, 'test-portrait.mp4');

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

      // Generate real 1-second synthetic portrait video with audio
      cp.execFileSync(ffmpeg.path, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1:size=360x640:rate=30',
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
        portraitVideoPath,
      ]);

      // Generate real 1-second 720p HD synthetic video with audio
      cp.execFileSync(ffmpeg.path, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1:size=1280x720:rate=30',
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
        hdVideoPath,
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

  describe('selectRenditions (Automatic Adaptive Rendition Ladder & No-Upscaling)', () => {
    const probe1080p: MediaProbeResult = {
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

    const probe720p: MediaProbeResult = {
      width: 1280,
      height: 720,
      duration: 60,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      hasVideo: true,
      hasAudio: true,
      bitrate: 2800000,
      formatName: 'mp4',
    };

    const probe480p: MediaProbeResult = {
      width: 854,
      height: 480,
      duration: 45,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      hasVideo: true,
      hasAudio: true,
      bitrate: 1400000,
      formatName: 'mp4',
    };

    const probe360p: MediaProbeResult = {
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

    const probe240p: MediaProbeResult = {
      width: 426,
      height: 240,
      duration: 20,
      fps: 24,
      videoCodec: 'h264',
      audioCodec: 'aac',
      hasVideo: true,
      hasAudio: true,
      bitrate: 400000,
      formatName: 'mp4',
    };

    describe('Ladder expansion per ceiling rules', () => {
      it('360p ceiling produces [360p]', () => {
        const result = service.selectRenditions(probe1080p, ['360p']);
        expect(result.map((r) => r.name)).toEqual(['360p']);
      });

      it('480p ceiling produces [480p, 360p]', () => {
        const result = service.selectRenditions(probe1080p, ['480p']);
        expect(result.map((r) => r.name)).toEqual(['480p', '360p']);
      });

      it('720p ceiling produces [720p, 480p, 360p]', () => {
        const result = service.selectRenditions(probe1080p, ['720p']);
        expect(result.map((r) => r.name)).toEqual(['720p', '480p', '360p']);
      });

      it('1080p ceiling produces [1080p, 720p, 480p, 360p]', () => {
        const result = service.selectRenditions(probe1080p, ['1080p']);
        expect(result.map((r) => r.name)).toEqual([
          '1080p',
          '720p',
          '480p',
          '360p',
        ]);
      });

      it('default ceiling (when empty array or omitted) defaults to 720p ladder [720p, 480p, 360p]', () => {
        const resultNoArg = service.selectRenditions(probe1080p);
        expect(resultNoArg.map((r) => r.name)).toEqual([
          '720p',
          '480p',
          '360p',
        ]);

        const resultEmpty = service.selectRenditions(probe1080p, []);
        expect(resultEmpty.map((r) => r.name)).toEqual([
          '720p',
          '480p',
          '360p',
        ]);
      });
    });

    describe('No-upscaling rule for sources below requested ceiling', () => {
      it('1080p ceiling on 720p source caps at 720p -> [720p, 480p, 360p]', () => {
        const result = service.selectRenditions(probe720p, ['1080p']);
        expect(result.map((r) => r.name)).toEqual(['720p', '480p', '360p']);
      });

      it('1080p ceiling on 480p source caps at 480p -> [480p, 360p]', () => {
        const result = service.selectRenditions(probe480p, ['1080p']);
        expect(result.map((r) => r.name)).toEqual(['480p', '360p']);
      });

      it('1080p ceiling on 360p source caps at 360p -> [360p]', () => {
        const result = service.selectRenditions(probe360p, ['1080p']);
        expect(result.map((r) => r.name)).toEqual(['360p']);
      });

      it('720p ceiling on 480p source caps at 480p -> [480p, 360p]', () => {
        const result = service.selectRenditions(probe480p, ['720p']);
        expect(result.map((r) => r.name)).toEqual(['480p', '360p']);
      });

      it('720p ceiling on 360p source caps at 360p -> [360p]', () => {
        const result = service.selectRenditions(probe360p, ['720p']);
        expect(result.map((r) => r.name)).toEqual(['360p']);
      });

      it('480p ceiling on 360p source caps at 360p -> [360p]', () => {
        const result = service.selectRenditions(probe360p, ['480p']);
        expect(result.map((r) => r.name)).toEqual(['360p']);
      });

      it('720p ceiling on sub-360p source (240p) falls back to source dimensions [240p] with even dimensions', () => {
        const result = service.selectRenditions(probe240p, ['720p']);
        expect(result.map((r) => r.name)).toEqual(['240p']);
        expect(result[0].width % 2).toBe(0);
        expect(result[0].height % 2).toBe(0);
      });
    });

    describe('Portrait and odd-dimension handling', () => {
      const probePortrait1080p: MediaProbeResult = {
        width: 1080,
        height: 1920,
        duration: 30,
        fps: 30,
        videoCodec: 'h264',
        audioCodec: 'aac',
        hasVideo: true,
        hasAudio: true,
        bitrate: 4500000,
        formatName: 'mp4',
      };

      const probeOddDimensions: MediaProbeResult = {
        width: 1921,
        height: 1079,
        duration: 15,
        fps: 30,
        videoCodec: 'h264',
        audioCodec: 'aac',
        hasVideo: true,
        hasAudio: true,
        bitrate: 3000000,
        formatName: 'mp4',
      };

      const probeSmallOddPortrait: MediaProbeResult = {
        width: 359,
        height: 641,
        duration: 10,
        fps: 30,
        videoCodec: 'h264',
        audioCodec: 'aac',
        hasVideo: true,
        hasAudio: true,
        bitrate: 500000,
        formatName: 'mp4',
      };

      it('should invert width/height for portrait 1080x1920 video ladder', () => {
        const result = service.selectRenditions(probePortrait1080p, ['1080p']);
        expect(result.map((r) => r.name)).toEqual([
          '1080p',
          '720p',
          '480p',
          '360p',
        ]);

        // Portrait 1080p: 1080x1920
        expect(result[0].width).toBe(1080);
        expect(result[0].height).toBe(1920);

        // Portrait 720p: 720x1280
        expect(result[1].width).toBe(720);
        expect(result[1].height).toBe(1280);

        // Portrait 480p: 480x854
        expect(result[2].width).toBe(480);
        expect(result[2].height).toBe(854);

        // Portrait 360p: 360x640
        expect(result[3].width).toBe(360);
        expect(result[3].height).toBe(640);

        // All dimensions must be strictly even (divisible by 2)
        for (const rend of result) {
          expect(rend.width % 2).toBe(0);
          expect(rend.height % 2).toBe(0);
        }
      });

      it('should ensure all renditions have even dimensions even when source has odd dimensions (1921x1079)', () => {
        const result = service.selectRenditions(probeOddDimensions, ['1080p']);
        expect(result.length).toBeGreaterThan(0);
        for (const rend of result) {
          expect(rend.width % 2).toBe(0);
          expect(rend.height % 2).toBe(0);
        }
      });

      it('should produce strictly even dimensions for small odd-dimension portrait video (359x641)', () => {
        const result = service.selectRenditions(probeSmallOddPortrait, ['720p']);
        expect(result.length).toBe(1);
        expect(result[0].width % 2).toBe(0);
        expect(result[0].height % 2).toBe(0);
        expect(result[0].width).toBeLessThanOrEqual(360);
        expect(result[0].height).toBeLessThanOrEqual(642);
      });
    });

    describe('Master Playlist CODECS attribute compliance (RFC 8216)', () => {
      it('should include avc1.4d401f and mp4a.40.2 codecs when audio is present', () => {
        const renditions = service.selectRenditions(probe720p, ['360p']);
        const manifest = service.buildMasterPlaylistContent(renditions, true);

        expect(manifest).toContain('CODECS="avc1.4d401f,mp4a.40.2"');
        expect(manifest).not.toContain('avc1.4d401f"');
      });

      it('should include only avc1.4d401f codec when audio is absent', () => {
        const renditions = service.selectRenditions(probe720p, ['360p']);
        const manifest = service.buildMasterPlaylistContent(renditions, false);

        expect(manifest).toContain('CODECS="avc1.4d401f"');
        expect(manifest).not.toContain('mp4a.40.2');
      });
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

    it('should transcode multiple renditions in the adaptive ladder and generate complete master playlist referencing all', async () => {
      if (!fs.existsSync(hdVideoPath)) return;

      const probe = await service.probeMedia(hdVideoPath);
      // Select 480p ceiling for 720p source video -> generates [480p, 360p]
      const renditions = service.selectRenditions(probe, ['480p']);
      expect(renditions.map((r) => r.name)).toEqual(['480p', '360p']);

      const outputDir = path.join(tmpDir, 'hls-multi-output');

      const result = await service.transcodeToHls({
        inputPath: hdVideoPath,
        outputDir,
        videoId: 'vid-multi-01',
        probe,
        renditions,
        timeoutMs: 60000,
      });

      // Master manifest validation
      expect(result.masterPlaylistContent).toContain('#EXTM3U');
      expect(result.masterPlaylistContent).toContain('480p/index.m3u8');
      expect(result.masterPlaylistContent).toContain('360p/index.m3u8');
      expect(result.masterPlaylistContent).toContain('RESOLUTION=854x480');
      expect(result.masterPlaylistContent).toContain('RESOLUTION=640x360');

      // Verify files on disk for 480p rendition
      expect(fs.existsSync(path.join(outputDir, '480p', 'index.m3u8'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, '480p', 'segment_000.ts'))).toBe(true);

      // Verify files on disk for 360p rendition
      expect(fs.existsSync(path.join(outputDir, '360p', 'index.m3u8'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, '360p', 'segment_000.ts'))).toBe(true);

      // Verify master playlist file on disk
      expect(fs.existsSync(path.join(outputDir, 'master.m3u8'))).toBe(true);

      expect(result.generatedFiles.length).toBeGreaterThanOrEqual(5); // master + 2 playlists + >= 2 segments
      expect(result.totalTranscodedBytes).toBeGreaterThan(0n);
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

    it('should transcode real portrait video (360x640) without pixel format or dimension errors', async () => {
      if (!fs.existsSync(portraitVideoPath)) return;

      const probe = await service.probeMedia(portraitVideoPath);
      expect(probe.width).toBe(360);
      expect(probe.height).toBe(640);

      const renditions = service.selectRenditions(probe, ['360p']);
      expect(renditions.length).toBe(1);
      expect(renditions[0].width).toBe(360);
      expect(renditions[0].height).toBe(640);

      const outputDir = path.join(tmpDir, 'hls-portrait-output');

      const result = await service.transcodeToHls({
        inputPath: portraitVideoPath,
        outputDir,
        videoId: 'vid-portrait-01',
        probe,
        renditions,
        timeoutMs: 60000,
      });

      expect(result.masterPlaylistContent).toContain('#EXTM3U');
      expect(result.masterPlaylistContent).toContain('RESOLUTION=360x640');
      expect(result.masterPlaylistContent).toContain('CODECS="avc1.4d401f,mp4a.40.2"');
      expect(fs.existsSync(path.join(outputDir, 'master.m3u8'))).toBe(true);
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
