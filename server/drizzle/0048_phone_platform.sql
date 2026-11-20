ALTER TABLE "phones" ADD COLUMN "platform" text DEFAULT 'android' NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "ios_tier" text;