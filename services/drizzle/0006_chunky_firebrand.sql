ALTER TABLE "videos" ADD COLUMN "active_job_id" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "enqueue_state" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "enqueued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "heartbeat_lease" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "last_error" text;--> statement-breakpoint
UPDATE "videos" SET "enqueue_state" = 'pending', "attempt" = 1 WHERE "status" IN ('ready', 'failed');--> statement-breakpoint
UPDATE "videos" SET "enqueue_state" = 'processing', "attempt" = 1 WHERE "status" = 'processing';--> statement-breakpoint
UPDATE "videos" SET "enqueue_state" = 'pending', "attempt" = 0 WHERE "status" IN ('uploaded', 'uploading');--> statement-breakpoint
CREATE INDEX "videos_enqueue_state_idx" ON "videos" USING btree ("enqueue_state");