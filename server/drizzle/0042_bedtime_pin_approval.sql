ALTER TABLE "more_time_requests" ADD COLUMN "decided_via" text;--> statement-breakpoint
ALTER TABLE "phone_requests" ADD COLUMN "decided_via" text;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "silent_bedtime" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "pin_approval_enabled" boolean DEFAULT true NOT NULL;