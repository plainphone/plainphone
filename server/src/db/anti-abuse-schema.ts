// SPDX-License-Identifier: Apache-2.0
//
// Bot and spam protection on the paths that send mail or create something for an anonymous
// visitor (docs/operations.md, "Bot and spam protection"). No row holds an IP or mail address:
// subjects are keyed hashes, and every row has a short expiry that the sweeper enforces.
import { sql } from "drizzle-orm";
import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { households } from "./schema.js";

/** Random secrets the server makes on first use (like `move_identity`). Never logged or sent. */
export const serverSecrets = pgTable("server_secrets", {
  name: text("name").primaryKey(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Fixed-window counters for rate limits that must hold across restarts and processes. `subject`
 * is an HMAC of the IP address (or another key) with a key that changes every UTC day.
 */
export const rateLimitHits = pgTable("rate_limit_hits", {
  bucket: text("bucket").notNull(),
  subject: text("subject").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  hits: integer("hits").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.bucket, t.subject, t.windowStart] }),
  index("rate_limit_hits_expires_idx").on(t.expiresAt),
]);

/** Solved bot challenges, so each one is accepted once. Kept until the challenge itself expires. */
export const botChallengesSpent = pgTable("bot_challenges_spent", {
  signature: text("signature").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("bot_challenges_spent_expires_idx").on(t.expiresAt)]);

/** One row per invitation mail a household sent (INVITES_PER_HOUSEHOLD_DAILY). Kept one day. */
export const inviteMails = pgTable("invite_mails", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("invite_mails_household_idx").on(t.householdId, t.createdAt)]);
