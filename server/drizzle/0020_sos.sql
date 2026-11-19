CREATE TABLE "sos_events" (
	"phone_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"battery" smallint,
	"delivered_via" text,
	"seen_by" uuid,
	"seen_by_name" text,
	"seen_at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"notification_claimed_at" timestamp with time zone,
	CONSTRAINT "sos_events_phone_id_id_pk" PRIMARY KEY("phone_id","id")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "sos_parent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "sos_callback_number" text;--> statement-breakpoint
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_seen_by_users_id_fk" FOREIGN KEY ("seen_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sos_phone_created_idx" ON "sos_events" USING btree ("phone_id","created_at");--> statement-breakpoint
CREATE INDEX "sos_created_idx" ON "sos_events" USING btree ("created_at");