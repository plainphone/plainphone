// SPDX-License-Identifier: Apache-2.0
import { and, eq, gt, isNull, lt } from "drizzle-orm";
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

export async function deliverSos(ctx: Ctx, id: string, phoneId: string) {
  const key = and(eq(sosEvents.phoneId, phoneId), eq(sosEvents.id, id));
  const [row] = await ctx.db.update(sosEvents).set({ notificationClaimedAt: ctx.now() })
    .where(and(key, isNull(sosEvents.notificationClaimedAt))).returning();
  if (!row) return;
  const [phone] = await ctx.db.select().from(phones).where(eq(phones.id, phoneId));
  if (!phone || phone.releaseRequestedAt) return;
  const members = await ctx.db.select({ id: users.id, locale: users.locale, email: users.email })
    .from(householdMembers).innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, phone.householdId));
  const event = { type: "sos", id, phoneId, phoneName: phone.name, kind: row.kind } as const;
  const [pushed] = await Promise.all([
    notifyUsers(ctx, members.map((member) => member.id), event),
    Promise.allSettled(members.map(async (member) => {
      if (!ctx.mail.canSend) return;
      const locale = toLocale(member.locale);
      const message = pushMessage(event, locale);
      await ctx.mail.send(sosMail(member.email, locale, ctx.cfg.PUBLIC_URL, phoneId, message.title, message.body));
    })),
  ]);
  if (pushed > 0) {
    await ctx.db.update(sosEvents).set({ deliveredVia: "push" }).where(and(key, isNull(sosEvents.deliveredVia)));
  }
}

export async function sweepSos(ctx: Ctx) {
  const cutoff = sosCutoff(ctx.now());
  await ctx.db.delete(sosEvents).where(lt(sosEvents.createdAt, cutoff));
  const pending = await ctx.db.select({ id: sosEvents.id, phoneId: sosEvents.phoneId }).from(sosEvents)
    .where(and(isNull(sosEvents.notificationClaimedAt), gt(sosEvents.createdAt, cutoff))).limit(100);
  for (const { id, phoneId } of pending) await deliverSos(ctx, id, phoneId);
}
