ALTER TABLE "phones" ADD COLUMN "unified_push_endpoint" text;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "push_wakeups" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "fcm_validation_key" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "installation_hash" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_session_idx" ON "push_subscriptions" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_installation_hash_unique" UNIQUE("installation_hash");
