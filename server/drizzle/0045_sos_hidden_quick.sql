CREATE TABLE "quick_message_sends" (
	"phone_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"notified" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quick_message_sends_phone_id_id_pk" PRIMARY KEY("phone_id","id")
);
--> statement-breakpoint
CREATE TABLE "quick_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"text" text NOT NULL,
	"means_sos" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "hidden_sos_power" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "hidden_sos_presses" smallint DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "hidden_sos_clock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "hidden_sos_feedback" text DEFAULT 'vibrate' NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "quick_messages_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "quick_suggestions_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sos_events" ADD COLUMN "trigger" text;--> statement-breakpoint
ALTER TABLE "sos_events" ADD COLUMN "message" text;--> statement-breakpoint
ALTER TABLE "quick_message_sends" ADD CONSTRAINT "quick_message_sends_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_messages" ADD CONSTRAINT "quick_messages_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quick_message_sends_created_idx" ON "quick_message_sends" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "quick_messages_phone_idx" ON "quick_messages" USING btree ("phone_id","created_at");