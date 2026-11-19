ALTER TABLE "phones" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "provisioning" jsonb;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "invalidated_at" timestamp with time zone;
