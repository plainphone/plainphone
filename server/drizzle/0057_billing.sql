CREATE TABLE "billing_events" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_events_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subscription_ref" text NOT NULL,
	"customer_ref" text,
	"product_ref" text,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"state_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "early_unlocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid,
	"household_id" uuid,
	"pending_change_id" uuid,
	"buyer_id" uuid,
	"channel" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"provider_ref" text,
	"payment_ref" text,
	"consent_at" timestamp with time zone NOT NULL,
	"original_effective_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"unlock_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"refund_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "plan_source" text;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "plan_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_unlocks" ADD CONSTRAINT "early_unlocks_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_unlocks" ADD CONSTRAINT "early_unlocks_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_unlocks" ADD CONSTRAINT "early_unlocks_pending_change_id_pending_changes_id_fk" FOREIGN KEY ("pending_change_id") REFERENCES "public"."pending_changes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_unlocks" ADD CONSTRAINT "early_unlocks_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_ref_idx" ON "billing_subscriptions" USING btree ("provider","subscription_ref");--> statement-breakpoint
CREATE INDEX "billing_subscriptions_household_idx" ON "billing_subscriptions" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "early_unlocks_phone_idx" ON "early_unlocks" USING btree ("phone_id","created_at");--> statement-breakpoint
CREATE INDEX "early_unlocks_status_idx" ON "early_unlocks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "early_unlocks_provider_ref_idx" ON "early_unlocks" USING btree ("channel","provider_ref");