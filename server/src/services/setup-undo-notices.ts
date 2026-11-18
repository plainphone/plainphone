// SPDX-License-Identifier: Apache-2.0
import { and, eq, inArray, lte } from "drizzle-orm";
import { householdMembers, phones, pushSubscriptions, setupUndoNotices, users } from "../db/schema.js";
import { phoneAlertMail, toLocale } from "../lib/mail-templates.js";
import type { Ctx } from "./context.js";
import { phoneAlertRecipients, pushMessage } from "./notifications.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

export async function queueSetupUndoNotices(ctx: Ctx, tx: Tx, phone: typeof phones.$inferSelect) {
  const recipients = await phoneAlertRecipients(tx, phone.id, phone.householdId);
  if (recipients.length === 0) return;
  const notice = { householdId: phone.householdId, phoneId: phone.id, phoneName: phone.name, nextAttemptAt: ctx.now() };
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

const BATCH_LIMIT = 10;
const BATCH_BUDGET_MS = 10_000;
const CLAIM_MS = 15 * 60_000;

/** Deliver each destination independently so one failing endpoint cannot make the others repeat. */
export async function deliverSetupUndoNotices(ctx: Ctx) {
  let deadline = performance.now() + BATCH_BUDGET_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      deliverBatch(ctx, () => performance.now() >= deadline),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          deadline = 0;
          resolve();
        }, BATCH_BUDGET_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function deliverBatch(ctx: Ctx, budgetExpired: () => boolean) {
  const due = lte(setupUndoNotices.nextAttemptAt, ctx.now());
  const rows = await ctx.db.select({ id: setupUndoNotices.id }).from(setupUndoNotices)
    .where(due)
    .orderBy(setupUndoNotices.nextAttemptAt).limit(BATCH_LIMIT);
  for (const { id } of rows) {
    if (budgetExpired()) break;
    // Reuse the due time as a lease so a crashed worker does not strand a notice.
    const claimedUntil = new Date(ctx.now().getTime() + CLAIM_MS);
    const [notice] = await ctx.db.update(setupUndoNotices).set({ nextAttemptAt: claimedUntil })
      .where(and(eq(setupUndoNotices.id, id), due)).returning();
    if (!notice) continue;

    const claim = and(eq(setupUndoNotices.id, id), eq(setupUndoNotices.nextAttemptAt, claimedUntil));
    const [user] = await ctx.db.select({ id: users.id, email: users.email, locale: users.locale })
      .from(householdMembers).innerJoin(users, eq(users.id, householdMembers.userId))
      .where(and(eq(householdMembers.userId, notice.userId), eq(householdMembers.householdId, notice.householdId)));

    try {
      if (user) {
        const event = { phoneId: notice.phoneId, phoneName: notice.phoneName, reason: "setup-undo" } as const;
        const locale = toLocale(user.locale);
        if (notice.subscriptionId) {
          const [sub] = await ctx.db.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.id, notice.subscriptionId), eq(pushSubscriptions.userId, user.id)));
          if (sub) {
            if (!ctx.parentPush.webPublicKey) throw new Error("push unavailable");
            const result = await ctx.parentPush.send(sub, pushMessage({ type: "protection", ...event }, locale), { urgent: true });
            if (result === "failed") throw new Error("push delivery failed");
          }
        } else {
          if (!ctx.mail.canSend) throw new Error("mail unavailable");
          await ctx.mail.send(phoneAlertMail(user.email, locale, ctx.cfg.PUBLIC_URL, { kind: "protection", ...event }));
        }
      }
    } catch {
      console.error("setup undo notice delivery failed; will retry");
      await ctx.db.update(setupUndoNotices).set({ nextAttemptAt: new Date(ctx.now().getTime() + 60_000) }).where(claim);
      continue;
    }
    await ctx.db.delete(setupUndoNotices).where(claim);
  }
}
