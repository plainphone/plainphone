// SPDX-License-Identifier: Apache-2.0
import { and, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";
import { householdMembers, phones, sosDeliveries, sosEvents, users } from "../db/schema.js";
import { toLocale } from "../lib/locale.js";
import { sosMail } from "../lib/mail-templates.js";
import type { Ctx } from "./context.js";
import { notifyUsers, pushMessage } from "./notifications.js";

const DAY = 86_400_000;
export const sosCutoff = (now: Date) => new Date(now.getTime() - 30 * DAY);

export function sosJson(row: typeof sosEvents.$inferSelect) {
  return {
    id: row.id, kind: row.kind, createdAt: row.createdAt, seenAt: row.seenAt, seenByName: row.seenByName,
    deliveredVia: row.deliveredVia, deliveryFailedAt: row.deliveryFailedAt, battery: row.battery,
    location: row.lat === null || row.lon === null ? null : { lat: row.lat, lon: row.lon },
    trigger: row.trigger, message: row.message,
  };
}

/** Longest a single provider call may take, so one slow server cannot outlive the lease. */
export const SOS_SEND_TIMEOUT_MS = 20_000;
/** The lease is far longer than the send timeout: a live worker always finishes first. */
const LEASE_MS = 120_000;
const RETRY_MS = 60_000;
/** After this long the incident is closed as undelivered and shown as such in the dashboard. */
export const SOS_GIVE_UP_MS = 6 * 3_600_000;

function readyForDelivery(now: Date) {
  return and(isNull(sosEvents.notificationClaimedAt),
    or(isNull(sosEvents.notificationLeaseUntil), lte(sosEvents.notificationLeaseUntil, now)));
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

export async function deliverSos(ctx: Ctx, id: string, phoneId: string, opts: { sendTimeoutMs?: number } = {}) {
  const sendTimeout = opts.sendTimeoutMs ?? SOS_SEND_TIMEOUT_MS;
  const key = and(eq(sosEvents.phoneId, phoneId), eq(sosEvents.id, id));
  const now = ctx.now();
  // Keep the database connection free while external providers are working.
  const lease = new Date(now.getTime() + LEASE_MS);
  const [row] = await ctx.db.update(sosEvents).set({ notificationLeaseUntil: lease })
    .where(and(key, readyForDelivery(now))).returning();
  if (!row) return;
  const claim = and(key, eq(sosEvents.notificationLeaseUntil, lease));
  const close = (extra: Partial<typeof sosEvents.$inferInsert> = {}) =>
    ctx.db.update(sosEvents).set({ notificationClaimedAt: ctx.now(), notificationLeaseUntil: null, ...extra }).where(claim);
  // One round trip for everything the fan-out needs, instead of three in a row.
  const [[phone], members, sent] = await Promise.all([
    ctx.db.select().from(phones).where(eq(phones.id, phoneId)),
    ctx.db.select({ id: users.id, locale: users.locale, email: users.email })
      .from(householdMembers).innerJoin(users, eq(users.id, householdMembers.userId))
      .innerJoin(phones, eq(phones.householdId, householdMembers.householdId))
      .where(eq(phones.id, phoneId)),
    ctx.db.select().from(sosDeliveries)
      .where(and(eq(sosDeliveries.phoneId, phoneId), eq(sosDeliveries.eventId, id))),
  ]);
  if (!phone || phone.releaseRequestedAt || row.seenAt) {
    await close();
    return;
  }
  const state = new Map(sent.map((delivery) => [delivery.userId, delivery]));
  const event = { type: "sos", id, phoneId, phoneName: phone.name, kind: row.kind, trigger: row.trigger, message: row.message } as const;
  let pushedNow = 0;
  // Each parent is tracked on their own: a retry only repeats what failed for them.
  const finished = await Promise.all(members.map(async (member) => {
    const before = state.get(member.id);
    if (before?.doneAt) return true;
    let pushedAt = before?.pushedAt ?? null;
    let mailedAt = before?.mailedAt ?? null;
    let failed = false;
    // Record each channel the moment it succeeds, so a worker taking over never repeats it.
    const record = (set: { pushedAt?: Date; mailedAt?: Date }) => ctx.db.insert(sosDeliveries)
      .values({ phoneId, eventId: id, userId: member.id, ...set })
      .onConflictDoUpdate({ target: [sosDeliveries.phoneId, sosDeliveries.eventId, sosDeliveries.userId], set });
    await Promise.all([
      pushedAt ? undefined : (async () => {
        const sentCount = await withTimeout(notifyUsers(ctx, [member.id], event, {
          keepOnTransientFailure: true, onFailure: () => { failed = true; }, originAt: row.receivedAt,
        }), sendTimeout).catch(() => { failed = true; return 0; });
        if (sentCount > 0) { pushedAt = ctx.now(); pushedNow += sentCount; await record({ pushedAt }); }
      })(),
      mailedAt || !ctx.mail.canSend ? undefined : (async () => {
        const locale = toLocale(member.locale);
        const message = pushMessage(event, locale);
        try {
          await withTimeout(ctx.mail.send(sosMail(member.email, locale, ctx.cfg.PUBLIC_URL, phoneId, message.title, message.body)), sendTimeout);
          mailedAt = ctx.now();
          await record({ mailedAt });
        } catch {
          failed = true;
        }
      })(),
    ]);
    // Reached by any channel, or nothing could reach them (no registration, no mail): stop retrying.
    const done = Boolean(pushedAt || mailedAt) || !failed;
    if (done) {
      await ctx.db.insert(sosDeliveries).values({ phoneId, eventId: id, userId: member.id, pushedAt, mailedAt, doneAt: ctx.now() })
        .onConflictDoUpdate({
          target: [sosDeliveries.phoneId, sosDeliveries.eventId, sosDeliveries.userId], set: { doneAt: ctx.now() },
        });
    }
    return done;
  }));
  const allDone = finished.every(Boolean);
  const gaveUp = !allDone && ctx.now().getTime() - row.receivedAt.getTime() >= SOS_GIVE_UP_MS;
  await ctx.db.update(sosEvents).set({
    notificationClaimedAt: allDone || gaveUp ? ctx.now() : null,
    // While retrying, the lease doubles as the earliest time of the next attempt.
    notificationLeaseUntil: allDone || gaveUp ? null : new Date(ctx.now().getTime() + RETRY_MS),
    deliveryFailedAt: gaveUp ? ctx.now() : undefined,
    deliveredVia: pushedNow > 0 ? sql`coalesce(${sosEvents.deliveredVia}, 'push')` : undefined,
  }).where(claim);
}

export async function sweepSos(ctx: Ctx) {
  const now = ctx.now();
  const cutoff = sosCutoff(now);
  await ctx.db.delete(sosEvents).where(lt(sosEvents.createdAt, cutoff));
  const pending = await ctx.db.select({ id: sosEvents.id, phoneId: sosEvents.phoneId }).from(sosEvents)
    .where(and(readyForDelivery(now), gt(sosEvents.createdAt, cutoff))).limit(100);
  for (const { id, phoneId } of pending) {
    await deliverSos(ctx, id, phoneId).catch(() => console.error("SOS notification dispatch failed"));
  }
}
