CREATE TABLE "time_bonuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"package_name" text NOT NULL,
	"day" date NOT NULL,
	"minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_limits" (
	"phone_id" uuid NOT NULL,
	"package_name" text NOT NULL,
	"minutes" integer NOT NULL,
	"days" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "time_limits_phone_id_package_name_pk" PRIMARY KEY("phone_id","package_name")
);
--> statement-breakpoint
ALTER TABLE "phone_apps" ADD COLUMN "requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time_bonuses" ADD CONSTRAINT "time_bonuses_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_limits" ADD CONSTRAINT "time_limits_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_bonuses_phone_day_idx" ON "time_bonuses" USING btree ("phone_id","day");