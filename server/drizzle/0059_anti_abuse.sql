CREATE TABLE "bot_challenges_spent" (
	"signature" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_mails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_hits" (
	"bucket" text NOT NULL,
	"subject" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_hits_bucket_subject_window_start_pk" PRIMARY KEY("bucket","subject","window_start")
);
--> statement-breakpoint
CREATE TABLE "server_secrets" (
	"name" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invite_mails" ADD CONSTRAINT "invite_mails_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_challenges_spent_expires_idx" ON "bot_challenges_spent" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "invite_mails_household_idx" ON "invite_mails" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "rate_limit_hits_expires_idx" ON "rate_limit_hits" USING btree ("expires_at");