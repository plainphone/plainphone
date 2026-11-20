// SPDX-License-Identifier: Apache-2.0
// Hidden SOS and quick messages (docs/sos.md). Every part has its own per-phone switch.
import { and, asc, count, eq, gt, lt } from "drizzle-orm";
import { householdMembers, phones, quickMessageSends, quickMessages } from "../db/schema.js";
import type { Ctx } from "./context.js";
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

/**
 * An ordinary quick message the phone sent online. The phone has already sent it, so it is
 * always accepted; `notified` is how many parent devices got a push. With 0 the phone sends
 * it by SMS instead. A repeated id returns the first answer without notifying again.
 */
export async function sendQuickMessage(ctx: Ctx, phone: Phone, input: { id: string; text: string }) {
  const now = ctx.now();
  const [claimed] = await ctx.db.insert(quickMessageSends).values({ phoneId: phone.id, id: input.id, createdAt: now })
    .onConflictDoNothing().returning();
  if (!claimed) {
    const [first] = await ctx.db.select().from(quickMessageSends)
      .where(and(eq(quickMessageSends.phoneId, phone.id), eq(quickMessageSends.id, input.id)));
    return { notified: first?.notified ?? 0 };
  }
  const [recent] = await ctx.db.select({ total: count() }).from(quickMessageSends).where(and(
    eq(quickMessageSends.phoneId, phone.id), gt(quickMessageSends.createdAt, new Date(now.getTime() - 600_000)),
  ));
  if (phone.releaseRequestedAt || (recent?.total ?? 0) > SEND_LIMIT) return { notified: 0 };
  const notified = await notifyUsers(ctx, await parentIds(ctx, phone.householdId), {
    type: "quickMessage", id: input.id, phoneId: phone.id, phoneName: phone.name, text: input.text,
  }).catch(() => 0);
  await ctx.db.update(quickMessageSends).set({ notified })
    .where(and(eq(quickMessageSends.phoneId, phone.id), eq(quickMessageSends.id, input.id)));
  return { notified };
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
    }).catch(() => 0);
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
}
