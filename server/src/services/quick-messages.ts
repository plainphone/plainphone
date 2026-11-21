// SPDX-License-Identifier: Apache-2.0
// Hidden SOS and quick messages (docs/sos.md). Every part has its own per-phone switch.
import { and, asc, count, eq, gt, lt } from "drizzle-orm";
import { householdMembers, notificationMutes, phones, quickMessageSends, quickMessages } from "../db/schema.js";
import type { Ctx } from "./context.js";
import { callbackEnabled } from "./callback-requests.js";
import { markDelivered, recordChildMessage, sweepFamilyMessages } from "./family-inbox.js";
import { publishLive } from "./live-events.js";
import { notifyUsers } from "./notifications.js";

type Phone = typeof phones.$inferSelect;

/** Most quick messages a phone has; the dashboard suggests three. */
export const QUICK_MESSAGES_MAX = 6;
/** Most suggestions from the child waiting for a parent at once. */
export const QUICK_SUGGESTIONS_MAX = 3;
export const QUICK_TEXT_MAX = 60;
/** Online quick messages per phone in ten minutes that notify; more are recorded but quiet. */
const SEND_LIMIT = 10;
const DAY = 86_400_000;

export const HIDDEN_PRESSES = [3, 4, 5, 6] as const;

export function sosSettingsJson(phone: Phone) {
  return {
    hiddenPower: phone.hiddenSosPower,
    hiddenPresses: phone.hiddenSosPresses,
    hiddenClock: phone.hiddenSosClock,
    hiddenFeedback: phone.hiddenSosFeedback,
    quickMessagesEnabled: phone.quickMessagesEnabled,
    quickSuggestionsEnabled: phone.quickSuggestionsEnabled,
    familyInbox: phone.familyInboxEnabled,
    checkIns: phone.checkInsEnabled,
    callbackRequests: callbackEnabled(phone),
    callbackConfirmed: phone.sosCallbackNumber !== null && phone.sosCallbackSetAt !== null,
  };
}

export function quickMessageJson(row: typeof quickMessages.$inferSelect) {
  return { id: row.id, text: row.text, meansSos: row.meansSos, createdAt: row.createdAt };
}

export async function listQuickMessages(db: Ctx["db"], phoneId: string) {
  const rows = await db.select().from(quickMessages).where(eq(quickMessages.phoneId, phoneId))
    .orderBy(asc(quickMessages.createdAt), asc(quickMessages.id));
  return {
    messages: rows.filter((r) => r.status === "active").map(quickMessageJson),
    suggestions: rows.filter((r) => r.status === "suggested").map(({ id, text, createdAt }) => ({ id, text, createdAt })),
  };
}

/** The extra fields of the rules' `sos` block. Child phones only; switched-off parts are left out. */
export async function sosRulesExtras(ctx: Ctx, phone: Phone) {
  if (phone.profile !== "child") return {};
  const { messages } = phone.quickMessagesEnabled ? await listQuickMessages(ctx.db, phone.id) : { messages: [] };
  return {
    // Only the switch: the number stays with the parents, the phone never supplies or shows one.
    callback: { enabled: callbackEnabled(phone) },
    hidden: {
      power: phone.hiddenSosPower,
      presses: phone.hiddenSosPresses,
      clock: phone.hiddenSosClock,
      feedback: phone.hiddenSosFeedback,
    },
    quickMessages: {
      enabled: phone.quickMessagesEnabled,
      suggest: phone.quickMessagesEnabled && phone.quickSuggestionsEnabled,
      items: messages.map(({ id, text, meansSos }) => ({ id, text, meansSos })),
    },
  };
}

export class QuickMessageError extends Error {
  constructor(readonly status: 403 | 404 | 409, message: string) {
    super(message);
  }
}

async function parentIds(ctx: Ctx, householdId: string) {
  const rows = await ctx.db.select({ id: householdMembers.userId }).from(householdMembers)
    .where(eq(householdMembers.householdId, householdId));
  return rows.map((r) => r.id);
}

/** The parents of a phone who have not muted it (`loud`) and how many have (`muted`). */
async function parentsByMute(ctx: Ctx, phone: Phone) {
  const [all, mutes] = await Promise.all([
    parentIds(ctx, phone.householdId),
    ctx.db.select({ id: notificationMutes.userId }).from(notificationMutes).where(eq(notificationMutes.phoneId, phone.id)),
  ]);
  const quiet = new Set(mutes.map((m) => m.id));
  const loud = all.filter((id) => !quiet.has(id));
  return { loud, muted: all.length - loud.length };
}

/** `quick_message_sends.notified` while the first call is still notifying. */
const NOTIFY_PENDING = -2;
/** `quick_message_sends.notified` for a send over the limit: recorded but quiet. */
const NOTIFY_LIMITED = -1;
/** A send still pending after this long is taken to have failed (the server stopped mid-way). */
const PENDING_MS = 60_000;

type SendAnswer = { notified: number; limited?: true; pending?: true };

function sendAnswer(notified: number): SendAnswer {
  if (notified === NOTIFY_LIMITED) return { notified: 0, limited: true };
  if (notified === NOTIFY_PENDING) return { notified: 0, pending: true };
  return { notified };
}

/**
 * An ordinary quick message the phone sent online. The phone has already sent it, so it is
 * always accepted; `notified` is how many parent devices got a push. With 0 the phone sends
 * it by SMS instead, unless `limited` (over the limit: recorded but quiet, no SMS either) or
 * `pending` (a repeat while the first call is still notifying: ask again). A repeated id
 * returns the first answer without notifying again.
 */
export async function sendQuickMessage(
  ctx: Ctx, phone: Phone,
  input: { id: string; text: string; kind?: "quick" | "checkin"; inbox?: boolean; sentAt?: Date; smsSent?: boolean },
): Promise<SendAnswer> {
  const now = ctx.now();
  // Sent from the family inbox (a check-in always is): it joins the thread, even if the inbox was
  // switched off after the phone sent it (docs/family-inbox.md).
  const kind = input.kind ?? "quick";
  let inThread = input.inbox === true || kind === "checkin";
  if (inThread) await recordChildMessage(ctx, phone, { id: input.id, kind, text: input.text, sentAt: input.sentAt });
  const row = and(eq(quickMessageSends.phoneId, phone.id), eq(quickMessageSends.id, input.id));
  const [claimed] = await ctx.db.insert(quickMessageSends)
    .values({ phoneId: phone.id, id: input.id, createdAt: now, notified: input.smsSent ? 0 : NOTIFY_PENDING })
    .onConflictDoNothing().returning();
  if (!claimed) {
    const [first] = await ctx.db.select().from(quickMessageSends).where(row);
    if (!first) return { notified: 0 };
    if (first.notified === NOTIFY_PENDING && now.getTime() - first.createdAt.getTime() > PENDING_MS) return { notified: 0 };
    return sendAnswer(first.notified);
  }
  // Open dashboards show the message at once, before the push goes out, and again with its delivery count.
  const live = () => publishLive(ctx, { type: "inbox.message", householdId: phone.householdId, phoneId: phone.id, id: input.id });
  live();
  // The phone was offline and sent an SMS: the parents have it, so the late report only fills in the thread.
  if (input.smsSent) {
    if (inThread) await markDelivered(ctx, phone.id, input.id, 0);
    if (inThread) live();
    return { notified: 0 };
  }
  const [recent] = await ctx.db.select({ total: count() }).from(quickMessageSends).where(and(
    eq(quickMessageSends.phoneId, phone.id), gt(quickMessageSends.createdAt, new Date(now.getTime() - 600_000)),
  ));
  let notified: number;
  if ((recent?.total ?? 0) > SEND_LIMIT) notified = NOTIFY_LIMITED;
  else if (phone.releaseRequestedAt) notified = 0;
  else {
    // Never urgent, also in the child's quiet hours: only a code word (through SOS) is. A parent who
    // muted the phone gets no push, but the message still lands in the thread.
    const { loud, muted } = await parentsByMute(ctx, phone);
    if (muted > 0 && !inThread) {
      await recordChildMessage(ctx, phone, { id: input.id, kind, text: input.text, sentAt: input.sentAt });
      inThread = true;
    }
    const pushed = await notifyUsers(ctx, loud, kind === "checkin"
      ? { type: "checkIn", id: input.id, phoneId: phone.id, phoneName: phone.name }
      : { type: "quickMessage", id: input.id, phoneId: phone.id, phoneName: phone.name, text: input.text },
    ).catch(() => 0);
    // With every parent muted the thread has it: the phone must not send an SMS on top.
    notified = loud.length === 0 ? muted : pushed;
  }
  await ctx.db.update(quickMessageSends).set({ notified }).where(row);
  if (inThread && notified !== NOTIFY_LIMITED) {
    await markDelivered(ctx, phone.id, input.id, notified);
    live();
  }
  return sendAnswer(notified);
}

/** The child suggests a new quick message; a parent approves or declines it. */
export async function suggestQuickMessage(ctx: Ctx, phone: Phone, text: string) {
  if (phone.profile !== "child" || phone.releaseRequestedAt || !phone.quickMessagesEnabled || !phone.quickSuggestionsEnabled) {
    throw new QuickMessageError(403, "suggesting quick messages is switched off for this phone");
  }
  const row = await ctx.db.transaction(async (tx) => {
    await tx.select({ id: phones.id }).from(phones).where(eq(phones.id, phone.id)).for("update");
    const rows = await tx.select().from(quickMessages).where(eq(quickMessages.phoneId, phone.id));
    const same = rows.find((r) => r.text.toLocaleLowerCase() === text.toLocaleLowerCase());
    if (same) return { row: same, fresh: false };
    if (rows.filter((r) => r.status === "suggested").length >= QUICK_SUGGESTIONS_MAX) {
      throw new QuickMessageError(409, "too many suggestions are waiting");
    }
    const [inserted] = await tx.insert(quickMessages).values({ phoneId: phone.id, text, status: "suggested" }).returning();
    return { row: inserted!, fresh: true };
  });
  if (row.fresh) {
    await notifyUsers(ctx, await parentIds(ctx, phone.householdId), {
      type: "quickSuggestion", phoneId: phone.id, phoneName: phone.name, text,
    }, { respectMuteFor: phone.id }).catch(() => 0);
  }
  return { id: row.row.id, status: row.row.status };
}

/** Adds an active quick message, or approves a suggestion. Keeps the limit of six. */
export async function addQuickMessage(ctx: Ctx, phoneId: string, input: { text: string; meansSos: boolean }) {
  return ctx.db.transaction(async (tx) => {
    await tx.select({ id: phones.id }).from(phones).where(eq(phones.id, phoneId)).for("update");
    const [active] = await tx.select({ total: count() }).from(quickMessages)
      .where(and(eq(quickMessages.phoneId, phoneId), eq(quickMessages.status, "active")));
    if ((active?.total ?? 0) >= QUICK_MESSAGES_MAX) throw new QuickMessageError(409, "a phone has at most six quick messages");
    const [row] = await tx.insert(quickMessages).values({ phoneId, text: input.text, meansSos: input.meansSos }).returning();
    return row!;
  });
}

export async function approveSuggestion(ctx: Ctx, phoneId: string, id: string, meansSos: boolean) {
  return ctx.db.transaction(async (tx) => {
    await tx.select({ id: phones.id }).from(phones).where(eq(phones.id, phoneId)).for("update");
    const key = and(eq(quickMessages.phoneId, phoneId), eq(quickMessages.id, id));
    const [row] = await tx.select().from(quickMessages).where(key);
    if (!row) throw new QuickMessageError(404, "quick message not found");
    if (row.status === "active") return row;
    const [active] = await tx.select({ total: count() }).from(quickMessages)
      .where(and(eq(quickMessages.phoneId, phoneId), eq(quickMessages.status, "active")));
    if ((active?.total ?? 0) >= QUICK_MESSAGES_MAX) throw new QuickMessageError(409, "a phone has at most six quick messages");
    const [updated] = await tx.update(quickMessages).set({ status: "active", meansSos, createdAt: ctx.now() }).where(key).returning();
    return updated!;
  });
}

export async function sweepQuickMessages(ctx: Ctx) {
  await ctx.db.delete(quickMessageSends).where(lt(quickMessageSends.createdAt, new Date(ctx.now().getTime() - DAY)));
  await sweepFamilyMessages(ctx);
}
