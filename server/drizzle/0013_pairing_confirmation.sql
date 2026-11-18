ALTER TABLE "pairings" ADD COLUMN "profile_hint" text;--> statement-breakpoint
ALTER TABLE "pairings" ADD COLUMN "requires_confirmation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pairings" ADD COLUMN "claimed_by" uuid;--> statement-breakpoint
ALTER TABLE "pairings" ADD CONSTRAINT "pairings_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;