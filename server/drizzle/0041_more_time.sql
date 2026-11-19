CREATE TABLE "more_time_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"package_name" text NOT NULL,
	"reason" text,
	"day" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"answer" text,
	"granted_minutes" integer,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "ask_more_time_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "limit_warning_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "more_time_requests" ADD CONSTRAINT "more_time_requests_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "more_time_requests" ADD CONSTRAINT "more_time_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "more_time_requests_phone_idx" ON "more_time_requests" USING btree ("phone_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "more_time_requests_one_open_idx" ON "more_time_requests" USING btree ("phone_id","package_name") WHERE "more_time_requests"."status" = 'pending';