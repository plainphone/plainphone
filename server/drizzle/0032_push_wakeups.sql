ALTER TABLE "phones" ADD COLUMN "unified_push_endpoint" text;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "push_wakeups" boolean DEFAULT false NOT NULL;