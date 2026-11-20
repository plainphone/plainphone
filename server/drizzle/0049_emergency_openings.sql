CREATE TABLE "emergency_openings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone_id" uuid NOT NULL,
	"package_name" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"minutes" integer NOT NULL,
	"month" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "self_keys" ADD COLUMN "emergency_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "self_keys" ADD COLUMN "emergency_allowance" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "emergency_openings" ADD CONSTRAINT "emergency_openings_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "emergency_openings_phone_month_idx" ON "emergency_openings" USING btree ("phone_id","month");