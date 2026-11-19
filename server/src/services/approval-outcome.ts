// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import { pendingChanges } from "../db/schema.js";
import type { Ctx } from "./context.js";

/**
 * What happened to a request a trusted person was asked to decide. Web, the parent app and
 * the phone show the same outcome, whichever of them the answer came from.
 */
export type ApprovalOutcome =
  | "approvedByYou"
  | "approvedByOther"
  | "declinedByYou"
  | "declinedByOther"
  | "cancelled"
  | "failed"
  /** Still waiting, but the preview or code no longer matches. Ask for a fresh one. */
  | "changed"
  /** Still waiting, but the one-time code ran out. */
  | "codeExpired";

export interface DecisionResult {
  /** The change is in the state the caller asked for, so the call can be repeated safely. */
  ok: boolean;
  outcome: ApprovalOutcome;
}

/** The expiry (ms since epoch) a one-time approval code carries, or null for a code that is not one. */
function challengeExpiry(challenge: string | undefined): number | null {
  const expiry = Number(challenge?.split(".")[2]);
  return Number.isFinite(expiry) ? expiry : null;
}

/**
 * Explains why a decision was not applied now, and treats repeating the same decision as success.
 * The first decision wins: approving a request that the same person already approved is fine,
 * approving one that was declined (or the other way round) is a conflict.
 */
export async function explainDecision(
  ctx: Ctx,
  changeId: string,
  userId: string,
  intent: "approve" | "reject",
  challenge?: string,
): Promise<DecisionResult> {
  const [row] = await ctx.db.select({ status: pendingChanges.status, decidedBy: pendingChanges.decidedBy })
    .from(pendingChanges).where(eq(pendingChanges.id, changeId));
  const mine = row?.decidedBy === userId;
  switch (row?.status) {
    case "applied":
      return { ok: intent === "approve" && mine, outcome: mine ? "approvedByYou" : "approvedByOther" };
    case "rejected":
      return { ok: intent === "reject" && mine, outcome: mine ? "declinedByYou" : "declinedByOther" };
    case "cancelled":
      return { ok: false, outcome: "cancelled" };
    case "failed":
      return { ok: false, outcome: "failed" };
    default: {
      const expiry = challengeExpiry(challenge);
      return { ok: false, outcome: expiry !== null && expiry <= ctx.now().getTime() ? "codeExpired" : "changed" };
    }
  }
}

/** What the phone shows next to the QR code it is displaying. */
export type PhoneApprovalState = "waiting" | "approved" | "declined" | "cancelled" | "failed";

const PHONE_STATE: Record<string, PhoneApprovalState> = {
  pending: "waiting",
  applied: "approved",
  rejected: "declined",
  cancelled: "cancelled",
  failed: "failed",
};

export async function phoneApprovalState(ctx: Ctx, phoneId: string, changeId: string): Promise<PhoneApprovalState | null> {
  const [row] = await ctx.db.select({ status: pendingChanges.status, phoneId: pendingChanges.phoneId })
    .from(pendingChanges).where(eq(pendingChanges.id, changeId));
  return row && row.phoneId === phoneId ? PHONE_STATE[row.status] ?? null : null;
}
