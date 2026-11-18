ALTER TABLE "phones" ADD COLUMN "setup_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "setup_undo_authorized_at" timestamp with time zone;