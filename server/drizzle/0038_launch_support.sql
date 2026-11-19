ALTER TABLE "phones" ADD COLUMN "release_sync_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "support_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "release_warnings_enabled" boolean DEFAULT true NOT NULL;