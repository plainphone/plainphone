// SPDX-License-Identifier: Apache-2.0
//
// Which news reaches a parent at once and which can wait for the weekly summary
// (docs/weekly-summary.md). The default is "act now": only what is plainly informational
// may wait, and an alert that is missing is worse than one that is early.

import { eq } from "drizzle-orm";
import { households } from "../db/schema.js";
import type { Ctx } from "./context.js";
import type { NotifyEvent } from "./notifications.js";

export type AlertClass = "act-now" | "can-wait";

/**
 * - Act now: SOS, a request or approval waiting for an answer, protection removed, the answer to a
 *   ring or "Are you okay?" the parent just started, and the test notification.
 * - Can wait: a phone that has been out of contact for a long time (it is often just flat or
 *   switched off). The same news is in the summary, so it is not lost.
 */
export function alertClass(e: NotifyEvent): AlertClass {
  switch (e.type) {
    case "offline":
      return "can-wait";
    case "protection":
    case "approval":
    case "request":
    case "safety":
    case "sos":
    case "test":
    case "summary":
      return "act-now";
  }
}

/**
 * True when the event goes into the summary instead of a push or mail: the household has the
 * summary on (with a way to deliver it) and "only alert me when I must act" on. SOS is never
 * batched, whatever its class.
 */
export async function batchedIntoSummary(ctx: Ctx, householdId: string, e: NotifyEvent): Promise<boolean> {
  if (e.type === "sos" || alertClass(e) !== "can-wait") return false;
  const [h] = await ctx.db
    .select({ on: households.summaryEnabled, actNowOnly: households.actNowOnly, mail: households.summaryByMail, push: households.summaryByPush })
    .from(households)
    .where(eq(households.id, householdId));
  // With no way to deliver the summary, holding news back would hide it.
  return !!h && h.on && h.actNowOnly && (h.mail || h.push);
}
