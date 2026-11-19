CREATE TABLE "sos_deliveries" (
	"phone_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"pushed_at" timestamp with time zone,
	"mailed_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	CONSTRAINT "sos_deliveries_phone_id_event_id_user_id_pk" PRIMARY KEY("phone_id","event_id","user_id")
);
--> statement-breakpoint
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
	"notification_lease_until" timestamp with time zone,
	"delivery_failed_at" timestamp with time zone,
	CONSTRAINT "sos_events_phone_id_id_pk" PRIMARY KEY("phone_id","id")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "sos_parent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "sos_callback_number" text;--> statement-breakpoint
ALTER TABLE "sos_deliveries" ADD CONSTRAINT "sos_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_deliveries" ADD CONSTRAINT "sos_deliveries_phone_id_event_id_sos_events_phone_id_id_fk" FOREIGN KEY ("phone_id","event_id") REFERENCES "public"."sos_events"("phone_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_seen_by_users_id_fk" FOREIGN KEY ("seen_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sos_phone_created_idx" ON "sos_events" USING btree ("phone_id","created_at");--> statement-breakpoint
CREATE INDEX "sos_created_idx" ON "sos_events" USING btree ("created_at");