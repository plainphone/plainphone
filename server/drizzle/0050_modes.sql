CREATE TABLE "mode_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"mode_id" uuid NOT NULL,
	"days" smallint[] NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"preset" text NOT NULL,
	"name" text,
	"all_apps" boolean DEFAULT true NOT NULL,
	"allowed_packages" text[] DEFAULT '{}'::text[] NOT NULL,
	"contact_groups" text[] DEFAULT '{family,friends,others}'::text[] NOT NULL,
	"quiet" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "contact_group" text DEFAULT 'others' NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "modes_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mode_slots" ADD CONSTRAINT "mode_slots_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mode_slots" ADD CONSTRAINT "mode_slots_mode_id_modes_id_fk" FOREIGN KEY ("mode_id") REFERENCES "public"."modes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modes" ADD CONSTRAINT "modes_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mode_slots_phone_idx" ON "mode_slots" USING btree ("phone_id");--> statement-breakpoint
CREATE INDEX "modes_phone_idx" ON "modes" USING btree ("phone_id");--> statement-breakpoint
UPDATE "contacts" SET "contact_group" = 'family' WHERE "sos_parent";
