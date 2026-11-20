// SPDX-License-Identifier: Apache-2.0
//
// Which news reaches a parent at once and which can wait for the weekly summary
// (docs/weekly-summary.md). The default is "act now": only what is plainly informational
// may wait, and an alert that is missing is worse than one that is early.

import { and, eq } from "drizzle-orm";
import { householdMembers, households, phones, pushSubscriptions } from "../db/schema.js";
import { deliverablePushSubscription } from "./push-subscriptions.js";
import type { Ctx } from "./context.js";
import type { NotifyEvent } from "./notifications.js";

export type AlertClass = "act-now" | "can-wait";

/**
 * Event types that may wait for the weekly summary. Empty today: everything is "act now". A phone
 * out of contact may not wait either (Mads 19/11-26: "Offline altid med det samme"), because a
 * reset or switched-off child phone also shows as offline. Add a type here only for news that is
 * purely informational. Exported so tests can exercise the batching with a stand-in type.
 */
export const CAN_WAIT: Set<NotifyEvent["type"]> = new Set();

/**
 * - Act now: SOS, a request or approval waiting for an answer, protection removed, a phone out of
 *   contact, the answer to a ring or "Are you okay?" the parent just started, and the test
 *   notification.
 * - Can wait: nothing yet (see CAN_WAIT).
 */
export function alertClass(e: NotifyEvent): AlertClass {
  return CAN_WAIT.has(e.type) ? "can-wait" : "act-now";
}

/**
 * True when the event goes into the summary instead of a push or mail: the household has the
 * summary on (with a way to deliver it), the phone itself is in the summary, and "only alert me
 * when I must act" is on. SOS is never batched, whatever its class.
 */
export async function batchedIntoSummary(ctx: Ctx, householdId: string, e: NotifyEvent): Promise<boolean> {
  if (e.type === "sos" || alertClass(e) !== "can-wait") return false;
  const [h] = await ctx.db
    .select({ on: households.summaryEnabled, actNowOnly: households.actNowOnly, mail: households.summaryByMail, push: households.summaryByPush })
    .from(households)
    .where(eq(households.id, householdId));
  if (!h || !h.on || !h.actNowOnly) return false;
  // A phone left out of the summary would lose the news altogether.
  if ("phoneId" in e) {
    const [p] = await ctx.db.select({ on: phones.weeklySummaryEnabled }).from(phones).where(eq(phones.id, e.phoneId));
    if (!p?.on) return false;
  }
  // With no way to deliver the summary, holding news back would hide it.
  if (h.mail && ctx.mail.canSend) return true;
  if (!h.push) return false;
  const [sub] = await ctx.db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .innerJoin(householdMembers, eq(householdMembers.userId, pushSubscriptions.userId))
    .where(and(eq(householdMembers.householdId, householdId), deliverablePushSubscription()))
    .limit(1);
  return !!sub;
}
