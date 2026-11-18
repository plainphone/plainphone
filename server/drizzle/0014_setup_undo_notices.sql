CREATE TABLE "setup_undo_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"phone_id" uuid NOT NULL,
	"phone_name" text NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"next_attempt_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "setup_undo_notices" ADD CONSTRAINT "setup_undo_notices_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_undo_notices" ADD CONSTRAINT "setup_undo_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_undo_notices" ADD CONSTRAINT "setup_undo_notices_subscription_id_push_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "setup_undo_notices_due_idx" ON "setup_undo_notices" USING btree ("next_attempt_at");