CREATE TABLE "latency_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"provider" text,
	"kind" text NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"ms" integer,
	"delivered_ms" integer,
	"opened_ms" integer,
	"receipt" text,
	"anchor_at" timestamp with time zone,
	"phone_id" uuid
);
--> statement-breakpoint
ALTER TABLE "latency_samples" ADD CONSTRAINT "latency_samples_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "latency_samples_receipt_uq" ON "latency_samples" USING btree ("receipt");--> statement-breakpoint
CREATE INDEX "latency_samples_open_wake_idx" ON "latency_samples" USING btree ("phone_id") WHERE "latency_samples"."ms" is null;--> statement-breakpoint
CREATE INDEX "latency_samples_hour_idx" ON "latency_samples" USING btree ("path","hour");