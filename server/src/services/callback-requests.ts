// SPDX-License-Identifier: Apache-2.0
// "Ask a parent to call" (docs/sos.md#asking-a-parent-to-call). The request carries no number:
// the parents dial the number they saved for the phone, and only after an explicit tap.
import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { callbackRequests, householdMembers, phones } from "../db/schema.js";
import type { Ctx } from "./context.js";
import { notifyUsers } from "./notifications.js";
import { recordUpload } from "./latency.js";

type Phone = typeof phones.$inferSelect;
type Row = typeof callbackRequests.$inferSelect;

const HOUR = 3_600_000;
/** A request is open this long; after that it only shows as expired. */
export const CALLBACK_TTL_MS = 24 * HOUR;
/** Finished and expired requests are deleted this long after they were made. */
const KEEP_MS = 48 * HOUR;
const SHOWN = 10;

export type CallbackState = "queued" | "sent" | "expired" | "done";
/** What the saved number looks like now, compared with when the request was made. */
export type NumberCheck = "ok" | "missing" | "changed";

export class CallbackError extends Error {
  constructor(readonly status: 403 | 404 | 409, message: string) {
    super(message);
  }
}

/** Whether the phone's switch is really on: it needs a number a parent has confirmed. */
export function callbackEnabled(phone: Phone): boolean {
  return phone.profile === "child" && phone.callbackRequestsEnabled
    && phone.sosCallbackNumber !== null && phone.sosCallbackSetAt !== null;
}

export function callbackState(row: Row, now: Date): CallbackState {
  if (row.doneAt) return "done";
  if (row.expiresAt <= now) return "expired";
  return row.pushedAt ? "sent" : "queued";
}

export function numberCheck(phone: Phone, row: Row): NumberCheck {
  if (phone.sosCallbackNumber === null || phone.sosCallbackSetAt === null) return "missing";
  return phone.sosCallbackSetAt > row.receivedAt ? "changed" : "ok";
}

/** What the child's phone may know: how far the request got. */
export function callbackDeviceJson(row: Row, now: Date) {
  return { id: row.id, state: callbackState(row, now), expiresAt: row.expiresAt };
}

export function callbackParentJson(row: Row, phone: Phone, now: Date) {
  return {
    id: row.id, state: callbackState(row, now), createdAt: row.createdAt, expiresAt: row.expiresAt,
    doneAt: row.doneAt, doneVia: row.doneVia, number: numberCheck(phone, row),
  };
}

export async function listCallbackRequests(ctx: Ctx, phone: Phone) {
  const now = ctx.now();
  const rows = await ctx.db.select().from(callbackRequests).where(eq(callbackRequests.phoneId, phone.id))
    .orderBy(desc(callbackRequests.createdAt)).limit(SHOWN);
  return { callbackNumber: phone.sosCallbackNumber, requests: rows.map((r) => callbackParentJson(r, phone, now)) };
}

async function parentIds(ctx: Ctx, householdId: string) {
  const rows = await ctx.db.select({ id: householdMembers.userId }).from(householdMembers)
    .where(eq(householdMembers.householdId, householdId));
  return rows.map((r) => r.id);
}

/** Pushes one open request to the parents; true once a parent device got it. Never fails the caller. */
async function pushToParents(ctx: Ctx, phone: Phone, row: Row): Promise<boolean> {
  const sent = await notifyUsers(ctx, await parentIds(ctx, phone.householdId), {
    type: "callbackRequest", id: row.id, phoneId: phone.id, phoneName: phone.name,
  }, { respectMuteFor: phone.id, keepOnTransientFailure: true }).catch(() => 0);
  if (sent === 0) return false;
  await ctx.db.update(callbackRequests).set({ pushedAt: ctx.now() })
    .where(and(eq(callbackRequests.phoneId, phone.id), eq(callbackRequests.id, row.id), isNull(callbackRequests.pushedAt)));
  return true;
}

/**
 * The phone asks for a callback. A repeated id answers with the first row and sends nothing new,
 * and while a request is still open another tap joins it instead of making a second alert.
 * The phone is the authority for what it has already done: a report that carries `sentAt` is
 * recorded even if the switch was turned off since, and one that is older than 24 hours is stored
 * as expired without any alert.
 */
export async function requestCallback(ctx: Ctx, phoneId: string, input: { id: string; sentAt?: Date; elapsedMs?: number }) {
  const now = ctx.now();
  const { phone, row, fresh } = await ctx.db.transaction(async (tx) => {
    const [phone] = await tx.select().from(phones).where(eq(phones.id, phoneId)).for("update");
    if (!phone || phone.profile !== "child" || phone.releaseRequestedAt) throw new CallbackError(404, "not found");
    const [same] = await tx.select().from(callbackRequests)
      .where(and(eq(callbackRequests.phoneId, phoneId), eq(callbackRequests.id, input.id)));
    if (same) return { phone, row: same, fresh: false };
    if (!input.sentAt && !callbackEnabled(phone)) throw new CallbackError(403, "asking for a callback is switched off for this phone");
    const [open] = await tx.select().from(callbackRequests).where(and(
      eq(callbackRequests.phoneId, phoneId), isNull(callbackRequests.doneAt), gt(callbackRequests.expiresAt, now),
    )).orderBy(desc(callbackRequests.createdAt)).limit(1);
    const createdAt = input.sentAt && input.sentAt < now ? input.sentAt : now;
    if (open && createdAt.getTime() + CALLBACK_TTL_MS > now.getTime()) return { phone, row: open, fresh: false };
    const [inserted] = await tx.insert(callbackRequests).values({
      phoneId, id: input.id, createdAt, receivedAt: now, expiresAt: new Date(createdAt.getTime() + CALLBACK_TTL_MS),
    }).returning();
    return { phone, row: inserted!, fresh: true };
  });
  // Stale (already expired when it arrived): recorded, no alert.
  if (fresh && row.expiresAt > now) {
    // Only the first arrival counts (docs/latency.md).
    recordUpload(ctx, "callback", input.elapsedMs, input.sentAt);
    const pushed = await pushToParents(ctx, phone, row);
    return callbackDeviceJson({ ...row, pushedAt: pushed ? ctx.now() : null }, ctx.now());
  }
  return callbackDeviceJson(row, now);
}

export async function getDeviceCallback(ctx: Ctx, phoneId: string, id: string) {
  const [row] = await ctx.db.select().from(callbackRequests)
    .where(and(eq(callbackRequests.phoneId, phoneId), eq(callbackRequests.id, id)));
  if (!row) throw new CallbackError(404, "not found");
  return callbackDeviceJson(row, ctx.now());
}

/**
 * A parent device reports what happened. `number` is the number the screen showed: it is only
 * accepted while it is still the saved one, so a stale number is never dialled. `other` means
 * the parent called some other way (their own contacts) and may carry the time it happened, so
 * a report that was queued on a device is recorded even after the request expired.
 */
export async function markCallbackDone(
  ctx: Ctx, phone: Phone, userId: string, id: string,
  input: { via: "number"; number: string } | { via: "other"; at?: Date },
) {
  const now = ctx.now();
  const key = and(eq(callbackRequests.phoneId, phone.id), eq(callbackRequests.id, id));
  const [row] = await ctx.db.select().from(callbackRequests).where(key);
  if (!row) throw new CallbackError(404, "request not found");
  if (row.doneAt) return callbackParentJson(row, phone, now);
  const at = input.via === "other" && input.at && input.at < now ? input.at : now;
  if (row.expiresAt <= at) throw new CallbackError(409, "expired");
  if (input.via === "number") {
    const check = numberCheck(phone, row);
    if (check !== "ok") throw new CallbackError(409, check);
    if (input.number !== phone.sosCallbackNumber) throw new CallbackError(409, "changed");
  }
  const [done] = await ctx.db.update(callbackRequests).set({ doneAt: at, doneBy: userId, doneVia: input.via === "number" ? "number" : "other" })
    .where(and(key, isNull(callbackRequests.doneAt))).returning();
  if (done) return callbackParentJson(done, phone, now);
  const [again] = await ctx.db.select().from(callbackRequests).where(key);
  return callbackParentJson(again!, phone, now);
}

/** Retries requests no parent device has got yet, and deletes old ones. */
export async function sweepCallbackRequests(ctx: Ctx) {
  const now = ctx.now();
  await ctx.db.delete(callbackRequests).where(lt(callbackRequests.receivedAt, new Date(now.getTime() - KEEP_MS)));
  const waiting = await ctx.db.select().from(callbackRequests).where(and(
    isNull(callbackRequests.pushedAt), isNull(callbackRequests.doneAt), gt(callbackRequests.expiresAt, now),
  )).limit(100);
  for (const row of waiting) {
    const [phone] = await ctx.db.select().from(phones).where(eq(phones.id, row.phoneId));
    if (phone && !phone.releaseRequestedAt) await pushToParents(ctx, phone, row);
  }
}
