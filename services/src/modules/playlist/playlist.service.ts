import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { DrizzleDb } from '../../database/database.module';
import { playlist } from '../../database/schema';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';

export interface PlaylistResponse {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  playlistLimit: number;
  totalVideos: number;
  createdAt: Date;
}

@Injectable()
export class PlaylistService {
  private readonly logger = new Logger(PlaylistService.name);
  private readonly DEFAULT_PLAYLIST_LIMIT = 10;

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  /**
   * Create a playlist with strict quota enforcement and concurrent protection
   */
  async createPlaylist(
    userId: string,
    dto: CreatePlaylistDto,
  ): Promise<PlaylistResponse> {
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    return await this.db.transaction(async (tx) => {
      // 1. Acquire transaction advisory lock on user's quota key to prevent concurrent bypass
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`vedora_playlist_quota_${userId}`}))`,
      );

      // 2. Count current playlists owned by this user
      const [currentCountResult] = await tx
        .select({ value: count() })
        .from(playlist)
        .where(eq(playlist.user_id, userId));

      const currentCount = currentCountResult?.value || 0;

      if (currentCount >= this.DEFAULT_PLAYLIST_LIMIT) {
        throw new BadRequestException(
          `Playlist quota exceeded. You have reached the maximum allowed limit of ${this.DEFAULT_PLAYLIST_LIMIT} playlists.`,
        );
      }

      // 3. Insert new playlist
      const [inserted] = await tx
        .insert(playlist)
        .values({
          user_id: userId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          playlist_limit: this.DEFAULT_PLAYLIST_LIMIT,
          total_videos: 0,
        })
        .returning();

      return {
        id: inserted.id,
        userId: inserted.user_id,
        name: inserted.name,
        description: inserted.description,
        playlistLimit: inserted.playlist_limit,
        totalVideos: inserted.total_videos,
        createdAt: inserted.created_at,
      };
    });
  }

  /**
   * List all playlists owned by the authenticated user
   */
  async listPlaylists(userId: string): Promise<PlaylistResponse[]> {
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const records = await this.db
      .select()
      .from(playlist)
      .where(eq(playlist.user_id, userId))
      .orderBy(desc(playlist.created_at));

    return records.map((p) => ({
      id: p.id,
      userId: p.user_id,
      name: p.name,
      description: p.description,
      playlistLimit: p.playlist_limit,
      totalVideos: p.total_videos,
      createdAt: p.created_at,
    }));
  }

  /**
   * Fetch a single playlist by ID (enforcing user ownership)
   */
  async getPlaylist(userId: string, id: string): Promise<PlaylistResponse> {
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const records = await this.db
      .select()
      .from(playlist)
      .where(and(eq(playlist.id, id), eq(playlist.user_id, userId)))
      .limit(1);

    if (records.length === 0) {
      throw new NotFoundException('Playlist not found');
    }

    const p = records[0];
    return {
      id: p.id,
      userId: p.user_id,
      name: p.name,
      description: p.description,
      playlistLimit: p.playlist_limit,
      totalVideos: p.total_videos,
      createdAt: p.created_at,
    };
  }

  /**
   * Update an existing playlist (enforcing user ownership)
   */
  async updatePlaylist(
    userId: string,
    id: string,
    dto: UpdatePlaylistDto,
  ): Promise<PlaylistResponse> {
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    // Verify ownership first
    await this.getPlaylist(userId, id);

    const updatePayload: { name?: string; description?: string | null } = {};
    if (dto.name !== undefined) {
      updatePayload.name = dto.name.trim();
    }
    if (dto.description !== undefined) {
      updatePayload.description = dto.description.trim() || null;
    }

    const [updated] = await this.db
      .update(playlist)
      .set(updatePayload)
      .where(and(eq(playlist.id, id), eq(playlist.user_id, userId)))
      .returning();

    return {
      id: updated.id,
      userId: updated.user_id,
      name: updated.name,
      description: updated.description,
      playlistLimit: updated.playlist_limit,
      totalVideos: updated.total_videos,
      createdAt: updated.created_at,
    };
  }

  /**
   * Delete a playlist (enforcing user ownership)
   */
  async deletePlaylist(
    userId: string,
    id: string,
  ): Promise<{ success: boolean; id: string }> {
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    // Verify ownership
    await this.getPlaylist(userId, id);

    await this.db
      .delete(playlist)
      .where(and(eq(playlist.id, id), eq(playlist.user_id, userId)));

    return { success: true, id };
  }
}
