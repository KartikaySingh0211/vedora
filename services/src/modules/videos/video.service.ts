import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
  Optional,
} from '@nestjs/common';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { DrizzleDb } from '../../database/database.module';
import { videos, playlist, VideoStatus } from '../../database/schema';
import type { Video } from '../../database/schema';
import { CreateVideoInitDto } from './dto/create-video-init.dto';
import { CompleteVideoUploadDto } from './dto/complete-video-upload.dto';
import { CACHE_KEYS } from '../../common/cache-keys';
import {
  StorageService,
  StorageInitiateResult,
} from '../../infra/storage/storage.service';
import {
  PLAN_LIMITS,
  UserPlan,
  calculateEstimatedTranscodedSize,
  GIB_BYTES,
} from '../../config/plans.config';
import { TranscoderService } from '../transcoder/transcoder.service';

export interface VideoResponse {
  id: string;
  userId: string;
  playlistId: string | null;
  title: string;
  slug: string;
  description: string | null;
  tags: string[];
  storageKey: string | null;
  bucketId: string | null;
  size: number;
  estimatedTranscodedSize: number;
  transcodedSize: number | null;
  duration: number;
  status: VideoStatus;
  resolutions: string[];
  thumbnailUrl: string | null;
  generateSubtitles: boolean;
  includeWatermark: boolean;
  masterM3u8Key: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VideoInitResponse {
  video: VideoResponse;
  uploadData: StorageInitiateResult;
  bucketId: string;
}

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly storageService: StorageService,
    @Optional() private readonly transcoderService?: TranscoderService,
  ) {}

  /**
   * Safely serialize database video entity to API JSON response
   * Converts BigInt sizes to safe JavaScript numbers
   */
  private serializeVideo(row: Video): VideoResponse {
    return {
      id: row.id,
      userId: row.user_id,
      playlistId: row.playlist_id,
      title: row.title,
      slug: row.slug,
      description: row.description,
      tags: row.tags || [],
      storageKey: row.storage_key,
      bucketId: row.bucket_id,
      size: Number(row.size),
      estimatedTranscodedSize: Number(row.estimated_transcoded_size),
      transcodedSize: row.transcoded_size ? Number(row.transcoded_size) : null,
      duration: row.duration,
      status: row.status,
      resolutions: row.resolutions || ['720p'],
      thumbnailUrl: row.thumbnail_url,
      generateSubtitles: row.generate_subtitles,
      includeWatermark: row.include_watermark,
      masterM3u8Key: row.master_m3u8_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Compute total active storage reserved/utilized by a user in bytes.
   * Scoped to non-failed, non-deleted lifecycle states.
   */
  private async calculateUserActiveStorageUsage(
    tx: Parameters<Parameters<DrizzleDb['transaction']>[0]>[0],
    userId: string,
  ): Promise<bigint> {
    const activeVideos = await tx
      .select({
        size: videos.size,
        estimatedTranscodedSize: videos.estimated_transcoded_size,
      })
      .from(videos)
      .where(
        and(
          eq(videos.user_id, userId),
          inArray(videos.status, [
            'uploading',
            'uploaded',
            'processing',
            'ready',
          ]),
        ),
      );

    let currentUsage = 0n;
    for (const v of activeVideos) {
      currentUsage += BigInt(v.size) + BigInt(v.estimatedTranscodedSize);
    }
    return currentUsage;
  }

  /**
   * Initialize a video upload:
   * 1. Acquire transaction advisory lock on user storage quota to prevent race conditions
   * 2. Calculate active storage reservation and verify quota
   * 3. Validate playlist relationship if specified
   * 4. Request multipart upload configuration from OneMinute Cloud Storage
   * 5. Persist video record with status 'uploading'
   */
  async initVideo(
    userId: string,
    userPlan: UserPlan,
    dto: CreateVideoInitDto,
  ): Promise<VideoInitResponse> {
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const rawSizeBytes = BigInt(dto.size);
    const resolutions =
      dto.resolutions && dto.resolutions.length > 0
        ? dto.resolutions
        : ['720p'];
    const estimatedTranscodedSize = calculateEstimatedTranscodedSize(
      rawSizeBytes,
      resolutions,
    );
    const incomingReservation = rawSizeBytes + estimatedTranscodedSize;
    const planConfig = PLAN_LIMITS[userPlan];

    return await this.db.transaction(async (tx) => {
      // 1. Transaction-level PostgreSQL advisory lock preventing concurrent quota races
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${CACHE_KEYS.storageQuotaLock(userId)}))`,
      );

      // 2. Query active storage for user
      const currentUsage = await this.calculateUserActiveStorageUsage(
        tx,
        userId,
      );

      if (currentUsage + incomingReservation > planConfig.storageCapBytes) {
        const currentGb = (Number(currentUsage) / Number(GIB_BYTES)).toFixed(2);
        const incomingGb = (
          Number(incomingReservation) / Number(GIB_BYTES)
        ).toFixed(2);
        const capGb = (
          Number(planConfig.storageCapBytes) / Number(GIB_BYTES)
        ).toFixed(0);

        throw new BadRequestException(
          `Storage quota exceeded. Current active storage (${currentGb} GiB) plus incoming reservation (${incomingGb} GiB) exceeds your ${planConfig.displayName} limit of ${capGb} GiB.`,
        );
      }

      // 3. Verify playlist ownership if playlistId is provided
      if (dto.playlistId) {
        const [playlistRecord] = await tx
          .select()
          .from(playlist)
          .where(
            and(eq(playlist.id, dto.playlistId), eq(playlist.user_id, userId)),
          );

        if (!playlistRecord) {
          throw new BadRequestException(
            'Specified playlist not found or not owned by authenticated user',
          );
        }
      }

      // 4. Request multipart upload credentials from OneMinute Cloud Storage
      const bucketId = this.storageService.getDefaultBucketId();
      const filename = `${dto.slug}.mp4`;
      const duration =
        dto.duration && dto.duration > 0
          ? dto.duration
          : Math.max(10, Math.round(dto.size / ((1.5 * 1024 * 1024) / 8)));

      const uploadData = await this.storageService.initiateMultipartUpload(
        bucketId,
        filename,
        dto.size,
        duration,
      );

      // 5. Create video record with status 'uploading'
      const [inserted] = await tx
        .insert(videos)
        .values({
          user_id: userId,
          playlist_id: dto.playlistId || null,
          title: dto.title,
          slug: dto.slug,
          description: dto.description || null,
          tags: dto.tags || [],
          storage_key: uploadData.key,
          bucket_id: bucketId,
          size: rawSizeBytes,
          estimated_transcoded_size: estimatedTranscodedSize,
          duration: dto.duration || 0,
          status: 'uploading',
          resolutions,
          generate_subtitles: dto.generateSubtitles ?? false,
          include_watermark: dto.includeWatermark ?? false,
        })
        .returning();

      return {
        video: this.serializeVideo(inserted),
        uploadData,
        bucketId,
      };
    });
  }

  /**
   * Confirm upload completion:
   * 1. Validate video existence and ownership
   * 2. Idempotent state transition (uploading -> uploaded)
   * 3. Verify storage key consistency
   * 4. Atomically increment playlist total_videos count
   */
  async completeVideo(
    userId: string,
    dto: CompleteVideoUploadDto,
  ): Promise<VideoResponse> {
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    return await this.db.transaction(async (tx) => {
      // 1. Fetch video record scoped to owner
      const [videoRecord] = await tx
        .select()
        .from(videos)
        .where(and(eq(videos.id, dto.videoId), eq(videos.user_id, userId)));

      if (!videoRecord) {
        throw new NotFoundException('Video not found or access denied');
      }

      // 2. Idempotent check: if already completed, return without double-counting
      if (
        videoRecord.status === 'uploaded' ||
        videoRecord.status === 'processing' ||
        videoRecord.status === 'ready'
      ) {
        return this.serializeVideo(videoRecord);
      }

      if (videoRecord.status !== 'uploading') {
        throw new BadRequestException(
          `Video cannot be marked complete from status '${videoRecord.status}'`,
        );
      }

      // 3. Verify storage key matches initialized record
      if (
        videoRecord.storage_key &&
        videoRecord.storage_key !== dto.storageKey
      ) {
        throw new BadRequestException(
          'Supplied storage key does not match initialized upload key',
        );
      }

      // 4. Notify storage provider of completion
      if (videoRecord.bucket_id && videoRecord.storage_key) {
        await this.storageService.completeMultipartUpload(
          videoRecord.bucket_id,
          'omc_obj_verified',
          dto.uploadId || 'omc_upl_verified',
          dto.storageKey,
          dto.parts || [],
        );
      }

      // 5. Update video status and duration
      const [updatedVideo] = await tx
        .update(videos)
        .set({
          status: 'uploaded',
          duration: dto.duration || videoRecord.duration,
          storage_key: dto.storageKey,
          updated_at: new Date(),
        })
        .where(eq(videos.id, dto.videoId))
        .returning();

      // 6. Atomically increment playlist video count if assigned to a playlist
      if (videoRecord.playlist_id) {
        await tx
          .update(playlist)
          .set({
            total_videos: sql`${playlist.total_videos} + 1`,
          })
          .where(eq(playlist.id, videoRecord.playlist_id));
      }

      const serialized = this.serializeVideo(updatedVideo);

      // 7. Enqueue asynchronous transcoding job
      if (this.transcoderService) {
        await this.transcoderService
          .enqueueTranscodeJob({
            videoId: updatedVideo.id,
            userId: updatedVideo.user_id,
            storageKey: updatedVideo.storage_key || dto.storageKey,
            bucketId: updatedVideo.bucket_id || undefined,
            resolutions: updatedVideo.resolutions || ['720p'],
            title: updatedVideo.title,
            slug: updatedVideo.slug,
            duration: updatedVideo.duration,
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `Failed to enqueue transcode job for video ${updatedVideo.id}: ${msg}`,
            );
          });
      }

      return serialized;
    });
  }

  /**
   * List videos for authenticated user with optional playlist filtering
   */
  async listVideos(
    userId: string,
    playlistId?: string,
  ): Promise<VideoResponse[]> {
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const conditions = [eq(videos.user_id, userId)];
    if (playlistId) {
      conditions.push(eq(videos.playlist_id, playlistId));
    }

    const records = await this.db
      .select()
      .from(videos)
      .where(and(...conditions))
      .orderBy(desc(videos.created_at));

    return records.map((r) => this.serializeVideo(r));
  }

  /**
   * Fetch single video detail for authenticated owner
   */
  async getVideo(userId: string, videoId: string): Promise<VideoResponse> {
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const [record] = await this.db
      .select()
      .from(videos)
      .where(and(eq(videos.id, videoId), eq(videos.user_id, userId)));

    if (!record) {
      throw new NotFoundException('Video not found or access denied');
    }

    return this.serializeVideo(record);
  }

  /**
   * Delete video with atomic playlist count decrement and quota release
   */
  async deleteVideo(
    userId: string,
    videoId: string,
  ): Promise<{ success: boolean; id: string }> {
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    return await this.db.transaction(async (tx) => {
      const [record] = await tx
        .select()
        .from(videos)
        .where(and(eq(videos.id, videoId), eq(videos.user_id, userId)));

      if (!record) {
        throw new NotFoundException('Video not found or access denied');
      }

      // If video was part of a playlist and was uploaded, decrement count exactly once
      if (
        record.playlist_id &&
        record.status !== 'uploading' &&
        record.status !== 'failed'
      ) {
        await tx
          .update(playlist)
          .set({
            total_videos: sql`GREATEST(0, ${playlist.total_videos} - 1)`,
          })
          .where(eq(playlist.id, record.playlist_id));
      }

      // Delete video record (frees quota in subsequent accounting checks)
      await tx.delete(videos).where(eq(videos.id, videoId));

      return { success: true, id: videoId };
    });
  }
}
