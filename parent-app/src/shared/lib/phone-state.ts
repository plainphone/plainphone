// SPDX-License-Identifier: Apache-2.0
//
// One answer to "has the phone got my rules?", shared by the dashboard and the parent app.
// The last connection and the last confirmed rules are different facts, so they never
// share a sentence: "Last online just now" next to "No status yet" read like a contradiction.
import type { MessageKey } from "../i18n/en";

const DEFAULT_OFFLINE_HOURS = 24;

export type PhoneState = "neverConnected" | "stale" | "noReport" | "waiting" | "applied";

export interface PhoneStateInput {
  lastSeenAt: string | null;
  /** Null until the phone has reported once. */
  status?: { rulesAppliedAt?: string | null } | null;
  /** Only known for a single phone: whether the phone confirmed the rules the server holds now. */
  rulesCurrent?: boolean | null;
  /** Hours of silence before the phone counts as offline; null = the server default. */
  offlineAlertHours?: number | null;
  offlineAlertHoursDefault?: number;
}

export interface PhoneStateSummary {
  state: PhoneState;
  title: MessageKey;
  hint: MessageKey;
  /** The time the title or hint talks about, for the {when} placeholder. */
  at: string | null;
  /** Something the parent should look at, so the row can stand out. */
  attention: boolean;
}

const COPY: Record<PhoneState, { title: MessageKey; hint: MessageKey; attention: boolean }> = {
  neverConnected: { title: "status.never.title", hint: "status.never.hint", attention: false },
  stale: { title: "status.stale.title", hint: "status.stale.hint", attention: true },
  noReport: { title: "status.noReport.title", hint: "status.noReport.hint", attention: false },
  waiting: { title: "status.waiting.title", hint: "status.waiting.hint", attention: false },
  applied: { title: "status.applied.title", hint: "status.applied.hint", attention: false },
};

export function phoneState(p: PhoneStateInput, now: number): PhoneStateSummary {
  const hours = p.offlineAlertHours ?? p.offlineAlertHoursDefault ?? DEFAULT_OFFLINE_HOURS;
  let state: PhoneState;
  let at: string | null = p.lastSeenAt;
  if (!p.lastSeenAt) state = "neverConnected";
  // 0 hours means "never alert", so silence never makes the phone stale.
  else if (hours > 0 && now - Date.parse(p.lastSeenAt) > hours * 3_600_000) state = "stale";
  else if (p.rulesCurrent === false) state = "waiting";
  // The list has no rulesCurrent, so it cannot tell "confirmed" from "waiting": it says only that the phone is online.
  else if (!p.status?.rulesAppliedAt || p.rulesCurrent === undefined) state = "noReport";
  else {
    state = "applied";
    at = p.status.rulesAppliedAt;
  }
  return { state, ...COPY[state], at };
}
