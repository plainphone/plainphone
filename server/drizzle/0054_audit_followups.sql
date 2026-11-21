ALTER TABLE "setup_undo_notices" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "setup_undo_notices" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "summary_events_at_idx" ON "summary_events" USING btree ("at");