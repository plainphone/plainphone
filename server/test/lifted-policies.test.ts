// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "vitest";
import { applyOverdueLifted, overdueLifted } from "../src/lib/lifted-policies.js";

const NOW = new Date("2026-11-16T12:00:00Z");
const NAME = "restriction no_modify_accounts";
const at = (ms: number) => ({ name: NAME, until: new Date(NOW.getTime() + ms).toISOString() });
const report = (over: object = {}) => ({ lockIntact: true, failedPolicies: [] as string[], ...over });

test("an entry within its deadline changes nothing", () => {
  const r = report({ liftedPolicies: [at(60_000)] });
  expect(applyOverdueLifted(r, NOW)).toEqual({ lockIntact: true, failedPolicies: [] });
});

test("an entry less than two minutes past its deadline is still in grace", () => {
  expect(overdueLifted([at(-119_000)], NOW)).toEqual([]);
  expect(overdueLifted([at(-121_000)], NOW)).toEqual([at(-121_000)]);
});

test("an overdue entry fails the lock and is listed once", () => {
  const entry = at(-5 * 60_000);
  expect(applyOverdueLifted(report({ liftedPolicies: [entry] }), NOW)).toEqual({ lockIntact: false, failedPolicies: [NAME] });
  expect(applyOverdueLifted(report({ liftedPolicies: [entry], failedPolicies: ["dialer role", NAME] }), NOW).failedPolicies)
    .toEqual(["dialer role", NAME]);
});

test("never makes a report less strict and keeps the cap of 50", () => {
  expect(applyOverdueLifted(report({ lockIntact: false, liftedPolicies: [at(60_000)] }), NOW).lockIntact).toBe(false);
  const full = Array.from({ length: 50 }, (_, i) => `step ${i}`);
  const r = applyOverdueLifted(report({ liftedPolicies: [at(-5 * 60_000)], failedPolicies: full }), NOW);
  expect(r.failedPolicies).toEqual(full);
  expect(r.lockIntact).toBe(false);
});

test("a report without lifted steps is returned as is", () => {
  expect(applyOverdueLifted(report(), NOW)).toEqual({ lockIntact: true, failedPolicies: [] });
});
