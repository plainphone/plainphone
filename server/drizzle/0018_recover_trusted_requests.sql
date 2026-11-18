ALTER TABLE "pending_changes" ADD COLUMN "awaiting_qr_helper" boolean DEFAULT false NOT NULL;
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
