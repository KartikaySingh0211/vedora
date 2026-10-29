import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import * as crypto from 'crypto';
import { DRIZZLE_DB } from '../../database/database.module';
import type { DrizzleDb } from '../../database/database.module';
import * as schema from '../../database/schema';
import { RedisService } from '../../infra/redis/redis.service';
import { SegmentPingDto } from './dto/segment-ping.dto';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { CACHE_KEYS } from '../../common/cache-keys';
import {
  detectBrowser,
  detectDevice,
  cleanReferrer,
} from '../../utils/user-agent.util';

const ANALYTICS_BUFFER_KEY = CACHE_KEYS.analyticsBuffer;

export interface BufferedAnalyticsEvent {
  videoId: string;
  userId: string;
  viewerSessionId: string;
  watchDurationSeconds: number;
  totalSegmentsRequested: number;
  country: string;
  browser: string;
  device: string;
  referrer: string;
  createdAt: string;
}

export interface MetricsResult {
  totalViews: number;
  totalWatchTimeSeconds: number;
  totalWatchTimeMinutes: number;
  uniqueViewers: number;
  avgDurationSeconds: number;
  deviceBreakdown: { name: string; value: number; color: string }[];
  browserBreakdown: { browser: string; share: number }[];
  viewsOverTime: { date: string; views: number }[];
  topVideos: {
    id: string;
    title: string;
    views: number;
    watchTimeMinutes: number;
    avgDurationSeconds: number;
  }[];
  countryBreakdown: { country: string; visitors: number }[];
  topReferrers: { pathname: string; requests: number }[];
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private isFlushing = false;

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Public ingestion of playback telemetry heartbeats.
   * Derives video ownership authoritatively and generates pseudonymous session IDs.
   */
  async ingestSegmentPing(
    dto: SegmentPingDto,
    userAgent: string,
    rawIp: string,
    rawReferrer?: string,
    rawCountry?: string,
  ): Promise<{ acknowledged: boolean }> {
    // 1. Authoritative video lookup
    const [video] = await this.db
      .select({ id: schema.videos.id, userId: schema.videos.user_id })
      .from(schema.videos)
      .where(eq(schema.videos.id, dto.videoId))
      .limit(1);

    if (!video) {
      throw new NotFoundException(`Video with ID ${dto.videoId} not found`);
    }

    // 2. Derive pseudonymous session identifier (zero raw IP persistence)
    const secret =
      this.configService.get<string>('apiKeyDigestSecret') ||
      'vedora_analytics_privacy_salt_key_32b';
    const pseudonymousSessionId = crypto
      .createHmac('sha256', secret)
      .update(
        `${rawIp || 'unknown'}:${userAgent || 'unknown'}:${dto.sessionId}`,
      )
      .digest('hex');

    // 3. Classify browser, device, and referrer
    const browser = detectBrowser(userAgent);
    const device = detectDevice(userAgent);
    const country =
      rawCountry && rawCountry.length <= 5
        ? rawCountry.toUpperCase()
        : 'Unknown';
    const referrer = cleanReferrer(rawReferrer);

    const event: BufferedAnalyticsEvent = {
      videoId: video.id,
      userId: video.userId,
      viewerSessionId: pseudonymousSessionId,
      watchDurationSeconds: dto.watchDurationSeconds,
      totalSegmentsRequested: dto.segmentsRequested,
      country,
      browser,
      device,
      referrer,
      createdAt: new Date().toISOString(),
    };

    // 4. Buffer into Redis or fallback direct persistence
    const serialized = JSON.stringify(event);
    const pushed = await this.redisService.rpush(
      ANALYTICS_BUFFER_KEY,
      serialized,
    );

    if (pushed === 0) {
      // Fallback: direct asynchronous write if Redis is offline
      await this.persistDirectBatch([event]).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Direct analytics persistence failed: ${msg}`);
      });
    }

    return { acknowledged: true };
  }

  /**
   * Drain and persist buffered events in batches.
   */
  async flushBuffer(): Promise<number> {
    if (this.isFlushing) return 0;
    this.isFlushing = true;

    try {
      const batchSize = 100;
      const rawEvents = await this.redisService.lrange(
        ANALYTICS_BUFFER_KEY,
        0,
        batchSize - 1,
      );

      if (!rawEvents || rawEvents.length === 0) {
        return 0;
      }

      const events: BufferedAnalyticsEvent[] = [];
      for (const raw of rawEvents) {
        try {
          events.push(JSON.parse(raw) as BufferedAnalyticsEvent);
        } catch {
          // skip malformed
        }
      }

      if (events.length > 0) {
        await this.persistDirectBatch(events);
        await this.redisService.ltrim(
          ANALYTICS_BUFFER_KEY,
          rawEvents.length,
          -1,
        );
      }

      return events.length;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error flushing analytics buffer: ${msg}`);
      return 0;
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Insert batch into PostgreSQL and update subscription used_minutes.
   */
  async persistDirectBatch(events: BufferedAnalyticsEvent[]): Promise<void> {
    if (events.length === 0) return;

    const records = events.map((e) => ({
      video_id: e.videoId,
      user_id: e.userId,
      viewer_session_id: e.viewerSessionId,
      watch_duration_seconds: e.watchDurationSeconds,
      total_segments_requested: e.totalSegmentsRequested,
      country: e.country,
      browser: e.browser,
      device: e.device,
      referrer: e.referrer,
      created_at: new Date(e.createdAt),
    }));

    await this.db.insert(schema.video_views).values(records);

    // Sum watch seconds per user to increment subscription used_minutes
    const userMinutes: Record<string, number> = {};
    for (const e of events) {
      userMinutes[e.userId] =
        (userMinutes[e.userId] || 0) + e.watchDurationSeconds / 60;
    }

    for (const [userId, mins] of Object.entries(userMinutes)) {
      const roundedMins = Math.max(1, Math.round(mins));
      try {
        await this.db
          .update(schema.subscriptions)
          .set({
            used_minutes: sql`${schema.subscriptions.used_minutes} + ${roundedMins}`,
            updated_at: new Date(),
          })
          .where(eq(schema.subscriptions.user_id, userId));
      } catch {
        // tolerate if user subscription record doesn't exist yet
      }
    }
  }

  /**
   * Compute aggregated metrics for authenticated video owner.
   */
  async getMetrics(
    userId: string,
    query: AnalyticsQueryDto,
  ): Promise<MetricsResult> {
    const windowDays =
      query.window === '7d' ? 7 : query.window === '90d' ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - windowDays);

    const conditions = [
      eq(schema.video_views.user_id, userId),
      gte(schema.video_views.created_at, startDate),
    ];

    if (query.videoId) {
      conditions.push(eq(schema.video_views.video_id, query.videoId));
    }

    // 1. Overview Totals
    const [overview] = await this.db
      .select({
        totalViews: sql<number>`count(distinct ${schema.video_views.viewer_session_id})::int`,
        totalDuration: sql<number>`coalesce(sum(${schema.video_views.watch_duration_seconds}), 0)::int`,
        uniqueViewers: sql<number>`count(distinct ${schema.video_views.viewer_session_id})::int`,
      })
      .from(schema.video_views)
      .where(and(...conditions));

    const totalViews = overview?.totalViews || 0;
    const totalWatchTimeSeconds = overview?.totalDuration || 0;
    const totalWatchTimeMinutes = Math.round(totalWatchTimeSeconds / 60);
    const uniqueViewers = overview?.uniqueViewers || 0;
    const avgDurationSeconds =
      totalViews > 0 ? Math.round(totalWatchTimeSeconds / totalViews) : 0;

    // 2. Device Breakdown
    const devices = await this.db
      .select({
        name: schema.video_views.device,
        value: sql<number>`count(*)::int`,
      })
      .from(schema.video_views)
      .where(and(...conditions))
      .groupBy(schema.video_views.device);

    const deviceColors: Record<string, string> = {
      desktop: '#3b82f6',
      mobile: '#10b981',
      tablet: '#a855f7',
    };

    const deviceBreakdown = devices.map((d) => ({
      name: d.name
        ? d.name.charAt(0).toUpperCase() + d.name.slice(1)
        : 'Desktop',
      value: d.value,
      color: deviceColors[d.name?.toLowerCase()] || '#6b7280',
    }));

    // 3. Browser Breakdown
    const browsers = await this.db
      .select({
        browser: schema.video_views.browser,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.video_views)
      .where(and(...conditions))
      .groupBy(schema.video_views.browser);

    const totalBrowserCounts =
      browsers.reduce((sum, b) => sum + b.count, 0) || 1;
    const browserBreakdown = browsers.map((b) => ({
      browser: b.browser || 'Unknown',
      share: Math.round((b.count / totalBrowserCounts) * 100),
    }));

    // 4. Views Over Time
    const timeSeries = await this.db
      .select({
        date: sql<string>`to_char(${schema.video_views.created_at}, 'Mon DD')`,
        views: sql<number>`count(distinct ${schema.video_views.viewer_session_id})::int`,
      })
      .from(schema.video_views)
      .where(and(...conditions))
      .groupBy(
        sql`to_char(${schema.video_views.created_at}, 'Mon DD')`,
        sql`date_trunc('day', ${schema.video_views.created_at})`,
      )
      .orderBy(sql`date_trunc('day', ${schema.video_views.created_at})`);

    // 5. Top Videos
    const topVideosRaw = await this.db
      .select({
        videoId: schema.video_views.video_id,
        views: sql<number>`count(distinct ${schema.video_views.viewer_session_id})::int`,
        duration: sql<number>`coalesce(sum(${schema.video_views.watch_duration_seconds}), 0)::int`,
      })
      .from(schema.video_views)
      .where(and(...conditions))
      .groupBy(schema.video_views.video_id)
      .orderBy(
        desc(sql`count(distinct ${schema.video_views.viewer_session_id})`),
      )
      .limit(5);

    // Resolve titles
    const topVideos: Array<{
      id: string;
      title: string;
      views: number;
      watchTimeMinutes: number;
      avgDurationSeconds: number;
    }> = [];
    for (const item of topVideosRaw) {
      const [v] = await this.db
        .select({ title: schema.videos.title })
        .from(schema.videos)
        .where(eq(schema.videos.id, item.videoId))
        .limit(1);

      topVideos.push({
        id: item.videoId,
        title: v?.title || 'Untitled Video',
        views: item.views,
        watchTimeMinutes: Math.round(item.duration / 60),
        avgDurationSeconds:
          item.views > 0 ? Math.round(item.duration / item.views) : 0,
      });
    }

    // 6. Country Breakdown
    const countryRaw = await this.db
      .select({
        country: schema.video_views.country,
        visitors: sql<number>`count(distinct ${schema.video_views.viewer_session_id})::int`,
      })
      .from(schema.video_views)
      .where(and(...conditions))
      .groupBy(schema.video_views.country)
      .orderBy(
        desc(sql`count(distinct ${schema.video_views.viewer_session_id})`),
      )
      .limit(20);

    const countryBreakdown = countryRaw.map((c) => ({
      country: c.country || 'Unknown',
      visitors: c.visitors || 0,
    }));

    // 7. Top Referrers
    const referrersRaw = await this.db
      .select({
        pathname: schema.video_views.referrer,
        requests: sql<number>`count(*)::int`,
      })
      .from(schema.video_views)
      .where(and(...conditions))
      .groupBy(schema.video_views.referrer)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    const topReferrers = referrersRaw.map((r) => ({
      pathname: r.pathname || 'direct',
      requests: r.requests || 0,
    }));

    return {
      totalViews,
      totalWatchTimeSeconds,
      totalWatchTimeMinutes,
      uniqueViewers,
      avgDurationSeconds,
      deviceBreakdown:
        deviceBreakdown.length > 0
          ? deviceBreakdown
          : [{ name: 'Desktop', value: 1, color: '#3b82f6' }],
      browserBreakdown:
        browserBreakdown.length > 0
          ? browserBreakdown
          : [{ browser: 'Chrome', share: 100 }],
      viewsOverTime: timeSeries,
      topVideos,
      countryBreakdown,
      topReferrers,
    };
  }
}
