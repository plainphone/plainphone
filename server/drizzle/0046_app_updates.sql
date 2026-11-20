ALTER TABLE "phones" ADD COLUMN "app_updates_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "app_updates_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "app_updates_reported_window" text;