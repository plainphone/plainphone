// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { familyState } from "@plainphone/shared/sos-options";

const at = "2026-11-19T15:00:00Z";

it("says a child message without push went as SMS", () => {
  expect(familyState({ id: "a", from: "child", kind: "quick", text: "Hi", sentAt: at, delivered: 0 }).key).toBe("inbox.sms");
});

it("never says a location snapshot went as SMS, since snapshots have no SMS fallback", () => {
  expect(familyState({ id: "s", from: "child", kind: "snapshot", text: "Location", sentAt: at, delivered: 0 }).key).toBe("inbox.sent");
  expect(familyState({ id: "s", from: "child", kind: "snapshot", text: "Location", sentAt: at, delivered: 2 }).key).toBe("inbox.delivered");
});
