ALTER TABLE "phones" ADD COLUMN "open_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "blocked_app_categories" text[] DEFAULT '{}'::text[] NOT NULL;