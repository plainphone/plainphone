// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { liftedNotice } from "./liftedPolicies";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const NAME = "restriction no_modify_accounts";
const at = (ms: number) => ({ name: NAME, until: new Date(NOW + ms).toISOString() });
const status = (liftedPolicies: { name: string; until: string }[], failedPolicies: string[] = []) => ({ failedPolicies, liftedPolicies });

it("is calm while the window is open", () => {
  expect(liftedNotice(status([at(60_000)]), NOW)).toEqual({ until: at(60_000).until, overdue: false });
});

it("waits out the two-minute grace after the deadline", () => {
  expect(liftedNotice(status([at(-60_000)]), NOW)).toBeNull();
  expect(liftedNotice(status([at(-121_000)]), NOW)).toEqual({ until: at(-121_000).until, overdue: true });
});

it("does not call a phone silent that reported after the deadline", () => {
  const late = { ...status([at(-600_000)]), reportedAt: new Date(NOW - 570_000).toISOString() };
  expect(liftedNotice(late, NOW)).toBeNull();
  const before = { ...status([at(-600_000)]), reportedAt: new Date(NOW - 700_000).toISOString() };
  expect(liftedNotice(before, NOW)).toEqual({ until: at(-600_000).until, overdue: true });
});

it("leaves a step the server already lists as failed to the lock warning", () => {
  expect(liftedNotice(status([at(-600_000)], [NAME]), NOW)).toBeNull();
});

it("shows nothing without lifted steps or a status", () => {
  expect(liftedNotice({ failedPolicies: [] }, NOW)).toBeNull();
  expect(liftedNotice(null, NOW)).toBeNull();
});
