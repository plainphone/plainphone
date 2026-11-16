ALTER TABLE "phones" ADD COLUMN "dns_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "device_status" jsonb;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "status_reported_at" timestamp with time zone;