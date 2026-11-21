CREATE TABLE "callback_requests" (
	"phone_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"pushed_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"done_via" text,
	CONSTRAINT "callback_requests_phone_id_id_pk" PRIMARY KEY("phone_id","id")
);
--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "sos_callback_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "callback_requests_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "callback_requests" ADD CONSTRAINT "callback_requests_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callback_requests" ADD CONSTRAINT "callback_requests_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "callback_requests_expires_idx" ON "callback_requests" USING btree ("expires_at");