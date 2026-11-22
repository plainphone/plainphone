CREATE TABLE "e2ee_deliveries" (
	"cursor" bigserial PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "e2ee_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid,
	"phone_id" uuid,
	"role" text NOT NULL,
	"mls_sign_pub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "e2ee_group_members" (
	"group_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	CONSTRAINT "e2ee_group_members_group_id_device_id_pk" PRIMARY KEY("group_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "e2ee_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"mls_group_id" text NOT NULL,
	"epoch" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "e2ee_key_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"key_package" text NOT NULL,
	"last_resort" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "e2ee_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"epoch" integer NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "e2ee_deliveries" ADD CONSTRAINT "e2ee_deliveries_device_id_e2ee_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."e2ee_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e2ee_deliveries" ADD CONSTRAINT "e2ee_deliveries_message_id_e2ee_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."e2ee_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e2ee_devices" ADD CONSTRAINT "e2ee_devices_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e2ee_devices" ADD CONSTRAINT "e2ee_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e2ee_devices" ADD CONSTRAINT "e2ee_devices_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e2ee_group_members" ADD CONSTRAINT "e2ee_group_members_group_id_e2ee_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."e2ee_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e2ee_group_members" ADD CONSTRAINT "e2ee_group_members_device_id_e2ee_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."e2ee_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e2ee_groups" ADD CONSTRAINT "e2ee_groups_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e2ee_key_packages" ADD CONSTRAINT "e2ee_key_packages_device_id_e2ee_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."e2ee_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e2ee_messages" ADD CONSTRAINT "e2ee_messages_group_id_e2ee_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."e2ee_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "e2ee_deliveries_device_idx" ON "e2ee_deliveries" USING btree ("device_id","cursor");--> statement-breakpoint
CREATE INDEX "e2ee_deliveries_message_idx" ON "e2ee_deliveries" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "e2ee_devices_household_idx" ON "e2ee_devices" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "e2ee_groups_mls_group_idx" ON "e2ee_groups" USING btree ("household_id","mls_group_id");--> statement-breakpoint
CREATE INDEX "e2ee_key_packages_device_idx" ON "e2ee_key_packages" USING btree ("device_id","created_at");