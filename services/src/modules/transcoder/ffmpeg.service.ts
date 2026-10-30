import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Optional static binary paths from installer packages
let installerFfmpegPath: string | undefined;
let installerFfprobePath: string | undefined;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  installerFfmpegPath = ffmpegInstaller.path;
} catch {
  // Ignored if package not installed or binary unsupported
}

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
  installerFfprobePath = ffprobeInstaller.path;
} catch {
  // Ignored if package not installed or binary unsupported
}

export interface MediaProbeResult {
  duration: number; // in seconds
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  bitrate: number;
  formatName: string;
}

export interface RenditionConfig {
  name: string;
  width: number;
  height: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  fps: number;
  segmentDurationSec: number;
}

export const STANDARD_RENDITION_LADDER: Record<string, RenditionConfig> = {
  '360p': {
    name: '360p',
    width: 640,
    height: 360,
    videoBitrateKbps: 800,
    audioBitrateKbps: 96,
    fps: 30,
    segmentDurationSec: 4,
  },
  '480p': {
    name: '480p',
    width: 854,
    height: 480,
    videoBitrateKbps: 1400,
    audioBitrateKbps: 128,
    fps: 30,
    segmentDurationSec: 4,
  },
  '720p': {
    name: '720p',
    width: 1280,
    height: 720,
    videoBitrateKbps: 2800,
    audioBitrateKbps: 128,
    fps: 30,
    segmentDurationSec: 4,
  },
  '1080p': {
    name: '1080p',
    width: 1920,
    height: 1080,
    videoBitrateKbps: 5000,
    audioBitrateKbps: 192,
    fps: 60,
    segmentDurationSec: 4,
  },
};

export const ADAPTIVE_LADDER_CEILINGS: Record<string, string[]> = {
  '360p': ['360p'],
  '480p': ['360p', '480p'],
  '720p': ['360p', '480p', '720p'],
  '1080p': ['360p', '480p', '720p', '1080p'],
};

export const RESOLUTION_RANKS: Record<string, number> = {
  '360p': 1,
  '480p': 2,
  '720p': 3,
  '1080p': 4,
};

export interface TranscodeJobOptions {
  inputPath: string;
  outputDir: string;
  videoId: string;
  probe: MediaProbeResult;
  renditions: RenditionConfig[];
  timeoutMs?: number; // Default 10 minutes (600,000ms)
}

export interface GeneratedFileMeta {
  relativePath: string; // e.g. "720p/segment_000.ts" or "720p/index.m3u8"
  absolutePath: string;
  sizeBytes: number;
  contentType: string;
}

export interface TranscodeJobResult {
  masterPlaylistPath: string;
  masterPlaylistContent: string;
  generatedFiles: GeneratedFileMeta[];
  totalTranscodedBytes: bigint;
  probedDuration: number;
}

@Injectable()
export class FfmpegService {
  private readonly logger = new Logger(FfmpegService.name);
  private cachedFfmpegPath: string | null = null;
  private cachedFfprobePath: string | null = null;
  private readonly activeProcesses = new Map<string, cp.ChildProcess>();

  constructor(private readonly configService: ConfigService) {}

  /**
   * Resolves the executable path for FFmpeg.
   * Priority: 1. FFMPEG_PATH env, 2. @ffmpeg-installer, 3. system 'ffmpeg'
   */
  getFfmpegPath(): string {
    if (this.cachedFfmpegPath) {
      return this.cachedFfmpegPath;
    }

    const envPath =
      this.configService.get<string>('FFMPEG_PATH') || process.env.FFMPEG_PATH;
    if (envPath && fs.existsSync(envPath)) {
      this.cachedFfmpegPath = envPath;
      return envPath;
    }

    if (installerFfmpegPath && fs.existsSync(installerFfmpegPath)) {
      this.cachedFfmpegPath = installerFfmpegPath;
      return installerFfmpegPath;
    }

    this.cachedFfmpegPath = 'ffmpeg';
    return 'ffmpeg';
  }

  /**
   * Resolves the executable path for FFprobe.
   * Priority: 1. FFPROBE_PATH env, 2. @ffprobe-installer, 3. system 'ffprobe'
   */
  getFfprobePath(): string {
    if (this.cachedFfprobePath) {
      return this.cachedFfprobePath;
    }

    const envPath =
      this.configService.get<string>('FFPROBE_PATH') || process.env.FFPROBE_PATH;
    if (envPath && fs.existsSync(envPath)) {
      this.cachedFfprobePath = envPath;
      return envPath;
    }

    if (installerFfprobePath && fs.existsSync(installerFfprobePath)) {
      this.cachedFfprobePath = installerFfprobePath;
      return installerFfprobePath;
    }

    this.cachedFfprobePath = 'ffprobe';
    return 'ffprobe';
  }

  /**
   * Probes media metadata using ffprobe with JSON output.
   * Extracts duration, dimensions, codecs, and stream topology.
   */
  async probeMedia(filePath: string): Promise<MediaProbeResult> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Media file not found for probing`);
    }

    const ffprobePath = this.getFfprobePath();
    const args = [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];

    let stdout: string;
    try {
      stdout = await new Promise<string>((resolve, reject) => {
        cp.execFile(
          ffprobePath,
          args,
          { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
          (err, out, stderr) => {
            if (err) {
              const sanitizedStderr = stderr
                ? stderr.replace(/[A-Za-z]:\\[^ \n\r]+/g, '[redacted_path]')
                : err.message;
              return reject(
                new Error(
                  `Failed to probe video file: ${sanitizedStderr.trim()}`,
                ),
              );
            }
            resolve(out);
          },
        );
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Media probe execution failed: ${msg}`);
      throw new Error(`Media probe failed: ${msg}`);
    }

    interface FfprobeRawOutput {
      format?: {
        duration?: string;
        bit_rate?: string;
        format_name?: string;
      };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
        avg_frame_rate?: string;
      }>;
    }

    let parsed: FfprobeRawOutput;
    try {
      parsed = JSON.parse(stdout) as FfprobeRawOutput;
    } catch {
      throw new Error('Invalid ffprobe output: unable to parse JSON metadata');
    }

    const streams = parsed.streams || [];
    const videoStream = streams.find((s) => s.codec_type === 'video');
    const audioStream = streams.find((s) => s.codec_type === 'audio');

    if (!videoStream) {
      throw new Error(
        'Invalid media file: no compatible video stream detected',
      );
    }

    // Parse duration
    let duration = 0;
    if (parsed.format?.duration) {
      duration = Math.max(0, Math.round(parseFloat(parsed.format.duration)));
    }

    // Parse FPS from r_frame_rate or avg_frame_rate (e.g. "30/1" or "29.97")
    let fps = 30;
    const rateStr = videoStream.r_frame_rate || videoStream.avg_frame_rate;
    if (rateStr && rateStr.includes('/')) {
      const [num, den] = rateStr.split('/').map(Number);
      if (den && den > 0 && num && num > 0) {
        fps = Math.round(num / den);
      }
    } else if (rateStr) {
      const parsedNum = parseFloat(rateStr);
      if (!isNaN(parsedNum) && parsedNum > 0) {
        fps = Math.round(parsedNum);
      }
    }
    fps = Math.min(60, Math.max(15, fps)); // bounded between 15 and 60 fps

    const width = videoStream.width || 0;
    const height = videoStream.height || 0;

    if (width <= 0 || height <= 0) {
      throw new Error('Invalid media dimensions: zero or negative resolution');
    }

    const bitrate = parsed.format?.bit_rate
      ? parseInt(parsed.format.bit_rate, 10)
      : 0;

    return {
      duration,
      width,
      height,
      fps,
      videoCodec: videoStream.codec_name || 'unknown',
      audioCodec: audioStream ? audioStream.codec_name || 'unknown' : null,
      hasVideo: true,
      hasAudio: Boolean(audioStream),
      bitrate,
      formatName: parsed.format?.format_name || 'mp4',
    };
  }

  /**
   * Intelligently select encoding renditions based on source dimensions and adaptive ladder ceiling.
   * Treats requested resolution as the upper quality ceiling and generates all supported
   * lower renditions up to that ceiling:
   * - 360p -> 360p
   * - 480p -> 360p + 480p
   * - 720p -> 360p + 480p + 720p
   * - 1080p -> 360p + 480p + 720p + 1080p
   *
   * Guarantees that smaller videos are NEVER upscaled beyond source dimensions.
   */
  selectRenditions(
    probe: MediaProbeResult,
    requestedResolutions?: string[],
  ): RenditionConfig[] {
    // 1. Determine maximum resolution ceiling requested by the user/client.
    // If multiple resolutions are provided, select the highest quality one as the ceiling.
    let ceiling = '720p';
    if (requestedResolutions && requestedResolutions.length > 0) {
      let highestRank = 0;
      for (const res of requestedResolutions) {
        const rank = RESOLUTION_RANKS[res] || 0;
        if (rank > highestRank) {
          highestRank = rank;
          ceiling = res;
        }
      }
    }

    // 2. Expand ceiling to the adaptive ladder candidates
    const candidateNames =
      ADAPTIVE_LADDER_CEILINGS[ceiling] || ['360p', '480p', '720p'];

    const matched: RenditionConfig[] = [];
    const isPortrait = probe.height > probe.width;

    // 3. Filter candidate renditions that do NOT upscale source height/width
    for (const name of candidateNames) {
      const standard = STANDARD_RENDITION_LADDER[name];
      if (!standard) continue;

      const targetWidth = isPortrait
        ? Math.min(standard.width, standard.height)
        : standard.width;
      const targetHeight = isPortrait
        ? Math.max(standard.width, standard.height)
        : standard.height;

      // Ensure no upscaling on the limiting dimension
      const maxDim = Math.max(probe.width, probe.height);
      const targetMaxDim = Math.max(targetWidth, targetHeight);

      if (targetHeight <= probe.height || targetMaxDim <= maxDim) {
        if (targetWidth <= probe.width && targetHeight <= probe.height) {
          matched.push({
            ...standard,
            width: targetWidth % 2 === 0 ? targetWidth : targetWidth - 1,
            height: targetHeight % 2 === 0 ? targetHeight : targetHeight - 1,
            fps: Math.min(standard.fps, probe.fps),
          });
        }
      }
    }

    // 4. If source is smaller than lowest candidate (e.g. 240p or odd aspect ratio), transcode matching source resolution directly
    if (matched.length === 0) {
      const evenWidth =
        probe.width % 2 === 0 ? probe.width : Math.max(2, probe.width - 1);
      const evenHeight =
        probe.height % 2 === 0 ? probe.height : Math.max(2, probe.height - 1);
      matched.push({
        name: `${evenHeight}p`,
        width: evenWidth,
        height: evenHeight,
        videoBitrateKbps: Math.min(
          600,
          Math.round((probe.bitrate || 600000) / 1000),
        ),
        audioBitrateKbps: 64,
        fps: probe.fps,
        segmentDurationSec: 4,
      });
    }

    // Sort descending by resolution height (e.g. 1080p, 720p, 480p, 360p)
    return matched.sort((a, b) => b.height - a.height);
  }

  /**
   * Executes genuine FFmpeg transcoding into HLS playlists and media segments (.ts).
   * Generates master.m3u8, variant index.m3u8 files, and segment files.
   */
  async transcodeToHls(options: TranscodeJobOptions): Promise<TranscodeJobResult> {
    const { inputPath, outputDir, videoId, probe, renditions } = options;
    const timeoutMs = options.timeoutMs || 600000; // 10 minutes default
    const ffmpegPath = this.getFfmpegPath();

    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file does not exist for transcoding`);
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    this.logger.log(
      `Starting FFmpeg HLS transcoding for video ${videoId} (source: ${probe.width}x${probe.height}, renditions: ${renditions.map((r) => r.name).join(', ')})`,
    );

    const generatedFiles: GeneratedFileMeta[] = [];
    let totalTranscodedBytes = 0n;

    for (const rend of renditions) {
      const rendDir = path.join(outputDir, rend.name);
      if (!fs.existsSync(rendDir)) {
        fs.mkdirSync(rendDir, { recursive: true });
      }

      // GOP size aligned with segment duration to guarantee IDR keyframe at every segment boundary
      const gopSize = rend.fps * rend.segmentDurationSec;

      const args = [
        '-y',
        '-i',
        inputPath,
        // Scale with aspect ratio preservation and even dimensions padding for portrait, landscape, and unusual aspect ratios
        '-vf',
        `scale='if(gt(a,${rend.width}/${rend.height}),${rend.width},-2)':'if(gt(a,${rend.width}/${rend.height}),-2,${rend.height})',pad=${rend.width}:${rend.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
        '-c:v',
        'libx264',
        '-profile:v',
        'main',
        '-level',
        '3.1',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-g',
        String(gopSize),
        '-keyint_min',
        String(gopSize),
        '-sc_threshold',
        '0',
        '-b:v',
        `${rend.videoBitrateKbps}k`,
        '-maxrate',
        `${Math.round(rend.videoBitrateKbps * 1.2)}k`,
        '-bufsize',
        `${rend.videoBitrateKbps * 2}k`,
      ];

      // Audio handling
      if (probe.hasAudio) {
        args.push(
          '-c:a',
          'aac',
          '-b:a',
          `${rend.audioBitrateKbps}k`,
          '-ac',
          '2',
          '-ar',
          '44100',
        );
      } else {
        args.push('-an'); // Source without audio
      }

      // HLS packaging arguments
      args.push(
        '-hls_time',
        String(rend.segmentDurationSec),
        '-hls_playlist_type',
        'vod',
        '-hls_flags',
        'independent_segments',
        '-hls_segment_type',
        'mpegts',
        '-hls_segment_filename',
        path.join(rendDir, 'segment_%03d.ts'),
        path.join(rendDir, 'index.m3u8'),
      );

      this.logger.debug(
        `Executing FFmpeg for rendition ${rend.name} on video ${videoId}`,
      );

      await this.runProcessWithTimeout(ffmpegPath, args, timeoutMs, videoId);

      // Verify variant index.m3u8 was created
      const variantIndexFile = path.join(rendDir, 'index.m3u8');
      if (!fs.existsSync(variantIndexFile)) {
        throw new Error(
          `FFmpeg completed but failed to generate playlist for ${rend.name}`,
        );
      }

      const variantIndexStat = fs.statSync(variantIndexFile);
      generatedFiles.push({
        relativePath: `${rend.name}/index.m3u8`,
        absolutePath: variantIndexFile,
        sizeBytes: variantIndexStat.size,
        contentType: 'application/vnd.apple.mpegurl',
      });
      totalTranscodedBytes += BigInt(variantIndexStat.size);

      // Find all generated .ts segments
      const segFiles = fs
        .readdirSync(rendDir)
        .filter((f) => f.endsWith('.ts'))
        .sort();

      if (segFiles.length === 0) {
        throw new Error(
          `FFmpeg failed to produce media segments for rendition ${rend.name}`,
        );
      }

      for (const seg of segFiles) {
        const segPath = path.join(rendDir, seg);
        const segStat = fs.statSync(segPath);
        generatedFiles.push({
          relativePath: `${rend.name}/${seg}`,
          absolutePath: segPath,
          sizeBytes: segStat.size,
          contentType: 'video/mp2t',
        });
        totalTranscodedBytes += BigInt(segStat.size);
      }
    }

    // Generate root master.m3u8 manifest
    const masterPlaylistContent = this.buildMasterPlaylistContent(
      renditions,
      probe.hasAudio,
    );
    const masterPlaylistPath = path.join(outputDir, 'master.m3u8');
    fs.writeFileSync(masterPlaylistPath, masterPlaylistContent, 'utf-8');

    const masterStat = fs.statSync(masterPlaylistPath);
    generatedFiles.push({
      relativePath: 'master.m3u8',
      absolutePath: masterPlaylistPath,
      sizeBytes: masterStat.size,
      contentType: 'application/vnd.apple.mpegurl',
    });
    totalTranscodedBytes += BigInt(masterStat.size);

    this.logger.log(
      `FFmpeg HLS transcoding finished successfully for video ${videoId}. Generated ${generatedFiles.length} files (total bytes: ${totalTranscodedBytes.toString()})`,
    );

    return {
      masterPlaylistPath,
      masterPlaylistContent,
      generatedFiles,
      totalTranscodedBytes,
      probedDuration: probe.duration,
    };
  }

  /**
   * Builds an RFC 8216 compliant HLS Master Playlist referencing active renditions.
   */
  public buildMasterPlaylistContent(
    renditions: RenditionConfig[],
    hasAudio = true,
  ): string {
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '# Generated by Vedora FFmpeg Engine',
    ];

    const codecAttr = hasAudio
      ? 'avc1.4d401f,mp4a.40.2'
      : 'avc1.4d401f';

    for (const rend of renditions) {
      const bandwidth =
        (rend.videoBitrateKbps + rend.audioBitrateKbps) * 1000;
      lines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${rend.width}x${rend.height},FRAME-RATE=${rend.fps},CODECS="${codecAttr}"`,
      );
      lines.push(`${rend.name}/index.m3u8`);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Gracefully terminates an active FFmpeg child process for a given videoId:
   * 1. Sends SIGTERM.
   * 2. Waits up to timeoutMs for the OS 'close' event.
   * 3. Escalates to SIGKILL if the process fails to exit within the window.
   * 4. Guarantees the child process is confirmed dead before resolving.
   */
  async terminateActiveProcess(
    videoId: string,
    timeoutMs = 10000,
  ): Promise<boolean> {
    const child = this.activeProcesses.get(videoId);
    if (!child || child.killed || child.exitCode !== null) {
      this.activeProcesses.delete(videoId);
      return false;
    }

    this.logger.log(
      `Terminating active FFmpeg process for video ${videoId} (PID: ${child.pid})...`,
    );

    return new Promise<boolean>((resolve) => {
      let resolved = false;

      const cleanupAndResolve = () => {
        if (!resolved) {
          resolved = true;
          this.activeProcesses.delete(videoId);
          clearTimeout(killTimer);
          resolve(true);
        }
      };

      child.once('close', () => {
        this.logger.log(
          `Active FFmpeg process for video ${videoId} successfully exited.`,
        );
        cleanupAndResolve();
      });

      // Issue SIGTERM first
      try {
        child.kill('SIGTERM');
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to send SIGTERM to FFmpeg process ${child.pid}: ${(err as Error).message}`,
        );
      }

      // Escalate to SIGKILL if not closed within bounded window
      const killTimer = setTimeout(() => {
        if (!resolved && child.exitCode === null) {
          this.logger.warn(
            `FFmpeg process for video ${videoId} did not terminate within ${timeoutMs / 1000}s. Escalating to SIGKILL.`,
          );
          try {
            child.kill('SIGKILL');
          } catch {
            // Ignored if already terminated
          }
        }
      }, timeoutMs);

      if (typeof killTimer.unref === 'function') {
        killTimer.unref();
      }
    });
  }

  getActiveProcessCount(): number {
    return this.activeProcesses.size;
  }

  /**
   * Spawns a child process with timeout protection and SIGKILL on timeout.
   */
  private async runProcessWithTimeout(
    executable: string,
    args: string[],
    timeoutMs: number,
    processKey?: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = cp.spawn(executable, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      if (processKey) {
        this.activeProcesses.set(processKey, child);
      }

      let stderrOutput = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderrOutput += chunk.toString();
        // Keep only trailing 2KB of stderr to prevent buffer bloat
        if (stderrOutput.length > 2048) {
          stderrOutput = stderrOutput.substring(stderrOutput.length - 2048);
        }
      });

      let isTerminated = false;
      const timer = setTimeout(() => {
        isTerminated = true;
        child.kill('SIGKILL');
        reject(
          new Error(`FFmpeg process timed out after ${timeoutMs / 1000}s`),
        );
      }, timeoutMs);

      child.on('error', (err) => {
        if (!isTerminated) {
          clearTimeout(timer);
          if (processKey) {
            this.activeProcesses.delete(processKey);
          }
          reject(new Error(`Failed to start FFmpeg: ${err.message}`));
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (processKey) {
          this.activeProcesses.delete(processKey);
        }
        if (isTerminated) return;

        if (code === 0) {
          resolve();
        } else {
          // Sanitize internal filesystem paths from error
          const sanitized = stderrOutput
            .replace(/[A-Za-z]:\\[^ \n\r]+/g, '[redacted_path]')
            .trim();
          reject(
            new Error(
              `FFmpeg failed with exit code ${code}: ${sanitized || 'Unknown error'}`,
            ),
          );
        }
      });
    });
  }
}
