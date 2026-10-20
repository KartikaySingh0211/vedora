CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"playlist_id" uuid,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"storage_key" text,
	"bucket_id" text,
	"size" bigint NOT NULL,
	"estimated_transcoded_size" bigint NOT NULL,
	"duration" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"resolutions" jsonb DEFAULT '["720p"]'::jsonb NOT NULL,
	"thumbnail_url" text,
	"generate_subtitles" boolean DEFAULT false NOT NULL,
	"include_watermark" boolean DEFAULT false NOT NULL,
	"master_m3u8_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_playlist_id_playlist_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlist"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "videos_user_id_idx" ON "videos" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "videos_playlist_id_idx" ON "videos" USING btree ("playlist_id");--> statement-breakpoint
CREATE INDEX "videos_status_idx" ON "videos" USING btree ("status");