import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { DrizzleDb } from '../../database/database.module';
import * as schema from '../../database/schema';
import { StorageService } from '../../infra/storage/storage.service';
import { UpdatePlayerSettingsDto } from './dto/update-player-settings.dto';

export interface PublicPlayerConfig {
  videoId: string;
  title: string;
  duration: number;
  status: string;
  streamUrl: string | null;
  primaryColor: string;
  controlBarBg: string;
  playIconStyle: string;
  watermarkUrl: string | null;
  watermarkText: string | null;
  watermarkPosition: string;
  watermarkOpacity: number;
  enableSubtitles: boolean;
  enabledControls: string[];
  isFreeTier: boolean;
}

@Injectable()
export class PlayerSettingsService {
  private readonly logger = new Logger(PlayerSettingsService.name);

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get player settings for authenticated user, creating defaults if not yet present
   */
  async getSettings(userId: string): Promise<schema.PlayerSettings> {
    const [existing] = await this.db
      .select()
      .from(schema.player_settings)
      .where(eq(schema.player_settings.user_id, userId))
      .limit(1);

    if (existing) {
      return existing;
    }

    // Insert default settings
    const [created] = await this.db
      .insert(schema.player_settings)
      .values({
        user_id: userId,
        primary_color: '#2563eb',
        control_bar_bg: 'rgba(0, 0, 0, 0.7)',
        play_icon_style: 'default',
        watermark_position: 'top-right',
        watermark_opacity: 80,
        enable_subtitles: true,
        enabled_controls: [
          'Play / Pause',
          '10s Backward',
          '10s Forward',
          'Full Screen',
          'Captions',
          'Volume',
          'Mute',
        ],
      })
      .returning();

    return created;
  }

  /**
   * Update player settings for authenticated user
   */
  async updateSettings(
    userId: string,
    dto: UpdatePlayerSettingsDto,
  ): Promise<schema.PlayerSettings> {
    // Ensure settings exist first
    await this.getSettings(userId);

    const updateData: Partial<schema.InsertPlayerSettings> = {
      updated_at: new Date(),
    };

    if (dto.primaryColor !== undefined)
      updateData.primary_color = dto.primaryColor;
    if (dto.controlBarBg !== undefined)
      updateData.control_bar_bg = dto.controlBarBg;
    if (dto.playIconStyle !== undefined)
      updateData.play_icon_style = dto.playIconStyle;
    if (dto.watermarkUrl !== undefined)
      updateData.watermark_url = dto.watermarkUrl;
    if (dto.watermarkPosition !== undefined)
      updateData.watermark_position = dto.watermarkPosition;
    if (dto.watermarkOpacity !== undefined)
      updateData.watermark_opacity = dto.watermarkOpacity;
    if (dto.enableSubtitles !== undefined)
      updateData.enable_subtitles = dto.enableSubtitles;
    if (dto.enabledControls !== undefined)
      updateData.enabled_controls = dto.enabledControls;

    const [updated] = await this.db
      .update(schema.player_settings)
      .set(updateData)
      .where(eq(schema.player_settings.user_id, userId))
      .returning();

    return updated;
  }

  /**
   * Public configuration endpoint for embed player
   * Enforces server-side plan rules for branding & watermarks
   */
  async getPublicPlayerConfig(videoId: string): Promise<PublicPlayerConfig> {
    const [video] = await this.db
      .select()
      .from(schema.videos)
      .where(eq(schema.videos.id, videoId))
      .limit(1);

    if (!video) {
      throw new NotFoundException(`Video with ID ${videoId} not found`);
    }

    const settings = await this.getSettings(video.user_id);

    // Fetch subscription plan to determine branding enforcement
    const [subscription] = await this.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.user_id, video.user_id))
      .limit(1);

    const plan = subscription ? subscription.plan.toLowerCase() : 'free';
    const isFreeTier = plan === 'free';

    // Free plan: force "Powered by Vedora" watermark
    // Paid plans (Starter, Pro, Business): allow custom watermark
    let watermarkUrl: string | null = null;
    let watermarkText: string | null = null;

    if (isFreeTier) {
      watermarkText = 'Powered by Vedora';
    } else {
      watermarkUrl = settings.watermark_url;
    }

    // Resolve stream URL for playback:
    // When master_m3u8_key is set (transcoding complete), serve the HLS manifest.
    // If not yet transcoded, fallback to the raw storage_key (e.g. for previews).
    let streamUrl: string | null = null;
    if (video.master_m3u8_key) {
      streamUrl = this.storageService.getPublicUrl(video.master_m3u8_key);
    } else if (video.storage_key) {
      streamUrl = this.storageService.getPublicUrl(video.storage_key);
    }

    return {
      videoId: video.id,
      title: video.title,
      duration: video.duration,
      status: video.status,
      streamUrl,
      primaryColor: settings.primary_color,
      controlBarBg: settings.control_bar_bg,
      playIconStyle: settings.play_icon_style,
      watermarkUrl,
      watermarkText,
      watermarkPosition: settings.watermark_position,
      watermarkOpacity: settings.watermark_opacity,
      enableSubtitles: settings.enable_subtitles,
      enabledControls: settings.enabled_controls || [
        'Play / Pause',
        '10s Backward',
        '10s Forward',
        'Full Screen',
        'Captions',
        'Volume',
        'Mute',
      ],
      isFreeTier,
    };
  }
}
