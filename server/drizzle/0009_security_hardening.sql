CREATE TABLE "frp_accounts" (
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"google_account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "frp_accounts_household_id_user_id_pk" PRIMARY KEY("household_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "attestation" jsonb;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "attested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "frp_accounts" ADD CONSTRAINT "frp_accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frp_accounts" ADD CONSTRAINT "frp_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;