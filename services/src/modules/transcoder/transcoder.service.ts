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
import { and, eq, lt, or, ne, gt, isNull } from 'drizzle-orm';
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
  private isShuttingDown = false;
  private activeVideoId: string | null = null;

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
   * Gracefully shuts down the transcoder service and awaits active process termination.
   * Fully idempotent: duplicate signals will safely no-op.
   */
  async shutdown(signal?: string): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }
    this.isShuttingDown = true;
    this.logger.log(
      `TranscoderService shutting down (${signal || 'SIGTERM'}). Ceasing queue polling.`,
    );
    if (this.activeVideoId) {
      this.logger.log(
        `Awaiting termination of active FFmpeg process for video ${this.activeVideoId}...`,
      );
      await this.ffmpegService.terminateActiveProcess(this.activeVideoId, 10000);
    }
  }

  /**
   * Enqueue an asynchronous transcoding job with atomic database enqueue marker.
   */
  async enqueueTranscodeJob(jobData: TranscodeJobData): Promise<boolean> {
    const targetAttempt = jobData.attempt || 1;
    const stableJobId =
      jobData.jobId || `vdr_job_${jobData.videoId}_${targetAttempt}`;

    this.logger.log(
      `Enqueueing transcoding job ${stableJobId} for video ${jobData.videoId} (resolutions: ${jobData.resolutions.join(', ')})`,
    );

    // 1. Atomic claim in PostgreSQL: transition enqueue_state to 'enqueued'
    // Only succeeds if current enqueue_state is 'pending' OR stale lease expired (>15 min)
    const [claimed] = await this.db
      .update(schema.videos)
      .set({
        enqueue_state: 'enqueued',
        active_job_id: stableJobId,
        attempt: targetAttempt,
        enqueued_at: new Date(),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(schema.videos.id, jobData.videoId),
          or(
            eq(schema.videos.enqueue_state, 'pending'),
            lt(
              schema.videos.enqueued_at,
              new Date(Date.now() - 15 * 60 * 1000),
            ),
          ),
        ),
      )
      .returning({ id: schema.videos.id, attempt: schema.videos.attempt });

    if (!claimed) {
      this.logger.warn(
        `Video ${jobData.videoId} is already enqueued or actively processing. Skipping duplicate enqueue.`,
      );
      return false;
    }

    const payload = JSON.stringify({
      ...jobData,
      jobId: stableJobId,
      attempt: targetAttempt,
    });

    try {
      await this.redisService.rpush(QUEUE_KEY, payload);
      this.logger.log(
        `Enqueued transcode job ${stableJobId} for video ${jobData.videoId}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Redis write failed during transcode enqueue (OOM or connection error) for video ${jobData.videoId}: ${msg}. Reverting enqueue_state to 'pending' for reconciliation.`,
      );
      await this.db
        .update(schema.videos)
        .set({
          enqueue_state: 'pending',
          active_job_id: null,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(schema.videos.id, jobData.videoId),
            eq(schema.videos.active_job_id, stableJobId),
          ),
        );
      return false;
    }

    const appRole = process.env.APP_ROLE || 'monolith';
    if (appRole !== 'api') {
      setImmediate(() => {
        this.processNextJob().catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Error in async job execution: ${msg}`);
        });
      });
    }

    return true;
  }

  /**
   * Pick up and process queued transcoding jobs with bounded concurrency and at-least-once delivery.
   * Atomically claims job from QUEUE_KEY to PROCESSING_QUEUE_KEY via RPOPLPUSH.
   */
  async processNextJob(): Promise<boolean> {
    if (this.isProcessing || this.isShuttingDown) {
      return false;
    }

    const rawJob = await this.redisService.rpoplpush(
      QUEUE_KEY,
      PROCESSING_QUEUE_KEY,
    );

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

    this.activeVideoId = jobData.videoId;

    try {
      await this.executeTranscoding(jobData);
    } catch (err: unknown) {
      if (this.isShuttingDown) {
        this.logger.warn(
          `Transcoding job for video ${jobData.videoId} interrupted by graceful shutdown. Skipping failure registration.`,
        );
      } else {
        const rawMsg = err instanceof Error ? err.message : String(err);
        const sanitized = this.sanitizeErrorMessage(rawMsg);
        this.logger.error(
          `Transcoding job failed for video ${jobData.videoId}: ${sanitized}`,
        );
      }
    } finally {
      this.activeVideoId = null;
      if (this.isShuttingDown) {
        // Safe graceful shutdown queue management:
        // Safely requeue the job back to QUEUE_KEY before removing from PROCESSING_QUEUE_KEY
        // so it remains immediately recoverable and is not lost if the process exits.
        try {
          await this.redisService.rpush(QUEUE_KEY, rawJob);
          await this.redisService.lrem(PROCESSING_QUEUE_KEY, 1, rawJob);
          this.logger.log(
            `Job for video ${jobData.videoId} (attempt ${jobData.attempt || 1}) safely requeued to transcode queue during shutdown.`,
          );
        } catch (redisErr: unknown) {
          this.logger.warn(
            `Failed to requeue job to Redis during shutdown for video ${jobData.videoId}: ${(redisErr as Error).message}`,
          );
        }
      } else {
        // Remove successfully completed or permanently failed job from processing queue
        await this.redisService.lrem(PROCESSING_QUEUE_KEY, 1, rawJob);
      }
      this.isProcessing = false;

      if (!this.isShuttingDown) {
        const remaining = await this.redisService.llen(QUEUE_KEY);
        if (remaining > 0) {
          setImmediate(() => {
            void this.processNextJob();
          });
        }
      }
    }

    return true;
  }

  /**
   * Execute transcoding and HLS generation for authorized resolutions.
   * Performs real FFmpeg probing, rendition filtering (no upscaling), H.264/AAC encoding,
   * segment writing, and atomic database lifecycle transitions with database fencing.
   */
  async executeTranscoding(jobData: TranscodeJobData): Promise<void> {
    const { videoId, resolutions, storageKey } = jobData;
    const targetAttempt = jobData.attempt || 1;

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

    // Database Fencing on Claim: Worker claims row only if attempt matches and video is eligible
    const [fencedClaim] = await this.db
      .update(schema.videos)
      .set({
        status: 'processing',
        enqueue_state: 'processing',
        active_job_id: lockToken,
        heartbeat_lease: new Date(Date.now() + 60_000),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(schema.videos.id, videoId),
          eq(schema.videos.attempt, targetAttempt),
          or(
            eq(schema.videos.status, 'uploaded'),
            and(
              eq(schema.videos.status, 'processing'),
              or(
                isNull(schema.videos.heartbeat_lease),
                lt(schema.videos.heartbeat_lease, new Date()),
              ),
            ),
          ),
        ),
      )
      .returning({ id: schema.videos.id });

    if (!fencedClaim) {
      this.logger.warn(
        `Worker fenced out on claim for video ${videoId} attempt ${targetAttempt}. Skipping redundant execution.`,
      );
      await this.redisService.releaseLock(lockKey, lockToken);
      return;
    }

    // Active lock renewal heartbeat: extends 600s TTL every 30s during long transcoding
    let isLockValid = true;
    let renewalTimer: NodeJS.Timeout | null = null;
    if (acquired) {
      renewalTimer = setInterval(async () => {
        try {
          const renewed = await this.redisService.renewLock(
            lockKey,
            lockToken,
            600,
          );
          if (!renewed) {
            isLockValid = false;
            this.logger.error(
              `Distributed lock renewal returned false for video ${videoId}. Aborting execution.`,
            );
            await this.ffmpegService.terminateActiveProcess(videoId, 5000);
            return;
          }
          const [fencedLease] = await this.db
            .update(schema.videos)
            .set({
              heartbeat_lease: new Date(Date.now() + 60_000),
            })
            .where(
              and(
                eq(schema.videos.id, videoId),
                eq(schema.videos.attempt, targetAttempt),
                eq(schema.videos.status, 'processing'),
                eq(schema.videos.active_job_id, lockToken),
              ),
            )
            .returning({ id: schema.videos.id });

          if (!fencedLease) {
            isLockValid = false;
            this.logger.error(
              `Database heartbeat lease renewal fenced out for video ${videoId} (attempt ${targetAttempt}): lease ownership superseded. Aborting execution.`,
            );
            await this.ffmpegService.terminateActiveProcess(videoId, 5000);
            return;
          }
        } catch (err: unknown) {
          isLockValid = false;
          this.logger.error(
            `Heartbeat renewal threw exception for video ${videoId}: ${(err as Error).message}. Aborting.`,
          );
          await this.ffmpegService.terminateActiveProcess(videoId, 5000);
        }
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

    this.logger.log(
      `Transcoding video ${videoId} started (attempt ${targetAttempt}).`,
    );

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

      if (!isLockValid) {
        throw new Error(
          `Lock lost prior to FFmpeg transcoding for video ${videoId}`,
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

      if (!isLockValid) {
        throw new Error(
          `Lock lost during FFmpeg execution for video ${videoId}. Aborting storage uploads.`,
        );
      }

      // Explicit verification of distributed lock ownership before R2 uploads (P1.2)
      let preUploadLockOwner: string | null = null;
      try {
        preUploadLockOwner = await this.redisService.get(lockKey);
      } catch {
        preUploadLockOwner = null;
      }
      if (preUploadLockOwner !== lockToken) {
        throw new Error(
          `Distributed lock lost for video ${videoId} prior to R2 storage upload.`,
        );
      }

      // Upload real generated HLS files to storage
      for (const file of transcodeResult.generatedFiles) {
        if (!isLockValid) {
          throw new Error(
            `Lock lost during storage upload for video ${videoId}`,
          );
        }
        let currentLockOwner: string | null = null;
        try {
          currentLockOwner = await this.redisService.get(lockKey);
        } catch {
          currentLockOwner = null;
        }
        if (currentLockOwner !== lockToken) {
          throw new Error(
            `Distributed lock lost during storage upload for video ${videoId}`,
          );
        }
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

      if (!isLockValid) {
        throw new Error(
          `Lock lost before final status transition for video ${videoId}`,
        );
      }

      // Database Fencing on Ready: worker can only mark ready if attempt matches
      const [fencedReady] = await this.db
        .update(schema.videos)
        .set({
          status: 'ready',
          enqueue_state: 'pending',
          master_m3u8_key: masterManifestKey,
          transcoded_size: transcodeResult.totalTranscodedBytes,
          duration: transcodeResult.probedDuration || jobData.duration || 0,
          resolutions: targetRenditions.map((r) => r.name),
          active_job_id: null,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(schema.videos.id, videoId),
            eq(schema.videos.attempt, targetAttempt),
            eq(schema.videos.status, 'processing'),
            eq(schema.videos.active_job_id, lockToken),
          ),
        )
        .returning({ id: schema.videos.id });

      if (!fencedReady) {
        throw new Error(
          `Database fencing prevented commit: video ${videoId} attempt ${targetAttempt} is no longer owned by this worker.`,
        );
      }

      this.logger.log(
        `FFmpeg transcoding completed successfully for video ${videoId}. Status: ready. Master key: ${masterManifestKey}`,
      );
      return;
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const sanitized = this.sanitizeErrorMessage(rawMsg);
      if (this.isShuttingDown) {
        this.logger.warn(
          `Transcoding job for video ${videoId} aborted due to graceful worker shutdown. Preserving state for recovery.`,
        );
        try {
          const stableJobId =
            jobData.jobId || `vdr_job_${videoId}_${targetAttempt}`;
          await this.db
            .update(schema.videos)
            .set({
              status: 'uploaded',
              enqueue_state: 'enqueued',
              active_job_id: stableJobId,
              heartbeat_lease: null,
              updated_at: new Date(),
            })
            .where(
              and(
                eq(schema.videos.id, videoId),
                eq(schema.videos.attempt, targetAttempt),
                eq(schema.videos.status, 'processing'),
                eq(schema.videos.active_job_id, lockToken),
              ),
            );
        } catch (dbErr: unknown) {
          this.logger.warn(
            `Failed to reset enqueue_state on shutdown for video ${videoId}: ${(dbErr as Error).message}`,
          );
        }
      } else {
        this.logger.error(
          `Transcoding job error for video ${videoId}: ${sanitized}`,
        );
        let currentLock: string | null = null;
        try {
          currentLock = await this.redisService.get(lockKey);
        } catch {
          currentLock = null;
        }

        if (currentLock !== lockToken) {
          this.logger.warn(
            `Worker lost Redis lock ownership (${currentLock} !== ${lockToken}) for video ${videoId}. Fenced out from failure transition.`,
          );
        } else {
          const marked = await this.markWorkerJobFailed(
            videoId,
            sanitized,
            targetAttempt,
            lockToken,
          );
          if (!marked) {
            this.logger.warn(
              `Fenced out from marking video ${videoId} failed for attempt ${targetAttempt}.`,
            );
          }
        }
      }
      throw err;
    } finally {
      if (renewalTimer) {
        clearInterval(renewalTimer);
      }
      await this.ffmpegService.terminateActiveProcess(videoId, 5000);
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

    if (
      dto.attempt === undefined ||
      dto.attempt === null ||
      typeof dto.attempt !== 'number' ||
      dto.attempt < 1 ||
      !Number.isInteger(dto.attempt)
    ) {
      throw new BadRequestException(
        'Webhook payload must specify a valid positive integer attempt',
      );
    }

    const targetAttempt = dto.attempt;

    if (dto.status === 'failed') {
      const marked = await this.markWebhookJobFailed(
        dto.videoId,
        dto.errorMessage || 'Cloud transcoder reported job failure',
        targetAttempt,
      );
      if (!marked) {
        this.logger.warn(
          `Webhook failure registration for video ${dto.videoId} fenced out (attempt ${targetAttempt}).`,
        );
      }
      return { success: false, message: 'Transcoding failure registered' };
    }

    // Confirm that masterKey exists and is properly formed
    if (!dto.masterKey || !dto.masterKey.endsWith('.m3u8')) {
      throw new BadRequestException('Invalid master manifest key format');
    }

    // Verify whether an active local worker currently holds the distributed lock and an active lease
    let localLock: string | null = null;
    try {
      localLock = await this.redisService.get(
        CACHE_KEYS.transcodeLock(dto.videoId),
      );
    } catch {
      localLock = null;
    }

    if (
      localLock &&
      video.heartbeat_lease &&
      new Date(video.heartbeat_lease) > new Date()
    ) {
      this.logger.warn(
        `Webhook ready registration for video ${dto.videoId} rejected: active local worker ${localLock} holds valid lease until ${video.heartbeat_lease.toISOString()}.`,
      );
      return {
        success: false,
        message:
          'Fenced out: active local worker is currently processing this video',
      };
    }

    // Update video to ready with fencing: matching attempt, processing status, and NO active local worker lease
    const [fencedReady] = await this.db
      .update(schema.videos)
      .set({
        status: 'ready',
        enqueue_state: 'pending',
        active_job_id: null,
        master_m3u8_key: dto.masterKey,
        duration: dto.totalDuration,
        transcoded_size: BigInt(dto.transcodedSize),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(schema.videos.id, dto.videoId),
          eq(schema.videos.attempt, targetAttempt),
          eq(schema.videos.status, 'processing'),
          or(
            isNull(schema.videos.heartbeat_lease),
            lt(schema.videos.heartbeat_lease, new Date()),
          ),
        ),
      )
      .returning({ id: schema.videos.id });

    if (!fencedReady) {
      this.logger.warn(
        `Webhook ready registration for video ${dto.videoId} fenced out: video is no longer in processing state, attempt changed, or active worker holds lease.`,
      );
      return {
        success: false,
        message:
          'Fenced out: active worker holds lease, video not in processing state, or attempt changed',
      };
    }

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
   * Safely marks a worker-transcoded video as failed with diagnostic reason and attempt number.
   * STRICT FENCING:
   * 1. Requires exact matching video ID.
   * 2. Requires exact matching attempt number.
   * 3. Requires status = 'processing'.
   * 4. MANDATORY ownerToken: Requires active_job_id = ownerToken.
   * 5. Requires heartbeat_lease > NOW(): Worker must hold an active, unexpired lease.
   */
  async markWorkerJobFailed(
    videoId: string,
    reason: string,
    attempt: number,
    ownerToken: string,
  ): Promise<boolean> {
    if (!ownerToken || typeof ownerToken !== 'string' || ownerToken.trim().length === 0) {
      this.logger.error(
        `Worker failure transition rejected for video ${videoId}: mandatory ownerToken is missing or invalid.`,
      );
      return false;
    }
    const sanitizedReason = this.sanitizeErrorMessage(reason);
    this.logger.warn(
      `Marking video ${videoId} as failed by worker (attempt ${attempt}, owner: ${ownerToken}): ${sanitizedReason}`,
    );

    const [fenced] = await this.db
      .update(schema.videos)
      .set({
        status: 'failed',
        enqueue_state: 'pending',
        attempt,
        active_job_id: null,
        heartbeat_lease: null,
        last_error: sanitizedReason,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(schema.videos.id, videoId),
          eq(schema.videos.attempt, attempt),
          eq(schema.videos.status, 'processing'),
          eq(schema.videos.active_job_id, ownerToken),
          gt(schema.videos.heartbeat_lease, new Date()),
        ),
      )
      .returning({ id: schema.videos.id });

    if (!fenced) {
      this.logger.warn(
        `Fenced out from marking video ${videoId} as failed: worker ${ownerToken} lost ownership, lease expired, or status changed.`,
      );
      return false;
    }
    return true;
  }

  /**
   * Safely marks a video as failed when reported by an external cloud transcoder webhook.
   * FENCING:
   * 1. Requires exact matching video ID.
   * 2. Requires exact matching attempt number.
   * 3. Requires status = 'processing'.
   * 4. Prohibits overwriting active local worker: heartbeat_lease must be NULL or expired.
   */
  async markWebhookJobFailed(
    videoId: string,
    reason: string,
    attempt: number,
  ): Promise<boolean> {
    const sanitizedReason = this.sanitizeErrorMessage(reason);
    this.logger.warn(
      `Marking video ${videoId} as failed via webhook (attempt ${attempt}): ${sanitizedReason}`,
    );

    const [fenced] = await this.db
      .update(schema.videos)
      .set({
        status: 'failed',
        enqueue_state: 'pending',
        attempt,
        active_job_id: null,
        heartbeat_lease: null,
        last_error: sanitizedReason,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(schema.videos.id, videoId),
          eq(schema.videos.attempt, attempt),
          eq(schema.videos.status, 'processing'),
          or(
            isNull(schema.videos.heartbeat_lease),
            lt(schema.videos.heartbeat_lease, new Date()),
          ),
        ),
      )
      .returning({ id: schema.videos.id });

    if (!fenced) {
      this.logger.warn(
        `Webhook failure registration for video ${videoId} fenced out: active worker holds valid lease or status changed.`,
      );
      return false;
    }
    return true;
  }

  /**
   * Safely marks a video as terminal failed when recovery sweeper exhausts maximum retries.
   * FENCING:
   * 1. Requires exact matching video ID.
   * 2. Requires exact matching attempt number.
   * 3. Requires status = 'processing'.
   * 4. Requires heartbeat_lease IS NULL or expired.
   */
  async markSweeperJobFailed(
    videoId: string,
    reason: string,
    attempt: number,
  ): Promise<boolean> {
    const sanitizedReason = this.sanitizeErrorMessage(reason);
    this.logger.warn(
      `Marking video ${videoId} as terminal failed by sweeper (attempt ${attempt}): ${sanitizedReason}`,
    );

    const [fenced] = await this.db
      .update(schema.videos)
      .set({
        status: 'failed',
        enqueue_state: 'pending',
        attempt,
        active_job_id: null,
        heartbeat_lease: null,
        last_error: sanitizedReason,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(schema.videos.id, videoId),
          eq(schema.videos.attempt, attempt),
          eq(schema.videos.status, 'processing'),
          or(
            isNull(schema.videos.heartbeat_lease),
            lt(schema.videos.heartbeat_lease, new Date()),
          ),
        ),
      )
      .returning({ id: schema.videos.id });

    if (!fenced) {
      this.logger.warn(
        `Sweeper failure registration for video ${videoId} fenced out: attempt ${attempt} is no longer active, lease active, or status changed.`,
      );
      return false;
    }
    return true;
  }

  /**
   * Backward-compatible alias for worker failure transitions. Enforces mandatory ownerToken.
   */
  async markVideoFailed(
    videoId: string,
    reason: string,
    attempt: number,
    ownerToken: string,
  ): Promise<boolean> {
    return this.markWorkerJobFailed(videoId, reason, attempt, ownerToken);
  }

  /**
   * Recovers jobs stranded in processing queue, stale dispatches, or expired worker leases.
   * Re-enqueues interrupted jobs up to 3 attempts with authoritative attempt increment, or safely marks them failed.
   */
  async recoverStuckJobs(thresholdMs = 15 * 60 * 1000): Promise<string[]> {
    const recoveredIds: string[] = [];

    // 1. Reconciliation of Stale Dispatches (>15 minutes in 'enqueued' state)
    try {
      const staleCutoff = new Date(Date.now() - thresholdMs);
      const staleEnqueued = await this.db
        .select()
        .from(schema.videos)
        .where(
          and(
            eq(schema.videos.status, 'uploaded'),
            eq(schema.videos.enqueue_state, 'enqueued'),
            lt(schema.videos.enqueued_at, staleCutoff),
          ),
        )
        .limit(50);

      for (const vid of staleEnqueued) {
        if (!vid || !vid.id) continue;
        const inFlightQueue = await this.redisService.lrange(QUEUE_KEY, 0, -1);
        const inProcQueue = await this.redisService.lrange(
          PROCESSING_QUEUE_KEY,
          0,
          -1,
        );
        const alreadyInRedis = [...inFlightQueue, ...inProcQueue].some((raw) => {
          try {
            const parsed = JSON.parse(raw);
            return parsed.videoId === vid.id;
          } catch {
            return false;
          }
        });

        if (!alreadyInRedis) {
          const stableJobId =
            vid.active_job_id || `vdr_job_${vid.id}_${vid.attempt || 1}`;
          const payload = JSON.stringify({
            jobId: stableJobId,
            videoId: vid.id,
            userId: vid.user_id,
            storageKey: vid.storage_key,
            bucketId: vid.bucket_id || undefined,
            resolutions: vid.resolutions || ['720p'],
            title: vid.title,
            slug: vid.slug,
            duration: vid.duration,
            attempt: vid.attempt || 1,
          });
          const [reconciled] = await this.db
            .update(schema.videos)
            .set({ enqueued_at: new Date(), updated_at: new Date() })
            .where(
              and(
                eq(schema.videos.id, vid.id),
                eq(schema.videos.enqueue_state, 'enqueued'),
                eq(schema.videos.status, 'uploaded'),
                lt(schema.videos.enqueued_at, staleCutoff),
              ),
            )
            .returning({ id: schema.videos.id });

          if (!reconciled) {
            continue;
          }

          await this.redisService.rpush(QUEUE_KEY, payload);
          this.logger.log(`Reconciled stale dispatch for video ${vid.id}`);
          recoveredIds.push(vid.id);
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Stale dispatch reconciliation error: ${(err as Error).message}`,
      );
    }

    // 2. Reconciliation of Stranded Uploads (>10s in 'pending' enqueue_state with status 'uploaded')
    try {
      const strandedCutoff = new Date(Date.now() - 10_000);
      const strandedUploads = await this.db
        .select()
        .from(schema.videos)
        .where(
          and(
            eq(schema.videos.status, 'uploaded'),
            eq(schema.videos.enqueue_state, 'pending'),
            lt(schema.videos.updated_at, strandedCutoff),
          ),
        )
        .limit(50);

      for (const vid of strandedUploads) {
        if (!vid || !vid.id) continue;
        const enqueued = await this.enqueueTranscodeJob({
          jobId: `vdr_job_${vid.id}_1`,
          videoId: vid.id,
          userId: vid.user_id,
          storageKey: vid.storage_key || '',
          bucketId: vid.bucket_id || undefined,
          resolutions: vid.resolutions || ['720p'],
          title: vid.title,
          slug: vid.slug,
          duration: vid.duration,
          attempt: 1,
        });
        if (enqueued) {
          recoveredIds.push(vid.id);
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Stranded upload reconciliation error: ${(err as Error).message}`,
      );
    }

    // 3. Recovery of Expired Worker Leases / Crashed Workers (heartbeat_lease < NOW())
    try {
      const expiredLeases = await this.db
        .select()
        .from(schema.videos)
        .where(
          and(
            eq(schema.videos.status, 'processing'),
            eq(schema.videos.enqueue_state, 'processing'),
            lt(schema.videos.heartbeat_lease, new Date()),
          ),
        )
        .limit(50);

      for (const vid of expiredLeases) {
        if (!vid || !vid.id) continue;
        const lockKey = CACHE_KEYS.transcodeLock(vid.id);
        const lockVal = await this.redisService.get(lockKey);
        if (!lockVal) {
          if (vid.attempt < 3) {
            const nextAttempt = vid.attempt + 1;
            const nextJobId = `vdr_job_${vid.id}_${nextAttempt}`;
            const [claimedForRecovery] = await this.db
              .update(schema.videos)
              .set({
                attempt: nextAttempt,
                active_job_id: nextJobId,
                enqueue_state: 'enqueued',
                enqueued_at: new Date(),
                updated_at: new Date(),
              })
              .where(
                and(
                  eq(schema.videos.id, vid.id),
                  eq(schema.videos.attempt, vid.attempt),
                  eq(schema.videos.status, 'processing'),
                  eq(schema.videos.enqueue_state, 'processing'),
                ),
              )
              .returning({ id: schema.videos.id });

            if (!claimedForRecovery) {
              this.logger.warn(
                `Sweeper lost race to recover video ${vid.id} attempt ${vid.attempt}. Skipping Redis push.`,
              );
              continue;
            }

            await this.redisService.rpush(
              QUEUE_KEY,
              JSON.stringify({
                jobId: nextJobId,
                videoId: vid.id,
                userId: vid.user_id,
                storageKey: vid.storage_key,
                bucketId: vid.bucket_id || undefined,
                resolutions: vid.resolutions || ['720p'],
                title: vid.title,
                slug: vid.slug,
                duration: vid.duration,
                attempt: nextAttempt,
              }),
            );
            recoveredIds.push(vid.id);
            this.logger.log(
              `Recovered expired lease for video ${vid.id}: enqueued attempt ${nextAttempt}`,
            );
          } else {
            await this.markSweeperJobFailed(
              vid.id,
              'Transcoding job exceeded maximum 3 retry attempts',
              vid.attempt,
            );
            recoveredIds.push(vid.id);
          }
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Expired lease recovery error: ${(err as Error).message}`,
      );
    }

    // 4. Processing Queue Cleanup and Recovery of interrupted jobs without active lock
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
            const [videoRecord] = await this.db
              .select({
                status: schema.videos.status,
                attempt: schema.videos.attempt,
              })
              .from(schema.videos)
              .where(eq(schema.videos.id, jobData.videoId))
              .limit(1);

            if (
              videoRecord?.status === 'ready' ||
              videoRecord?.status === 'failed' ||
              (jobData.attempt && jobData.attempt < (videoRecord?.attempt || 1))
            ) {
              await this.redisService.lrem(PROCESSING_QUEUE_KEY, 1, rawJob);
            } else {
              const currentAttempts =
                jobData.attempt ?? jobData.attempts ?? 1;
              if (currentAttempts < 3) {
                const nextAttempt = currentAttempts + 1;
                const nextJobId = `vdr_job_${jobData.videoId}_${nextAttempt}`;

                // Conditional DB update must precede Redis enqueueing (P1.1)
                const [claimedForRecovery] = await this.db
                  .update(schema.videos)
                  .set({
                    attempt: nextAttempt,
                    active_job_id: nextJobId,
                    enqueue_state: 'enqueued',
                    enqueued_at: new Date(),
                    updated_at: new Date(),
                  })
                  .where(
                    and(
                      eq(schema.videos.id, jobData.videoId),
                      eq(schema.videos.attempt, currentAttempts),
                      eq(schema.videos.status, 'processing'),
                    ),
                  )
                  .returning({ id: schema.videos.id });

                await this.redisService.lrem(PROCESSING_QUEUE_KEY, 1, rawJob);

                if (!claimedForRecovery) {
                  this.logger.warn(
                    `Processing queue recovery skipped for video ${jobData.videoId}: attempt ${currentAttempts} is no longer owned or status changed.`,
                  );
                  continue;
                }

                jobData.attempt = nextAttempt;
                jobData.attempts = nextAttempt;
                jobData.jobId = nextJobId;
                await this.redisService.rpush(
                  QUEUE_KEY,
                  JSON.stringify(jobData),
                );
                this.logger.log(
                  `Recovered interrupted job for video ${jobData.videoId}, re-enqueued attempt ${nextAttempt}`,
                );
                recoveredIds.push(jobData.videoId);
              } else {
                await this.redisService.lrem(PROCESSING_QUEUE_KEY, 1, rawJob);
                await this.markSweeperJobFailed(
                  jobData.videoId,
                  'Transcoding job exceeded maximum 3 retry attempts',
                  currentAttempts,
                );
                recoveredIds.push(jobData.videoId);
              }
            }
          }
        } catch {
          await this.redisService.lrem(PROCESSING_QUEUE_KEY, 1, rawJob);
        }
      }
    } catch (queueErr: unknown) {
      this.logger.warn(
        `Error reading processing queue for recovery: ${(queueErr as Error).message}`,
      );
    }

    const appRole = process.env.APP_ROLE || 'monolith';
    if (recoveredIds.length > 0 && appRole !== 'api') {
      setImmediate(() => {
        void this.processNextJob();
      });
    }

    return recoveredIds;
  }
}
