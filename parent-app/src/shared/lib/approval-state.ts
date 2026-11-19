// SPDX-License-Identifier: Apache-2.0
//
// What happened to a request a trusted person was asked to decide, in one vocabulary for the
// dashboard, the parent app and the phone. The server's `outcome` field names it; a repeated
// answer is a success there, so the screen only has to show the processed state.
import type { MessageKey } from "../i18n/en";

export type ApprovalOutcome =
  | "approvedByYou"
  | "approvedByOther"
  | "declinedByYou"
  | "declinedByOther"
  | "cancelled"
  | "failed"
  | "changed"
  | "codeExpired";

export type Decision = "approve" | "reject";

const OUTCOMES: readonly string[] = [
  "approvedByYou", "approvedByOther", "declinedByYou", "declinedByOther", "cancelled", "failed", "changed", "codeExpired",
];

/** The outcome a 409 explained, or null when the server did not say (an older server). */
export function outcomeOf(data: { outcome?: string } | undefined): ApprovalOutcome | null {
  return data?.outcome && OUTCOMES.includes(data.outcome) ? (data.outcome as ApprovalOutcome) : null;
}

/** `changed` and `codeExpired` leave the request open: the helper can try again with a fresh preview or code. */
export function isFinal(outcome: ApprovalOutcome): boolean {
  return outcome !== "changed" && outcome !== "codeExpired";
}

export function decisionOutcome(decision: Decision): ApprovalOutcome {
  return decision === "approve" ? "approvedByYou" : "declinedByYou";
}

/** Copy for an outcome. Asking for the opposite of what you already answered says so plainly. */
export function outcomeKey(outcome: ApprovalOutcome, decision: Decision): MessageKey {
  const opposite = (outcome === "approvedByYou" && decision === "reject") || (outcome === "declinedByYou" && decision === "approve");
  if (opposite) return outcome === "approvedByYou" ? "status.conflict.approvedByYou" : "status.conflict.declinedByYou";
  return `status.outcome.${outcome}`;
}

export interface Processed<A> {
  approval: A;
  outcome: ApprovalOutcome;
  decision: Decision;
}

/** Open requests first, as the server sent them; answered ones stay below with their result until the page is left. */
export function queueOf<A extends { id: string }>(pending: A[], processed: Record<string, Processed<A>>) {
  const open = pending.filter((a) => !processed[a.id]);
  const done = Object.values(processed);
  return { open, done };
}

export function queueSummaryKey(open: number, answered: number): { key: MessageKey; n: number } | null {
  if (open === 1) return { key: "status.queue.one", n: 1 };
  if (open > 1) return { key: "status.queue.many", n: open };
  return answered > 0 ? { key: "status.queue.done", n: 0 } : null;
}
