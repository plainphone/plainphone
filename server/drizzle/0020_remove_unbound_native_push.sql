DELETE FROM "push_subscriptions"
WHERE "platform" IN ('fcm', 'apns') AND "session_id" IS NULL;
