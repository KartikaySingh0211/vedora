CREATE TABLE "playlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"playlist_limit" integer DEFAULT 10 NOT NULL,
	"total_videos" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "playlist_user_id_idx" ON "playlist" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_key_user_id_idx" ON "api_key" USING btree ("user_id");