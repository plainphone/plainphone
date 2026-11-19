-- Graphite (stored as "grey") became the default home screen palette; sage used to be it.
-- Phones that exist now and never chose a palette keep what they see today: write sage down.
-- Phones without a settings row get one. Phones enrolled after this migration have no stored palette
-- and fall back to the new default.
INSERT INTO "phone_settings" ("phone_id")
SELECT "id" FROM "phones"
ON CONFLICT ("phone_id") DO NOTHING;--> statement-breakpoint
UPDATE "phone_settings"
SET "home" = "home" || '{"palette":"sage"}'::jsonb
WHERE "home" -> 'palette' IS NULL;
