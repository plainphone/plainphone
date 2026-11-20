ALTER TABLE "phones" ADD COLUMN "age_preset" text;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "review_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "review_interval_months" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "review_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "review_reminded_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "agreement_lines" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "agreement_adult_lines" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "agreement_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "agreement_on_home" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "agreement_updated_at" timestamp with time zone;