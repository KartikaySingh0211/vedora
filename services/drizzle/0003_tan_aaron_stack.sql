CREATE TABLE "player_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"primary_color" text DEFAULT '#2563eb' NOT NULL,
	"control_bar_bg" text DEFAULT 'rgba(0, 0, 0, 0.7)' NOT NULL,
	"play_icon_style" text DEFAULT 'default' NOT NULL,
	"watermark_url" text,
	"watermark_position" text DEFAULT 'top-right' NOT NULL,
	"watermark_opacity" integer DEFAULT 80 NOT NULL,
	"enable_subtitles" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"allocated_minutes" integer DEFAULT 1000 NOT NULL,
	"used_minutes" integer DEFAULT 0 NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "subscriptions_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "video_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"viewer_session_id" text NOT NULL,
	"watch_duration_seconds" integer DEFAULT 0 NOT NULL,
	"total_segments_requested" integer DEFAULT 0 NOT NULL,
	"country" text DEFAULT 'Unknown' NOT NULL,
	"browser" text DEFAULT 'Unknown' NOT NULL,
	"device" text DEFAULT 'desktop' NOT NULL,
	"referrer" text DEFAULT 'direct' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "transcoded_size" bigint;--> statement-breakpoint
ALTER TABLE "video_views" ADD CONSTRAINT "video_views_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_settings_user_id_idx" ON "player_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "video_views_video_id_idx" ON "video_views" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "video_views_user_id_idx" ON "video_views" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "video_views_created_at_idx" ON "video_views" USING btree ("created_at");