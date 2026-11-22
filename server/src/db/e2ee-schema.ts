// SPDX-License-Identifier: Apache-2.0
//
// E2EE phase 0 prototype (docs/e2ee-prototype.md): the MLS delivery service's storage.
// Test data only. Every route that touches these tables answers 404 unless
// E2EE_PROTOTYPE_ENABLED is true, which production refuses. The server sees ciphertext,
// recipients, epochs and timestamps; it never stores who sent an application message.
import { sql } from "drizzle-orm";
import { bigserial, boolean, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { households, phones, users } from "./schema.js";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** An MLS client: a parent's app (user) or a child phone. Byte fields are base64url text. */
export const e2eeDevices = pgTable("e2ee_devices", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  phoneId: uuid("phone_id").references(() => phones.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["admin", "child"] }).notNull(),
  mlsSignPub: text("mls_sign_pub").notNull(),
  createdAt: createdAt(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [index("e2ee_devices_household_idx").on(t.householdId)]);

export const e2eeKeyPackages = pgTable("e2ee_key_packages", {
  id: id(),
  deviceId: uuid("device_id").notNull().references(() => e2eeDevices.id, { onDelete: "cascade" }),
  keyPackage: text("key_package").notNull(),
  /** Reused when the others are gone, so a child phone can be added while offline. */
  lastResort: boolean("last_resort").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("e2ee_key_packages_device_idx").on(t.deviceId, t.createdAt)]);

/** One conversation = one MLS group. `epoch` advances by one per accepted commit. */
export const e2eeGroups = pgTable("e2ee_groups", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  mlsGroupId: text("mls_group_id").notNull(),
  epoch: integer("epoch").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("e2ee_groups_mls_group_idx").on(t.householdId, t.mlsGroupId)]);

/** Members as the last accepted commit declared them: the fan-out list. */
export const e2eeGroupMembers = pgTable("e2ee_group_members", {
  groupId: uuid("group_id").notNull().references(() => e2eeGroups.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id").notNull().references(() => e2eeDevices.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.groupId, t.deviceId] })]);

export const e2eeMessages = pgTable("e2ee_messages", {
  id: id(),
  groupId: uuid("group_id").notNull().references(() => e2eeGroups.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["welcome", "commit", "application"] }).notNull(),
  epoch: integer("epoch").notNull(),
  payload: text("payload").notNull(),
  createdAt: createdAt(),
});

/** One row per recipient and message. `cursor` is the recipient's single total order. */
export const e2eeDeliveries = pgTable("e2ee_deliveries", {
  cursor: bigserial("cursor", { mode: "number" }).primaryKey(),
  deviceId: uuid("device_id").notNull().references(() => e2eeDevices.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => e2eeMessages.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [index("e2ee_deliveries_device_idx").on(t.deviceId, t.cursor), index("e2ee_deliveries_message_idx").on(t.messageId)]);
