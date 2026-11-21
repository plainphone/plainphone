// SPDX-License-Identifier: Apache-2.0
import { and, eq, inArray, lte } from "drizzle-orm";
import { householdMembers, phones, pushSubscriptions, setupUndoNotices, users } from "../db/schema.js";
import { toLocale } from "../lib/locale.js";
import { phoneAlertMail } from "../lib/mail-templates.js";
import { parentPushEnabled } from "../providers/parent-push.js";
import { deliverablePushSubscription, discardGonePushSubscription, recordFailedPush } from "./push-subscriptions.js";
import type { Ctx } from "./context.js";
import { phoneAlertRecipients, pushMessage } from "./notifications.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

export async function queueSetupUndoNotices(ctx: Ctx, tx: Tx, phone: typeof phones.$inferSelect, reportedLate: boolean) {
  const recipients = await phoneAlertRecipients(tx, phone.id, phone.householdId);
  const notice = { householdId: phone.householdId, phoneId: phone.id, phoneName: phone.name, reportedLate, nextAttemptAt: ctx.now(), createdAt: ctx.now() };
  const deliveries: (typeof setupUndoNotices.$inferInsert)[] = [];
  // Protection removed is not something a mute may hide, and an undo has no time bound: every
  // household member gets the mail. Push still follows the parent's mute for the phone.
  if (ctx.mail.canSend) {
    const members = await tx.select({ id: householdMembers.userId }).from(householdMembers)
      .where(eq(householdMembers.householdId, phone.householdId));
    for (const { id } of members) deliveries.push({ ...notice, userId: id });
  }
  const platforms = (["web", "apns", "fcm"] as const).filter((platform) => parentPushEnabled(ctx.parentPush, platform));
  if (platforms.length && recipients.length) {
    const subscriptions = await tx.select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId })
      .from(pushSubscriptions).where(and(deliverablePushSubscription(), inArray(pushSubscriptions.platform, platforms),
        inArray(pushSubscriptions.userId, recipients.map(({ id }) => id))));
    for (const sub of subscriptions) {
      deliveries.push({ ...notice, userId: sub.userId, subscriptionId: sub.id });
    }
  }
  if (deliveries.length > 0) await tx.insert(setupUndoNotices).values(deliveries);
}

const BATCH_LIMIT = 10;
const BATCH_BUDGET_MS = 10_000;
const CLAIM_MS = 15 * 60_000;
/** A notice that still fails after this long is dropped: the cause is not going away (docs/sync-api.md). */
export const MAX_LIFETIME_MS = 24 * 3_600_000;
const RETRY_MAX_MS = 3_600_000;

/** One minute after the first failure, doubling, at most an hour. */
export function retryDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.min(attempts, 12), RETRY_MAX_MS);
}

/** Deliver each destination independently so one failing endpoint cannot make the others repeat. */
export async function deliverSetupUndoNotices(ctx: Ctx) {
  let deadline = performance.now() + BATCH_BUDGET_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      deliverBatch(ctx, () => performance.now() >= deadline).catch((error: unknown) => {
        if (deadline !== 0) throw error;
        console.error("setup undo notice batch failed after its deadline");
      }),
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
    const membership = and(eq(householdMembers.userId, notice.userId), eq(householdMembers.householdId, notice.householdId));
    const [recipient] = notice.subscriptionId
      ? await ctx.db.select({ sub: pushSubscriptions, locale: users.locale })
        .from(householdMembers).innerJoin(users, eq(users.id, householdMembers.userId))
        .innerJoin(pushSubscriptions, eq(pushSubscriptions.userId, householdMembers.userId))
        .where(and(membership, eq(pushSubscriptions.id, notice.subscriptionId), deliverablePushSubscription()))
      : await ctx.db.select({ email: users.email, locale: users.locale })
        .from(householdMembers).innerJoin(users, eq(users.id, householdMembers.userId))
        .where(membership);

    if (budgetExpired()) {
      await ctx.db.update(setupUndoNotices).set({ nextAttemptAt: ctx.now() }).where(claim);
      break;
    }

    try {
      if (recipient) {
        const event = {
          phoneId: notice.phoneId, phoneName: notice.phoneName, reason: "setup-undo", reportedLate: notice.reportedLate,
        } as const;
        const locale = toLocale(recipient.locale);
        if ("sub" in recipient) {
          if (!parentPushEnabled(ctx.parentPush, recipient.sub.platform)) throw new Error("push unavailable");
          const result = await ctx.parentPush.send(recipient.sub, pushMessage({ type: "protection", ...event }, locale), { urgent: true });
          if (result === "gone") await discardGonePushSubscription(ctx, recipient.sub);
          if (result === "failed") {
            // Counted like any other push, so a Web Push endpoint that keeps failing is dropped and the notice with it.
            await recordFailedPush(ctx, recipient.sub);
            throw new Error("push delivery failed");
          }
        } else {
          if (!ctx.mail.canSend) throw new Error("mail unavailable");
          await ctx.mail.send(phoneAlertMail(recipient.email, locale, ctx.cfg.PUBLIC_URL, { kind: "protection", ...event }));
        }
      }
    } catch {
      const now = ctx.now();
      if (now.getTime() - notice.createdAt.getTime() >= MAX_LIFETIME_MS) {
        console.error(`setup undo notice dropped after ${notice.attempts + 1} failed attempts`);
        await ctx.db.delete(setupUndoNotices).where(claim);
        continue;
      }
      console.error("setup undo notice delivery failed; will retry");
      await ctx.db.update(setupUndoNotices)
        .set({ attempts: notice.attempts + 1, nextAttemptAt: new Date(now.getTime() + retryDelayMs(notice.attempts)) })
        .where(claim);
      continue;
    }
    await ctx.db.delete(setupUndoNotices).where(claim);
  }
}
