// SPDX-License-Identifier: Apache-2.0
import { and, eq, inArray, lte } from "drizzle-orm";
import { phones, pushSubscriptions, setupUndoNotices, users } from "../db/schema.js";
import { phoneAlertMail, toLocale } from "../lib/mail-templates.js";
import type { Ctx } from "./context.js";
import { phoneAlertRecipients, pushMessage } from "./notifications.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

export async function queueSetupUndoNotices(ctx: Ctx, tx: Tx, phone: typeof phones.$inferSelect) {
  const recipients = await phoneAlertRecipients(tx, phone.id, phone.householdId);
  if (recipients.length === 0) return;
  const notice = { phoneId: phone.id, phoneName: phone.name, nextAttemptAt: ctx.now() };
  const deliveries: (typeof setupUndoNotices.$inferInsert)[] = [];
  if (ctx.mail.canSend) {
    for (const { id } of recipients) deliveries.push({ ...notice, userId: id });
  }
  if (ctx.parentPush.webPublicKey) {
    const subscriptions = await tx.select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId })
      .from(pushSubscriptions).where(and(eq(pushSubscriptions.platform, "web"),
        inArray(pushSubscriptions.userId, recipients.map(({ id }) => id))));
    for (const sub of subscriptions) deliveries.push({ ...notice, userId: sub.userId, subscriptionId: sub.id });
  }
  if (deliveries.length > 0) await tx.insert(setupUndoNotices).values(deliveries);
}

/** Deliver each destination independently so one failing endpoint cannot make the others repeat. */
export async function deliverSetupUndoNotices(ctx: Ctx) {
  const due = lte(setupUndoNotices.nextAttemptAt, ctx.now());
  const rows = await ctx.db.select({ id: setupUndoNotices.id }).from(setupUndoNotices)
    .where(due)
    .orderBy(setupUndoNotices.nextAttemptAt).limit(100);
  for (const { id } of rows) {
    await ctx.db.transaction(async (tx) => {
      const [notice] = await tx.select().from(setupUndoNotices)
        .where(and(eq(setupUndoNotices.id, id), due)).for("update", { skipLocked: true });
      if (!notice) return;
      const [user] = await tx.select().from(users).where(eq(users.id, notice.userId));
      if (!user) return;

      const event = { phoneId: notice.phoneId, phoneName: notice.phoneName, reason: "setup-undo" } as const;
      const locale = toLocale(user.locale);
      try {
        if (notice.subscriptionId) {
          const [sub] = await tx.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.id, notice.subscriptionId), eq(pushSubscriptions.userId, user.id)));
          if (sub) {
            if (!ctx.parentPush.webPublicKey) throw new Error("push unavailable");
            const result = await ctx.parentPush.send(sub, pushMessage({ type: "protection", ...event }, locale), { urgent: true });
            if (result === "failed") throw new Error("push delivery failed");
          }
        } else {
          if (!ctx.mail.canSend) throw new Error("mail unavailable");
          await ctx.mail.send(phoneAlertMail(user.email, locale, ctx.cfg.PUBLIC_URL, { kind: "protection", ...event }));
        }
      } catch {
        console.error("setup undo notice delivery failed; will retry");
        await tx.update(setupUndoNotices).set({ nextAttemptAt: new Date(ctx.now().getTime() + 60_000) })
          .where(eq(setupUndoNotices.id, id));
        return;
      }
      await tx.delete(setupUndoNotices).where(eq(setupUndoNotices.id, id));
    });
  }
}
