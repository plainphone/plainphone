ALTER TABLE "phones" ADD COLUMN "suggest_device_contacts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "light_contact_restriction" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "phones" SET "light_contact_restriction" = false
WHERE "mode" = 'light' AND "paired_at" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "contact_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"phone_id" uuid NOT NULL,
	"name" text,
	"number" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "self_schedule_contacts" boolean;--> statement-breakpoint
ALTER TABLE "phones" ALTER COLUMN "self_schedule_contacts" SET DEFAULT false;--> statement-breakpoint
UPDATE "phones" SET "self_schedule_contacts" = false
WHERE "profile" <> 'self' OR "mode" <> 'strong' OR "paired_at" IS NULL;--> statement-breakpoint
ALTER TABLE "contact_suggestions" ADD CONSTRAINT "contact_suggestions_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_suggestions_phone_number_uq" ON "contact_suggestions" USING btree ("phone_id","number");--> statement-breakpoint
CREATE INDEX "contact_suggestions_phone_group_idx" ON "contact_suggestions" USING btree ("phone_id","group_id");