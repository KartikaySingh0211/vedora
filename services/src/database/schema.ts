import {
  pgTable,
  uuid,
  timestamp,
  text,
  integer,
  index,
} from 'drizzle-orm/pg-core';

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
