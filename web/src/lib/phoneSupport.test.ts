// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { diagnostics, releaseState } from "./phoneSupport";

const pending = { releaseRequestedAt: "2026-11-18T19:26:00Z" };

it("warns immediately for a version that ignores remote release", () => {
  expect(releaseState({ ...pending, status: { appVersion: "0.1.3" } })).toBe("old");
  expect(releaseState({ ...pending, status: { appVersion: "0.1.7" } })).toBe("old");
});

it("warns after three rule fetches without an acknowledgement", () => {
  expect(releaseState({ ...pending, status: { appVersion: "0.1.8" }, releaseSyncCount: 2 })).toBe("requested");
  expect(releaseState({ ...pending, status: { appVersion: "0.1.10" }, releaseSyncCount: 3 })).toBe("stalled");
  expect(releaseState({ ...pending, releaseSyncCount: 3 })).toBe("stalled");
  expect(releaseState({ ...pending, releaseSyncCount: 3, releaseWarningsEnabled: false })).toBe("requested");
  expect(releaseState({ releaseSyncCount: 3 })).toBeNull();
});

it("copies only allowlisted technical fields", () => {
  const phone = {
    name: "Private", mode: "strong", androidVersion: "10",
    status: { appVersion: "0.1.3", failedPolicies: ["private DNS", "extra users and profiles: Private", "Private"] },
  } as const;
  expect(JSON.parse(diagnostics(phone))).toEqual({
    appVersion: "0.1.3", androidVersion: "10", mode: "strong",
    failedPolicies: ["private DNS", "extra users and profiles", "other"],
  });
});
