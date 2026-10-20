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
