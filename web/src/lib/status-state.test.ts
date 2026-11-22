// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { da } from "@plainphone/i18n/da";
import { en } from "@plainphone/i18n/en";
import { decisionOutcome, isFinal, outcomeKey, outcomeOf, queueOf, queueSummaryKey } from "@plainphone/shared/approval-state";
import { phoneState } from "@plainphone/shared/phone-state";
import { approvalFixtures, FIXTURE_NOW, phoneFixtures } from "@plainphone/shared/status-fixtures";

it("gives every phone fixture one state, and the states differ", () => {
  const states = Object.fromEntries(phoneFixtures.map((p) => [p.id, phoneState(p, FIXTURE_NOW)]));
  expect(Object.values(states).map((s) => s.state)).toEqual(["neverConnected", "stale", "noReport", "waiting", "applied"]);
  expect(states.stale!.attention).toBe(true);
  expect(states.applied!.at).toBe(phoneFixtures[4]!.status?.rulesAppliedAt);
  expect(states.never!.at).toBeNull();
});

it("never says a phone was online and has no status in the same breath", () => {
  const online = phoneFixtures.find((p) => p.id === "noReport")!;
  const s = phoneState(online, FIXTURE_NOW);
  expect(en[s.title]).toBe("Online {when}");
  expect(en[s.hint]).toContain("not yet confirmed which rules apply");
});

it("uses the per-phone offline threshold before the server default", () => {
  const p = { ...phoneFixtures[4]!, offlineAlertHours: 1, lastSeenAt: new Date(FIXTURE_NOW - 2 * 3_600_000).toISOString() };
  expect(phoneState(p, FIXTURE_NOW).state).toBe("stale");
  expect(phoneState({ ...p, offlineAlertHours: 3 }, FIXTURE_NOW).state).toBe("applied");
});

it("never calls a phone stale when offline alerts are off (0 hours)", () => {
  const p = { ...phoneFixtures[4]!, offlineAlertHours: 0, lastSeenAt: new Date(FIXTURE_NOW - 3 * 24 * 3_600_000).toISOString() };
  expect(phoneState(p, FIXTURE_NOW).state).toBe("applied");
  expect(phoneState({ ...p, offlineAlertHours: null, offlineAlertHoursDefault: 0 }, FIXTURE_NOW).state).toBe("applied");
});

it("does not claim confirmed rules where the list cannot know (rulesCurrent absent)", () => {
  const { rulesCurrent: _unused, ...listRow } = phoneFixtures[4]!;
  expect(phoneState(listRow, FIXTURE_NOW).state).toBe("noReport");
});

it("keeps stale ahead of waiting: an offline phone cannot be waited for as if it were coming", () => {
  expect(phoneState({ ...phoneFixtures[3]!, lastSeenAt: new Date(FIXTURE_NOW - 48 * 3_600_000).toISOString() }, FIXTURE_NOW).state).toBe("stale");
});

it("describes every approval fixture in both languages without leftover placeholders", () => {
  const seen = new Set<string>();
  for (const a of approvalFixtures) {
    if (!a.processed) continue;
    const key = outcomeKey(a.processed.outcome, a.processed.decision);
    seen.add(key);
    for (const text of [en[key], da[key]]) expect(text.trim()).not.toBe("");
  }
  expect([...seen].sort()).toEqual([
    "status.conflict.declinedByYou",
    "status.outcome.approvedByYou",
    "status.outcome.codeExpired",
    "status.outcome.declinedByYou",
  ]);
});

it("treats an opposite answer as a conflict and a repeat as the same result", () => {
  expect(outcomeKey("declinedByYou", "approve")).toBe("status.conflict.declinedByYou");
  expect(outcomeKey("approvedByYou", "reject")).toBe("status.conflict.approvedByYou");
  expect(outcomeKey("approvedByYou", "approve")).toBe("status.outcome.approvedByYou");
  expect(decisionOutcome("reject")).toBe("declinedByYou");
});

it("says an approval on the phone with the PIN was approved on the phone, whatever you ask for", () => {
  expect(outcomeOf({ outcome: "approvedOnPhone" })).toBe("approvedOnPhone");
  expect(isFinal("approvedOnPhone")).toBe(true);
  expect(outcomeKey("approvedOnPhone", "approve")).toBe("status.outcome.approvedOnPhone");
  expect(outcomeKey("approvedOnPhone", "reject")).toBe("status.outcome.approvedOnPhone");
});

it("leaves the request open when only the preview or code is stale", () => {
  expect(isFinal("changed")).toBe(false);
  expect(isFinal("codeExpired")).toBe(false);
  expect(isFinal("cancelled")).toBe(true);
  expect(outcomeOf({ outcome: "codeExpired" })).toBe("codeExpired");
  expect(outcomeOf({ outcome: "nonsense" })).toBeNull();
  expect(outcomeOf(undefined)).toBeNull();
});

it("lists open requests first and counts only those", () => {
  const item = (id: string) => ({ id });
  const processed = { b: { approval: item("b"), outcome: "approvedByYou" as const, decision: "approve" as const } };
  const { open, done } = queueOf([item("a"), item("b")], processed);
  expect(open.map((a) => a.id)).toEqual(["a"]);
  expect(done).toHaveLength(1);
  expect(queueSummaryKey(1, 1)).toEqual({ key: "status.queue.one", n: 1 });
  expect(queueSummaryKey(3, 0)).toEqual({ key: "status.queue.many", n: 3 });
  expect(queueSummaryKey(0, 2)?.key).toBe("status.queue.done");
  expect(queueSummaryKey(0, 0)).toBeNull();
});
