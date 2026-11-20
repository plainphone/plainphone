CREATE TABLE "ios_selections" (
	"phone_id" uuid PRIMARY KEY NOT NULL,
	"selection" text NOT NULL,
	"source" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pairings" ADD COLUMN "platform" text DEFAULT 'android' NOT NULL;--> statement-breakpoint
ALTER TABLE "ios_selections" ADD CONSTRAINT "ios_selections_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ios_selections" ADD CONSTRAINT "ios_selections_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;