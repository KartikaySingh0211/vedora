import {
  pgTable,
  uuid,
  timestamp,
  text,
  integer,
  boolean,
  bigint,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

export const VideoStatusEnum = [
  'uploading',
  'uploaded',
  'processing',
  'ready',
  'failed',
] as const;
export type VideoStatus = (typeof VideoStatusEnum)[number];

export const api_key = pgTable(
  'api_key',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    user_id: text('user_id').notNull(),
    prefix: text('prefix').notNull(),
    value: text('value').notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    last_used_at: timestamp('last_used_at', { withTimezone: true }),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('api_key_user_id_idx').on(table.user_id)],
);

export const playlist = pgTable(
  'playlist',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    user_id: text('user_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    playlist_limit: integer('playlist_limit').default(10).notNull(),
    total_videos: integer('total_videos').default(0).notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('playlist_user_id_idx').on(table.user_id)],
);

export const videos = pgTable(
  'videos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    user_id: text('user_id').notNull(),
    playlist_id: uuid('playlist_id').references(() => playlist.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    tags: jsonb('tags').$type<string[]>().default([]).notNull(),
    storage_key: text('storage_key'),
    bucket_id: text('bucket_id'),
    size: bigint('size', { mode: 'bigint' }).notNull(),
    estimated_transcoded_size: bigint('estimated_transcoded_size', {
      mode: 'bigint',
    }).notNull(),
    duration: integer('duration').default(0).notNull(),
    status: text('status').$type<VideoStatus>().default('uploading').notNull(),
    resolutions: jsonb('resolutions')
      .$type<string[]>()
      .default(['720p'])
      .notNull(),
    thumbnail_url: text('thumbnail_url'),
    generate_subtitles: boolean('generate_subtitles').default(false).notNull(),
    include_watermark: boolean('include_watermark').default(false).notNull(),
    master_m3u8_key: text('master_m3u8_key'),
    transcoded_size: bigint('transcoded_size', { mode: 'bigint' }),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('videos_user_id_idx').on(table.user_id),
    index('videos_playlist_id_idx').on(table.playlist_id),
    index('videos_status_idx').on(table.status),
  ],
);

export const player_settings = pgTable(
  'player_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    user_id: text('user_id').notNull().unique(),
    primary_color: text('primary_color').default('#2563eb').notNull(),
    control_bar_bg: text('control_bar_bg')
      .default('rgba(0, 0, 0, 0.7)')
      .notNull(),
    play_icon_style: text('play_icon_style').default('default').notNull(),
    watermark_url: text('watermark_url'),
    watermark_position: text('watermark_position')
      .default('top-right')
      .notNull(),
    watermark_opacity: integer('watermark_opacity').default(80).notNull(),
    enable_subtitles: boolean('enable_subtitles').default(true).notNull(),
    enabled_controls: jsonb('enabled_controls')
      .$type<string[]>()
      .default([
        'Play / Pause',
        '10s Backward',
        '10s Forward',
        'Full Screen',
        'Captions',
        'Volume',
        'Mute',
      ])
      .notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('player_settings_user_id_idx').on(table.user_id)],
);

export const video_views = pgTable(
  'video_views',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    video_id: uuid('video_id')
      .references(() => videos.id, { onDelete: 'cascade' })
      .notNull(),
    user_id: text('user_id').notNull(),
    viewer_session_id: text('viewer_session_id').notNull(),
    watch_duration_seconds: integer('watch_duration_seconds')
      .default(0)
      .notNull(),
    total_segments_requested: integer('total_segments_requested')
      .default(0)
      .notNull(),
    country: text('country').default('Unknown').notNull(),
    browser: text('browser').default('Unknown').notNull(),
    device: text('device').default('desktop').notNull(),
    referrer: text('referrer').default('direct').notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('video_views_video_id_idx').on(table.video_id),
    index('video_views_user_id_idx').on(table.user_id),
    index('video_views_created_at_idx').on(table.created_at),
  ],
);

export type Video = typeof videos.$inferSelect;
export type InsertVideo = typeof videos.$inferInsert;
export type Playlist = typeof playlist.$inferSelect;
export type InsertPlaylist = typeof playlist.$inferInsert;
export type ApiKey = typeof api_key.$inferSelect;
export type InsertApiKey = typeof api_key.$inferInsert;
export type PlayerSettings = typeof player_settings.$inferSelect;
export type InsertPlayerSettings = typeof player_settings.$inferInsert;
export type VideoView = typeof video_views.$inferSelect;
export type InsertVideoView = typeof video_views.$inferInsert;
