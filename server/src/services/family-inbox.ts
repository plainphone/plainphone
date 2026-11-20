// SPDX-License-Identifier: Apache-2.0
//
// The family inbox (docs/family-inbox.md): one short thread between a Child phone and its parents.
// The child sends the quick messages the parents approved and, when check-ins are on, "I'm home"
// without a position. Parents answer with a short reply. No read receipts, no typing, no last seen:
// only whether a message reached a parent device (child to parent) or the child's phone (parent to
// child). Code words go through the SOS flow and never land here.
import { and, desc, eq, inArray, isNull, lt, notInArray } from "drizzle-orm";
import { familyMessages, phones } from "../db/schema.js";
import type { Ctx } from "./context.js";

type Phone = typeof phones.$inferSelect;
type Row = typeof familyMessages.$inferSelect;

/** The thread keeps this many messages per phone, and none older than [KEEP_MS]. */
export const INBOX_KEEP = 50;
const KEEP_MS = 30 * 86_400_000;
/** What the phone and the dashboard show of the thread. */
export const INBOX_SHOWN = 30;
/** A parent reply is as short as a quick message; longer talk is a call or an SMS. */
export const REPLY_MAX = 60;

export interface InboxSwitches {
  familyInbox: boolean;
  quickMessages: boolean;
  checkIns: boolean;
}

/** What is on for the child: quick messages and check-ins in the inbox depend on the inbox itself. */
export function inboxSwitches(phone: Phone): InboxSwitches {
  const on = phone.profile === "child" && phone.familyInboxEnabled;
  return { familyInbox: on, quickMessages: on && phone.quickMessagesEnabled, checkIns: on && phone.checkInsEnabled };
}

export function familyMessageJson(row: Row) {
  return {
    id: row.id,
    from: row.sender,
    kind: row.kind,
    text: row.text,
    sentAt: row.sentAt,
    ...(row.sender === "parent" ? { author: row.authorName, receivedAt: row.receivedAt } : { delivered: row.delivered }),
  };
}

/** The newest messages of a phone's thread, oldest first. */
export async function listFamilyMessages(db: Ctx["db"], phoneId: string, limit = INBOX_SHOWN) {
  const rows = await db.select().from(familyMessages).where(eq(familyMessages.phoneId, phoneId))
    .orderBy(desc(familyMessages.sentAt), desc(familyMessages.createdAt)).limit(limit);
  return rows.reverse();
}

/**
 * The rules' `inbox` block for a Child phone: the switches, and the id of the newest parent reply
 * so the phone knows when to fetch the thread. Left out entirely while the inbox is off.
 */
export async function inboxRules(ctx: Ctx, phone: Phone) {
  const switches = inboxSwitches(phone);
  if (!switches.familyInbox) return undefined;
  const [latest] = await ctx.db.select({ id: familyMessages.id }).from(familyMessages)
    .where(and(eq(familyMessages.phoneId, phone.id), eq(familyMessages.sender, "parent")))
    .orderBy(desc(familyMessages.sentAt), desc(familyMessages.createdAt)).limit(1);
  return { enabled: true, quickMessages: switches.quickMessages, checkIns: switches.checkIns, latest: latest?.id ?? null };
}

/**
 * Records a message the child's phone has sent. The phone is the authority: it is stored even if
 * the inbox was switched off in the meantime. A repeated id keeps the first row. [sentAt] is the
 * phone's clock, never later than the server's, so a delayed message keeps its place in the thread.
 */
export async function recordChildMessage(
  ctx: Ctx, phone: Phone, input: { id: string; kind: "quick" | "checkin"; text: string; sentAt?: Date },
) {
  const now = ctx.now();
  const sentAt = input.sentAt && input.sentAt < now ? input.sentAt : now;
  await ctx.db.insert(familyMessages)
    .values({ phoneId: phone.id, id: input.id, sender: "child", kind: input.kind, text: input.text, sentAt, createdAt: now })
    .onConflictDoNothing();
  await trimThread(ctx, phone.id);
}

/** How many parent devices got the push for a child message, shown on both sides. */
export async function markDelivered(ctx: Ctx, phoneId: string, id: string, delivered: number) {
  await ctx.db.update(familyMessages).set({ delivered })
    .where(and(eq(familyMessages.phoneId, phoneId), eq(familyMessages.id, id), eq(familyMessages.sender, "child")));
}

export async function addParentReply(ctx: Ctx, phoneId: string, input: { userId: string; text: string; name?: string }) {
  const [row] = await ctx.db.insert(familyMessages).values({
    phoneId, id: crypto.randomUUID(), sender: "parent", kind: "reply", text: input.text,
    authorId: input.userId, authorName: input.name ?? null, sentAt: ctx.now(), createdAt: ctx.now(),
  }).returning();
  await trimThread(ctx, phoneId);
  return row!;
}

/** The child's phone has the parent replies [ids]: the device receipt. Only the first time counts. */
export async function markReceived(ctx: Ctx, phoneId: string, ids: string[]) {
  if (ids.length === 0) return;
  await ctx.db.update(familyMessages).set({ receivedAt: ctx.now() }).where(and(
    eq(familyMessages.phoneId, phoneId), inArray(familyMessages.id, ids),
    eq(familyMessages.sender, "parent"), isNull(familyMessages.receivedAt),
  ));
}

/** Keeps the newest [INBOX_KEEP] of one phone's thread. */
async function trimThread(ctx: Ctx, phoneId: string) {
  const keep = ctx.db.select({ id: familyMessages.id }).from(familyMessages)
    .where(eq(familyMessages.phoneId, phoneId))
    .orderBy(desc(familyMessages.sentAt), desc(familyMessages.createdAt)).limit(INBOX_KEEP);
  await ctx.db.delete(familyMessages).where(and(eq(familyMessages.phoneId, phoneId), notInArray(familyMessages.id, keep)));
}

/** Deletes messages older than 30 days (sweeper). */
export async function sweepFamilyMessages(ctx: Ctx) {
  await ctx.db.delete(familyMessages).where(lt(familyMessages.createdAt, new Date(ctx.now().getTime() - KEEP_MS)));
}
