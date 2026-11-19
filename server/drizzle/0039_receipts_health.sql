ALTER TABLE "phones" ADD COLUMN "change_receipts_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "health_board_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "rules_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "rules_await_dns" boolean DEFAULT false NOT NULL;