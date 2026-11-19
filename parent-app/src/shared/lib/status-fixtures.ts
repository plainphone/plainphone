// SPDX-License-Identifier: Apache-2.0
//
// Synthetic phones and requests for tests and screenshots. Nobody real: Alex Demo and Sam Demo.
// Both the dashboard and the parent app render these, so before/after captures match.
import type { ApprovalOutcome, Decision } from "./approval-state";
import type { PhoneStateInput } from "./phone-state";

export const FIXTURE_NOW = Date.parse("2026-11-19T09:00:00Z");
const ago = (minutes: number) => new Date(FIXTURE_NOW - minutes * 60_000).toISOString();

type PhoneFixture = PhoneStateInput & { id: string; name: string; label: string };

const base = { offlineAlertHours: null, offlineAlertHoursDefault: 24 } as const;

export const phoneFixtures: PhoneFixture[] = [
  { ...base, id: "never", label: "never connected", name: "Alex Demo", lastSeenAt: null, status: null },
  { ...base, id: "stale", label: "stale", name: "Sam Demo", lastSeenAt: ago(3 * 24 * 60), status: { rulesAppliedAt: ago(3 * 24 * 60) }, rulesCurrent: true },
  { ...base, id: "noReport", label: "online, no report", name: "Alex Demo", lastSeenAt: ago(2), status: null },
  { ...base, id: "waiting", label: "waiting for phone", name: "Sam Demo", lastSeenAt: ago(5), status: { rulesAppliedAt: ago(180) }, rulesCurrent: false },
  { ...base, id: "applied", label: "applied", name: "Alex Demo", lastSeenAt: ago(1), status: { rulesAppliedAt: ago(20) }, rulesCurrent: true },
];

export interface ApprovalFixture {
  id: string;
  label: string;
  phoneName: string;
  summary: { en: string; da: string };
  /** Null while the request still waits. */
  processed: { decision: Decision; outcome: ApprovalOutcome } | null;
}

const summary = { en: "Instagram: 15 → 30 min a day", da: "Instagram: 15 → 30 min om dagen" };

export const approvalFixtures: ApprovalFixture[] = [
  { id: "a1", label: "waiting", phoneName: "Alex Demo", summary, processed: null },
  { id: "a2", label: "approved", phoneName: "Alex Demo", summary, processed: { decision: "approve", outcome: "approvedByYou" } },
  { id: "a3", label: "declined", phoneName: "Sam Demo", summary, processed: { decision: "reject", outcome: "declinedByYou" } },
  { id: "a4", label: "expired code", phoneName: "Sam Demo", summary, processed: { decision: "approve", outcome: "codeExpired" } },
  { id: "a5", label: "conflicting decision", phoneName: "Alex Demo", summary, processed: { decision: "approve", outcome: "declinedByYou" } },
];
