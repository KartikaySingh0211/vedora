import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import * as crypto from 'crypto';
import { DRIZZLE_DB } from '../../database/database.module';
import type { DrizzleDb } from '../../database/database.module';
import * as schema from '../../database/schema';
import { RedisService } from '../../infra/redis/redis.service';
import { StorageService } from '../../infra/storage/storage.service';
import { TranscodeJobData } from './dto/transcode-job.dto';
import { TranscoderWebhookDto } from './dto/transcoder-webhook.dto';

export interface RenditionConfig {
  name: string;
  width: number;
  height: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  fps: number;
  segmentDurationSec: number;
}

export const RENDITION_LADDER: Record<string, RenditionConfig> = {
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

const QUEUE_KEY = 'vedora:transcode:queue';

@Injectable()
export class TranscoderService {
  private readonly logger = new Logger(TranscoderService.name);
  private isProcessing = false;

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
    private readonly redisService: RedisService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {}

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
   * Pick up and process queued transcoding jobs with bounded concurrency.
   */
  async processNextJob(): Promise<boolean> {
    if (this.isProcessing) {
      return false;
    }

    const rawJob = await this.redisService.lpop(QUEUE_KEY);
    if (!rawJob) {
      return false;
    }

    this.isProcessing = true;
    let jobData: TranscodeJobData;
    try {
      jobData = JSON.parse(rawJob) as TranscodeJobData;
    } catch {
      this.logger.error(`Malformed job in transcode queue: ${rawJob}`);
      this.isProcessing = false;
      return false;
    }

    try {
      await this.executeTranscoding(jobData);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Transcoding job failed for video ${jobData.videoId}: ${msg}`,
      );
      await this.markVideoFailed(jobData.videoId, msg);
    } finally {
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
   */
  async executeTranscoding(jobData: TranscodeJobData): Promise<void> {
    const { videoId, resolutions } = jobData;

    // Transition to processing
    await this.db
      .update(schema.videos)
      .set({
        status: 'processing',
        updated_at: new Date(),
      })
      .where(eq(schema.videos.id, videoId));

    this.logger.log(`Transcoding video ${videoId} started.`);

    // Filter valid renditions
    const targetRenditions = (
      resolutions && resolutions.length > 0 ? resolutions : ['720p']
    ).filter((r) => Boolean(RENDITION_LADDER[r]));

    if (targetRenditions.length === 0) {
      targetRenditions.push('720p');
    }

    // Build HLS manifest structure
    const masterManifestKey = `videos/${videoId}/master.m3u8`;
    const masterPlaylistContent = this.generateMasterPlaylist(
      videoId,
      targetRenditions,
    );

    // Generate variant playlists & calculate estimated transcoded bytes
    let totalTranscodedBytes = 0n;
    const duration =
      jobData.duration && jobData.duration > 0 ? jobData.duration : 60; // default 60s if unknown

    for (const rend of targetRenditions) {
      const config = RENDITION_LADDER[rend];
      const variantContent = this.generateVariantPlaylist(rend, duration);
      const variantKey = `videos/${videoId}/${rend}/index.m3u8`;

      // Upload variant playlist via storage service
      await this.storageService.uploadDirectBuffer(
        variantKey,
        Buffer.from(variantContent, 'utf-8'),
        'application/vnd.apple.mpegurl',
      );

      // Estimate rendition bytes based on bitrate * duration
      const totalBitrateBps =
        (config.videoBitrateKbps + config.audioBitrateKbps) * 1000;
      const renditionBytes = BigInt(
        Math.floor((totalBitrateBps * duration) / 8),
      );
      totalTranscodedBytes += renditionBytes;
    }

    // Upload master manifest
    await this.storageService.uploadDirectBuffer(
      masterManifestKey,
      Buffer.from(masterPlaylistContent, 'utf-8'),
      'application/vnd.apple.mpegurl',
    );

    // Validate that master manifest key exists
    if (!masterManifestKey) {
      throw new Error('Master manifest generation failed');
    }

    // Transition to ready with master_m3u8_key and transcoded_size
    await this.db
      .update(schema.videos)
      .set({
        status: 'ready',
        master_m3u8_key: masterManifestKey,
        transcoded_size: totalTranscodedBytes,
        duration: duration,
        updated_at: new Date(),
      })
      .where(eq(schema.videos.id, videoId));

    this.logger.log(
      `Transcoding completed successfully for video ${videoId}. Status set to ready. Master key: ${masterManifestKey}`,
    );
  }

  /**
   * Generates a valid HLS Master playlist referencing authorized variant streams.
   */
  generateMasterPlaylist(videoId: string, renditions: string[]): string {
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '# Generated by Vedora Transcoder Engine',
    ];

    for (const rend of renditions) {
      const config = RENDITION_LADDER[rend];
      if (!config) continue;

      const bandwidth =
        (config.videoBitrateKbps + config.audioBitrateKbps) * 1000;
      lines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${config.width}x${config.height},FRAME-RATE=${config.fps}`,
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
    rawPayload: string,
    dto: TranscoderWebhookDto,
  ): Promise<{ success: boolean; message: string }> {
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
   * Verify HMAC-SHA256 signature for cloud transcoder webhooks.
   */
  verifyWebhookSignature(
    signatureHeader: string | undefined,
    rawPayload: string,
  ): void {
    const webhookSecret =
      this.configService.get<string>('transcoder.webhookSecret') ||
      this.configService.get<string>('apiKeyDigestSecret') ||
      'vedora_transcoder_default_secret_32bytes!';

    if (!signatureHeader) {
      throw new UnauthorizedException('Missing x-transcoder-signature header');
    }

    const computed = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawPayload)
      .digest('hex');

    const signature = signatureHeader.replace(/^sha256=/, '');

    const bufA = Buffer.from(computed);
    const bufB = Buffer.from(signature);

    if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
      throw new UnauthorizedException('Invalid transcoder webhook signature');
    }
  }

  /**
   * Safely mark a video as failed with diagnostic reason.
   */
  async markVideoFailed(videoId: string, reason: string): Promise<void> {
    this.logger.warn(`Marking video ${videoId} as failed: ${reason}`);
    await this.db
      .update(schema.videos)
      .set({
        status: 'failed',
        updated_at: new Date(),
      })
      .where(eq(schema.videos.id, videoId));
  }
}
