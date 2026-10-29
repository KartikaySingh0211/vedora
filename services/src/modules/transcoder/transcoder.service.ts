import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  Optional,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, lt } from 'drizzle-orm';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DRIZZLE_DB } from '../../database/database.module';
import type { DrizzleDb } from '../../database/database.module';
import * as schema from '../../database/schema';
import { RedisService } from '../../infra/redis/redis.service';
import { StorageService } from '../../infra/storage/storage.service';
import { TranscodeJobData } from './dto/transcode-job.dto';
import { TranscoderWebhookDto } from './dto/transcoder-webhook.dto';
import {
  FfmpegService,
  STANDARD_RENDITION_LADDER,
  ADAPTIVE_LADDER_CEILINGS,
  RESOLUTION_RANKS,
} from './ffmpeg.service';
import { CACHE_KEYS } from '../../common/cache-keys';

export interface RenditionConfig {
  name: string;
  width: number;
  height: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  fps: number;
  segmentDurationSec: number;
}

export const RENDITION_LADDER: Record<string, RenditionConfig> =
  STANDARD_RENDITION_LADDER;

export const QUEUE_KEY = 'vedora:transcode:queue';
export const PROCESSING_QUEUE_KEY = 'vedora:transcode:processing';

@Injectable()
export class TranscoderService implements OnModuleInit {
  private readonly logger = new Logger(TranscoderService.name);
  private isProcessing = false;

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
    private readonly redisService: RedisService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly ffmpegService: FfmpegService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.validateWebhookConfig();
    try {
      await this.recoverStuckJobs();
    } catch (err: unknown) {
      this.logger.warn(
        `Could not run startup recovery of stuck jobs: ${(err as Error).message}`,
      );
    }
  }

  validateWebhookConfig(): void {
    const webhookSecret = this.configService.get<string>(
      'transcoder.webhookSecret',
    );
    const trimmed = webhookSecret?.trim();
    if (!trimmed || trimmed.length < 32) {
      const errorMsg =
        'TRANSCODER_WEBHOOK_SECRET is required and must be at least 32 characters long. Application cannot start safely without a configured webhook secret.';
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  /**
   * Enqueue an asynchronous transcoding job.
   */
  async enqueueTranscodeJob(jobData: TranscodeJobData): Promise<void> {
    this.logger.log(
      `Enqueueing transcoding job for video ${jobData.videoId} (resolutions: ${jobData.resolutions.join(', ')})`,
    );

    const payload = JSON.stringify(jobData);
    await this.redisService.rpush(QUEUE_KEY, payload);

    // Trigger processing asynchronously without blocking caller
    setImmediate(() => {
      this.processNextJob().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Error in async job execution: ${msg}`);
      });
    });
  }

  /**
   * Pick up and process queued transcoding jobs with bounded concurrency and at-least-once delivery.
   * Atomically claims job from QUEUE_KEY to PROCESSING_QUEUE_KEY via RPOPLPUSH.
   */
  async processNextJob(): Promise<boolean> {
    if (this.isProcessing) {
      return false;
    }

    let rawJob = await this.redisService.rpoplpush(
      QUEUE_KEY,
      PROCESSING_QUEUE_KEY,
    );
    if (!rawJob) {
      rawJob = await this.redisService.lpop(QUEUE_KEY);
    }

    if (!rawJob) {
      return false;
    }

    this.isProcessing = true;
    let jobData: TranscodeJobData;
    try {
      jobData = JSON.parse(rawJob) as TranscodeJobData;
    } catch {
      this.logger.error(`Malformed job in transcode queue: ${rawJob}`);
      await this.redisService.lrem(PROCESSING_QUEUE_KEY, 1, rawJob);
      this.isProcessing = false;
      return false;
    }

    try {
      await this.executeTranscoding(jobData);
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const sanitized = this.sanitizeErrorMessage(rawMsg);
      this.logger.error(
        `Transcoding job failed for video ${jobData.videoId}: ${sanitized}`,
      );
      await this.markVideoFailed(jobData.videoId, sanitized);
    } finally {
      // Remove successfully completed or permanently failed job from processing queue
      await this.redisService.lrem(PROCESSING_QUEUE_KEY, 1, rawJob);
      this.isProcessing = false;
      // Check if more jobs are in queue
      const remaining = await this.redisService.llen(QUEUE_KEY);
      if (remaining > 0) {
        setImmediate(() => {
          void this.processNextJob();
        });
      }
    }

    return true;
  }

  /**
   * Execute transcoding and HLS generation for authorized resolutions.
   * Performs real FFmpeg probing, rendition filtering (no upscaling), H.264/AAC encoding,
   * segment writing, and atomic database lifecycle transitions.
   */
  async executeTranscoding(jobData: TranscodeJobData): Promise<void> {
    const { videoId, resolutions, storageKey } = jobData;

    // 1. Distributed lock with ownership token to prevent duplicate worker execution
    const lockKey = CACHE_KEYS.transcodeLock(videoId);
    const lockToken = crypto.randomUUID();
    const acquired = await this.redisService.setnxWithExpiry(
      lockKey,
      lockToken,
      600,
    );
    if (!acquired && this.redisService.isHealthy()) {
      this.logger.warn(
        `Transcoding job for video ${videoId} is already running in another worker. Skipping.`,
      );
      return;
    }

    // Active lock renewal heartbeat: extends 600s TTL every 30s during long transcoding
    let renewalTimer: NodeJS.Timeout | null = null;
    if (acquired) {
      renewalTimer = setInterval(() => {
        void this.redisService.renewLock(lockKey, lockToken, 600);
      }, 30_000);
      if (typeof renewalTimer.unref === 'function') {
        renewalTimer.unref();
      }
    }

    // 2. Check if video is already ready (Idempotency)
    const [existing] = await this.db
      .select({
        status: schema.videos.status,
        masterKey: schema.videos.master_m3u8_key,
      })
      .from(schema.videos)
      .where(eq(schema.videos.id, videoId))
      .limit(1);

    if (existing?.status === 'ready' && existing.masterKey) {
      this.logger.log(
        `Video ${videoId} is already ready. Skipping redundant job.`,
      );
      if (renewalTimer) {
        clearInterval(renewalTimer);
      }
      await this.redisService.releaseLock(lockKey, lockToken);
      return;
    }

    // 3. Transition status to processing
    await this.db
      .update(schema.videos)
      .set({
        status: 'processing',
        updated_at: new Date(),
      })
      .where(eq(schema.videos.id, videoId));

    this.logger.log(`Transcoding video ${videoId} started.`);

    const jobDir = path.join(
      os.tmpdir(),
      'vedora-jobs',
      `${videoId}-${Date.now()}`,
    );
    let cleanupNeeded = false;

    try {
      if (!this.ffmpegService) {
        throw new Error('FfmpegService is not available for video transcoding');
      }

      if (!storageKey) {
        throw new Error(
          `Cannot transcode video ${videoId}: storageKey is missing`,
        );
      }

      fs.mkdirSync(jobDir, { recursive: true });
      cleanupNeeded = true;
      const inputPath = path.join(jobDir, 'source.mp4');

      // Retrieve source video through storage abstraction
      let hasInput = await this.storageService.downloadObjectToFile(
        storageKey,
        inputPath,
      );

      if (!hasInput) {
        const fallbackPath = path.join(
          process.cwd(),
          'storage_local',
          'objects',
          storageKey.replace(/[/\\]/g, '_'),
        );
        if (fs.existsSync(fallbackPath) && fs.statSync(fallbackPath).size > 0) {
          fs.copyFileSync(fallbackPath, inputPath);
          hasInput = true;
        }
      }

      if (
        !hasInput ||
        !fs.existsSync(inputPath) ||
        fs.statSync(inputPath).size === 0
      ) {
        throw new Error(
          `Video source file not found in storage for key: ${storageKey}`,
        );
      }

      // Probe source video metadata
      const probe = await this.ffmpegService.probeMedia(inputPath);
      const targetRenditions = this.ffmpegService.selectRenditions(
        probe,
        resolutions,
      );

      // Transcode renditions to genuine HLS output
      const outputDir = path.join(jobDir, 'hls');
      const transcodeResult = await this.ffmpegService.transcodeToHls({
        inputPath,
        outputDir,
        videoId,
        probe,
        renditions: targetRenditions,
      });

      // Upload real generated HLS files to storage
      for (const file of transcodeResult.generatedFiles) {
        const fileBuf = fs.readFileSync(file.absolutePath);
        const uploadKey = `videos/${videoId}/${file.relativePath}`;
        const uploadRes = await this.storageService.uploadDirectBuffer(
          uploadKey,
          fileBuf,
          file.contentType,
        );
        if (!uploadRes || uploadRes.success === false) {
          throw new Error(
            `Failed to upload transcoded asset to storage: ${uploadKey}`,
          );
        }
      }

      const masterManifestKey = `videos/${videoId}/master.m3u8`;

      // Verify master playlist was generated
      if (!transcodeResult.masterPlaylistContent) {
        throw new Error(
          'Master playlist content missing after FFmpeg execution',
        );
      }

      // Transition to ready with verified output metadata
      await this.db
        .update(schema.videos)
        .set({
          status: 'ready',
          master_m3u8_key: masterManifestKey,
          transcoded_size: transcodeResult.totalTranscodedBytes,
          duration: transcodeResult.probedDuration || jobData.duration || 0,
          resolutions: targetRenditions.map((r) => r.name),
          updated_at: new Date(),
        })
        .where(eq(schema.videos.id, videoId));

      this.logger.log(
        `FFmpeg transcoding completed successfully for video ${videoId}. Status: ready. Master key: ${masterManifestKey}`,
      );
      return;
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const sanitized = this.sanitizeErrorMessage(rawMsg);
      this.logger.error(
        `Transcoding job error for video ${videoId}: ${sanitized}`,
      );
      await this.markVideoFailed(videoId, sanitized);
      throw err;
    } finally {
      if (renewalTimer) {
        clearInterval(renewalTimer);
      }
      if (cleanupNeeded && fs.existsSync(jobDir)) {
        try {
          fs.rmSync(jobDir, { recursive: true, force: true });
        } catch (cleanupErr: unknown) {
          this.logger.warn(
            `Failed to clean up job directory ${jobDir}: ${(cleanupErr as Error).message}`,
          );
        }
      }
      await this.redisService.releaseLock(lockKey, lockToken);
    }
  }

  /**
   * Generates a valid HLS Master playlist referencing authorized variant streams.
   */
  generateMasterPlaylist(
    videoId: string,
    renditions: string[],
    hasAudio = true,
  ): string {
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '# Generated by Vedora Transcoder Engine',
    ];

    const codecAttr = hasAudio
      ? 'avc1.4d401f,mp4a.40.2'
      : 'avc1.4d401f';

    for (const rend of renditions) {
      const config = RENDITION_LADDER[rend];
      if (!config) continue;

      const bandwidth =
        (config.videoBitrateKbps + config.audioBitrateKbps) * 1000;
      lines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${config.width}x${config.height},FRAME-RATE=${config.fps},CODECS="${codecAttr}"`,
      );
      lines.push(`${rend}/index.m3u8`);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Generates a valid HLS Variant playlist for a specific rendition.
   */
  generateVariantPlaylist(rendition: string, durationSec: number): string {
    const config = RENDITION_LADDER[rendition];
    const segmentDuration = config ? config.segmentDurationSec : 4;
    const numSegments = Math.max(1, Math.ceil(durationSec / segmentDuration));

    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${segmentDuration}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
    ];

    for (let i = 0; i < numSegments; i++) {
      const isLast = i === numSegments - 1;
      const segTime = isLast
        ? (durationSec % segmentDuration || segmentDuration).toFixed(6)
        : segmentDuration.toFixed(6);
      lines.push(`#EXTINF:${segTime},`);
      lines.push(`segment_${String(i).padStart(3, '0')}.ts`);
    }

    lines.push('#EXT-X-ENDLIST');
    return lines.join('\n') + '\n';
  }

  /**
   * Process incoming cloud transcoder webhook.
   */
  async handleWebhook(
    signature: string | undefined,
    rawPayload: Buffer | string | undefined,
    dto: TranscoderWebhookDto,
  ): Promise<{ success: boolean; message: string }> {
    if (
      !rawPayload ||
      (Buffer.isBuffer(rawPayload) && rawPayload.length === 0) ||
      (typeof rawPayload === 'string' && rawPayload.trim().length === 0)
    ) {
      throw new BadRequestException(
        'Missing raw request body for webhook signature verification',
      );
    }

    // Verify signature
    this.verifyWebhookSignature(signature, rawPayload);

    // Find video
    const [video] = await this.db
      .select()
      .from(schema.videos)
      .where(eq(schema.videos.id, dto.videoId))
      .limit(1);

    if (!video) {
      throw new NotFoundException(`Video with ID ${dto.videoId} not found`);
    }

    // Idempotent: if already ready, acknowledge without error
    if (video.status === 'ready' && video.master_m3u8_key === dto.masterKey) {
      return { success: true, message: 'Video already ready (idempotent)' };
    }

    if (dto.status === 'failed') {
      await this.markVideoFailed(
        dto.videoId,
        dto.errorMessage || 'Cloud transcoder reported job failure',
      );
      return { success: false, message: 'Transcoding failure registered' };
    }

    // Confirm that masterKey exists and is properly formed
    if (!dto.masterKey || !dto.masterKey.endsWith('.m3u8')) {
      throw new BadRequestException('Invalid master manifest key format');
    }

    // Update video to ready
    await this.db
      .update(schema.videos)
      .set({
        status: 'ready',
        master_m3u8_key: dto.masterKey,
        duration: dto.totalDuration,
        transcoded_size: BigInt(dto.transcodedSize),
        updated_at: new Date(),
      })
      .where(eq(schema.videos.id, dto.videoId));

    this.logger.log(
      `Webhook: video ${dto.videoId} marked ready with master manifest ${dto.masterKey}`,
    );

    return { success: true, message: 'Video marked ready' };
  }

  /**
   * Verify HMAC-SHA256 signature for cloud transcoder webhooks against the raw request body.
   */
  verifyWebhookSignature(
    signatureHeader: string | undefined,
    rawPayload: Buffer | string | undefined,
  ): void {
    const webhookSecret = this.configService.get<string>(
      'transcoder.webhookSecret',
    );
    const trimmed = webhookSecret?.trim();

    if (!trimmed || trimmed.length < 32) {
      throw new UnauthorizedException(
        'Transcoder webhook secret is not configured or does not meet minimum length requirement',
      );
    }

    if (!signatureHeader) {
      throw new UnauthorizedException('Missing x-transcoder-signature header');
    }

    if (
      !rawPayload ||
      (Buffer.isBuffer(rawPayload) && rawPayload.length === 0) ||
      (typeof rawPayload === 'string' && rawPayload.trim().length === 0)
    ) {
      throw new BadRequestException(
        'Missing raw request body for webhook signature verification',
      );
    }

    const payloadBuffer = Buffer.isBuffer(rawPayload)
      ? rawPayload
      : Buffer.from(rawPayload, 'utf8');

    const computed = crypto
      .createHmac('sha256', trimmed)
      .update(payloadBuffer)
      .digest('hex');

    const signature = signatureHeader.replace(/^sha256=/, '').trim();

    const bufA = Buffer.from(computed, 'utf8');
    const bufB = Buffer.from(signature, 'utf8');

    if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
      throw new UnauthorizedException('Invalid transcoder webhook signature');
    }
  }

  /**
   * Sanitizes diagnostic error messages by stripping filesystem paths and credential patterns.
   */
  sanitizeErrorMessage(raw: string): string {
    if (!raw) return 'Unknown error';
    return raw
      .replace(/[A-Za-z]:\\[^ \n\r\t"]+/g, '[redacted_path]')
      .replace(/\/(?:[a-zA-Z0-9._-]+\/)+[a-zA-Z0-9._-]+/g, '[redacted_path]')
      .replace(/(?:password|secret|token|api_?key)=[^&\s]+/gi, '$1=[redacted]')
      .trim();
  }

  /**
   * Safely mark a video as failed with diagnostic reason.
   */
  async markVideoFailed(videoId: string, reason: string): Promise<void> {
    const sanitizedReason = this.sanitizeErrorMessage(reason);
    this.logger.warn(`Marking video ${videoId} as failed: ${sanitizedReason}`);
    await this.db
      .update(schema.videos)
      .set({
        status: 'failed',
        updated_at: new Date(),
      })
      .where(eq(schema.videos.id, videoId));
  }

  /**
   * Recovers jobs stranded in processing queue or 'processing' database status.
   * Inspects Redis PROCESSING_QUEUE_KEY and database records for interrupted tasks without active locks.
   * Re-enqueues interrupted jobs up to 3 attempts, or safely marks them failed.
   */
  async recoverStuckJobs(thresholdMs = 15 * 60 * 1000): Promise<string[]> {
    const recoveredIds: string[] = [];

    // 1. Recover interrupted jobs from Redis processing queue
    try {
      const inFlight = await this.redisService.lrange(
        PROCESSING_QUEUE_KEY,
        0,
        -1,
      );
      for (const rawJob of inFlight) {
        try {
          const jobData = JSON.parse(rawJob) as TranscodeJobData;
          const lockKey = CACHE_KEYS.transcodeLock(jobData.videoId);
          const hasLock = Boolean(await this.redisService.get(lockKey));

          if (!hasLock) {
            // No active lock: worker terminated mid-execution
            const [videoRecord] = await this.db
              .select({ status: schema.videos.status })
              .from(schema.videos)
              .where(eq(schema.videos.id, jobData.videoId))
              .limit(1);

            if (videoRecord?.status === 'ready' || videoRecord?.status === 'failed') {
              await this.redisService.lrem(PROCESSING_QUEUE_KEY, 1, rawJob);
            } else {
              const attempts = jobData.attempts || 1;
              if (attempts < 3) {
                jobData.attempts = attempts + 1;
                await this.redisService.lrem(PROCESSING_QUEUE_KEY, 1, rawJob);
                await this.redisService.rpush(
                  QUEUE_KEY,
                  JSON.stringify(jobData),
                );
                this.logger.log(
                  `Recovered interrupted job for video ${jobData.videoId}, re-enqueued attempt ${jobData.attempts}`,
                );
                recoveredIds.push(jobData.videoId);
              } else {
                await this.redisService.lrem(PROCESSING_QUEUE_KEY, 1, rawJob);
                await this.markVideoFailed(
                  jobData.videoId,
                  'Transcoding job exceeded maximum 3 retry attempts',
                );
                recoveredIds.push(jobData.videoId);
              }
            }
          }
        } catch {
          // Malformed job payload in processing queue, remove safely
          await this.redisService.lrem(PROCESSING_QUEUE_KEY, 1, rawJob);
        }
      }
    } catch (queueErr: unknown) {
      this.logger.warn(
        `Error reading processing queue for recovery: ${(queueErr as Error).message}`,
      );
    }

    // 2. Recover database records stuck in 'processing' past threshold without lock
    const cutoff = new Date(Date.now() - thresholdMs);
    try {
      const result = await this.db
        .select({
          id: schema.videos.id,
          status: schema.videos.status,
          updatedAt: schema.videos.updated_at,
        })
        .from(schema.videos)
        .where(
          and(
            eq(schema.videos.status, 'processing'),
            lt(schema.videos.updated_at, cutoff),
          ),
        );

      const stuckVideos = Array.isArray(result) ? result : [];

      for (const video of stuckVideos) {
        const lockKey = CACHE_KEYS.transcodeLock(video.id);
        const lockVal = await this.redisService.get(lockKey);
        const hasLock = Boolean(lockVal);

        if (!hasLock) {
          this.logger.warn(
            `Recovering stranded job for video ${video.id}; marking failed`,
          );
          await this.markVideoFailed(
            video.id,
            'Transcoding worker crashed or job timed out without completion',
          );
          if (!recoveredIds.includes(video.id)) {
            recoveredIds.push(video.id);
          }
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to recover stuck jobs from DB: ${(err as Error).message}`,
      );
    }

    if (recoveredIds.length > 0) {
      setImmediate(() => {
        void this.processNextJob();
      });
    }

    return recoveredIds;
  }
}
