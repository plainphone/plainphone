CREATE TABLE "extended_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_group" text DEFAULT 'others' NOT NULL,
	"invited_by" uuid,
	"invite_token_hash" text,
	"invite_expires_at" timestamp with time zone,
	"child_approved_at" timestamp with time zone,
	"child_declined_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"contact_declined_at" timestamp with time zone,
	"session_token_hash" text,
	"blocked_at" timestamp with time zone,
	"rev" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extended_contacts_invite_token_hash_unique" UNIQUE("invite_token_hash"),
	CONSTRAINT "extended_contacts_session_token_hash_unique" UNIQUE("session_token_hash")
);
--> statement-breakpoint
CREATE TABLE "extended_messages" (
	"contact_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"sender" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	CONSTRAINT "extended_messages_contact_id_id_pk" PRIMARY KEY("contact_id","id")
);
--> statement-breakpoint
CREATE TABLE "location_snapshots" (
	"phone_id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"contact_id" uuid,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"accuracy_m" double precision,
	"recorded_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "extended_family_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "location_snapshots_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "extended_contacts" ADD CONSTRAINT "extended_contacts_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extended_contacts" ADD CONSTRAINT "extended_contacts_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extended_messages" ADD CONSTRAINT "extended_messages_contact_id_extended_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."extended_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_snapshots" ADD CONSTRAINT "location_snapshots_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_snapshots" ADD CONSTRAINT "location_snapshots_contact_id_extended_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."extended_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extended_contacts_phone_idx" ON "extended_contacts" USING btree ("phone_id");--> statement-breakpoint
CREATE INDEX "extended_messages_created_idx" ON "extended_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "location_snapshots_expires_idx" ON "location_snapshots" USING btree ("expires_at");