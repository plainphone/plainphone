CREATE TABLE "self_rule_templates" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"rules" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_invites" ADD COLUMN "trusted_phone_id" uuid;--> statement-breakpoint
ALTER TABLE "pending_changes" ADD COLUMN "approval_challenge_hash" text;--> statement-breakpoint
ALTER TABLE "pending_changes" ADD COLUMN "approval_fingerprint_key" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_changes" ADD COLUMN "awaiting_qr_helper" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "setup_undo_minutes" integer;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "setup_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_trusted_phone_id_phones_id_fk" FOREIGN KEY ("trusted_phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Restart the existing wait time at upgrade for requests whose legacy helper
-- is no longer eligible. An old request must not loosen rules immediately.
UPDATE "pending_changes" AS change
SET "key_type" = 'delay',
    "effective_at" = now() + make_interval(hours => key."delay_hours")
FROM "self_keys" AS key
JOIN "phones" AS phone ON phone."id" = key."phone_id"
WHERE change."phone_id" = phone."id"
  AND phone."profile" = 'self'
  AND change."status" = 'pending'
  AND change."key_type" = 'trusted'
  AND (
    key."key_type" <> 'trusted'
    OR key."trusted_user_id" IS NULL
    OR key."trusted_user_id" = change."requested_by"
    OR EXISTS (
      SELECT 1 FROM "household_members" AS member
      WHERE member."household_id" = phone."household_id"
        AND member."user_id" = key."trusted_user_id"
    )
  );
