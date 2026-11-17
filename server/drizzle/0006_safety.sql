CREATE TABLE "safety_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_by" uuid,
	"ends_at" timestamp with time zone NOT NULL,
	"stop_on_answer" boolean DEFAULT true NOT NULL,
	"call_number" text,
	"shown_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"answer" text,
	"stopped_at" timestamp with time zone,
	"located_at" timestamp with time zone,
	"no_reply_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "location_mode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "safety_requests" ADD CONSTRAINT "safety_requests_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_requests" ADD CONSTRAINT "safety_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "safety_requests_phone_kind_idx" ON "safety_requests" USING btree ("phone_id","kind");--> statement-breakpoint
-- Phones with location off stay off. Phones with it on move from "every 5 minutes" to the new
-- default (Find and an unanswered "Are you okay?"): sharing all the time is now an explicit choice.
UPDATE "phones" SET "location_mode" = 'checkin' WHERE "location_enabled" = true;
