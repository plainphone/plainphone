CREATE TABLE "family_messages" (
	"phone_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"sender" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"author_id" uuid,
	"author_name" text,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered" integer,
	"received_at" timestamp with time zone,
	CONSTRAINT "family_messages_phone_id_id_pk" PRIMARY KEY("phone_id","id")
);
--> statement-breakpoint
ALTER TABLE "phones" ALTER COLUMN "quick_messages_enabled" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "family_inbox_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "check_ins_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "family_messages" ADD CONSTRAINT "family_messages_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_messages" ADD CONSTRAINT "family_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "family_messages_phone_sent_idx" ON "family_messages" USING btree ("phone_id","sent_at");--> statement-breakpoint
CREATE INDEX "family_messages_created_idx" ON "family_messages" USING btree ("created_at");