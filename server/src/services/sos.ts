// SPDX-License-Identifier: Apache-2.0
import { and, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";
import { householdMembers, phones, sosEvents, users } from "../db/schema.js";
import { sosMail, toLocale } from "../lib/mail-templates.js";
import type { Ctx } from "./context.js";
import { notifyUsers, pushMessage } from "./notifications.js";

const DAY = 86_400_000;
export const sosCutoff = (now: Date) => new Date(now.getTime() - 30 * DAY);

export function sosJson(row: typeof sosEvents.$inferSelect) {
  return {
    id: row.id, kind: row.kind, createdAt: row.createdAt, seenAt: row.seenAt, seenByName: row.seenByName,
    deliveredVia: row.deliveredVia, battery: row.battery,
    location: row.lat === null || row.lon === null ? null : { lat: row.lat, lon: row.lon },
  };
}

function readyForDelivery(now: Date) {
  return and(isNull(sosEvents.notificationClaimedAt),
    or(isNull(sosEvents.notificationLeaseUntil), lte(sosEvents.notificationLeaseUntil, now)));
}

export async function deliverSos(ctx: Ctx, id: string, phoneId: string) {
  const key = and(eq(sosEvents.phoneId, phoneId), eq(sosEvents.id, id));
  const now = ctx.now();
  // Keep the database connection free while external providers are working.
  const lease = new Date(now.getTime() + 60_000);
  const [row] = await ctx.db.update(sosEvents).set({ notificationLeaseUntil: lease })
    .where(and(key, readyForDelivery(now))).returning();
  if (!row) return;
  const claim = and(key, eq(sosEvents.notificationLeaseUntil, lease));
  const [phone] = await ctx.db.select().from(phones).where(eq(phones.id, phoneId));
  if (!phone || phone.releaseRequestedAt) {
    await ctx.db.update(sosEvents).set({ notificationClaimedAt: ctx.now(), notificationLeaseUntil: null }).where(claim);
    return;
  }
  const members = await ctx.db.select({ id: users.id, locale: users.locale, email: users.email })
    .from(householdMembers).innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, phone.householdId));
  const event = { type: "sos", id, phoneId, phoneName: phone.name, kind: row.kind } as const;
  let pushFailed = false;
  const [pushed, mail] = await Promise.all([
    notifyUsers(ctx, members.map((member) => member.id), event, { onFailure: () => { pushFailed = true; } }),
    Promise.allSettled((ctx.mail.canSend ? members : []).map(async (member) => {
      const locale = toLocale(member.locale);
      const message = pushMessage(event, locale);
      await ctx.mail.send(sosMail(member.email, locale, ctx.cfg.PUBLIC_URL, phoneId, message.title, message.body));
    })),
  ]);
  const mailed = mail.some((result) => result.status === "fulfilled");
  const retry = !pushed && !mailed && (pushFailed || mail.some((result) => result.status === "rejected"));
  await ctx.db.update(sosEvents).set({
    notificationLeaseUntil: null,
    notificationClaimedAt: retry ? null : ctx.now(),
    deliveredVia: pushed > 0 ? sql`coalesce(${sosEvents.deliveredVia}, 'push')` : undefined,
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
