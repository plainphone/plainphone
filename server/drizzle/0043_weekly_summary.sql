CREATE TABLE "household_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"week_end" date NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_usage_days" (
	"phone_id" uuid NOT NULL,
	"day" date NOT NULL,
	"package_name" text NOT NULL,
	"minutes" integer NOT NULL,
	CONSTRAINT "phone_usage_days_phone_id_day_package_name_pk" PRIMARY KEY("phone_id","day","package_name")
);
--> statement-breakpoint
CREATE TABLE "summary_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"detail" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "summary_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "summary_by_mail" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "summary_by_push" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "act_now_only" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "summary_day" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "summary_hour" smallint DEFAULT 18 NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "summary_minute" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "time_zone" text DEFAULT 'Europe/Copenhagen' NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "summary_since" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "weekly_summary_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "household_summaries" ADD CONSTRAINT "household_summaries_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_usage_days" ADD CONSTRAINT "phone_usage_days_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_events" ADD CONSTRAINT "summary_events_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "household_summaries_week_idx" ON "household_summaries" USING btree ("household_id","week_end");--> statement-breakpoint
CREATE INDEX "summary_events_phone_at_idx" ON "summary_events" USING btree ("phone_id","at");