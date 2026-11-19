CREATE TABLE "move_identity" (
	"id" integer PRIMARY KEY NOT NULL,
	"private_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "move_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"source_key" text NOT NULL,
	"private_key" text,
	"expires_at" timestamp with time zone NOT NULL,
	"imported_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "phone_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"transfer_id" uuid NOT NULL,
	"server_url" text NOT NULL,
	"token" text,
	"token_hash" text,
	"policy_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	CONSTRAINT "phone_moves_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "allow_server_move" boolean;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "awaiting_server_move" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "move_imports" ADD CONSTRAINT "move_imports_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_moves" ADD CONSTRAINT "phone_moves_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "phone_moves_phone_idx" ON "phone_moves" USING btree ("phone_id");