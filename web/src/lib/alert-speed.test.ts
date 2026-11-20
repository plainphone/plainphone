// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { alertSeconds, type LatencyRow, type LatencyStats } from "./alert-speed";

const row = (path: LatencyRow["path"], p50Ms: number, samples: number, extra: Partial<LatencyRow> = {}): LatencyRow =>
  ({ path, provider: "web", kind: null, samples, p50Ms, p95Ms: p50Ms * 2, ...extra });
const stats = (paths: LatencyRow[], enabled = true): LatencyStats => ({ enabled, windowDays: 7, minSamples: 5, paths });

describe("alertSeconds", () => {
  it("adds the SOS upload to the confirmed delivery, weighted by samples, rounded up", () => {
    expect(alertSeconds(stats([
      row("phone-server", 600, 10, { provider: null, kind: "sos" }),
      row("phone-server", 9_000, 10, { provider: null, kind: "quick" }),
      row("parent-device", 1_000, 30, { provider: "fcm" }),
      row("parent-device", 3_000, 10, { provider: "web" }),
    ]))).toBe(3); // 0.6 s + 1.5 s
  });

  it("says nothing without confirmed deliveries or when the server switched the stats off", () => {
    expect(alertSeconds(stats([row("server-parent", 200, 50)]))).toBeNull();
    expect(alertSeconds(stats([row("parent-device", 900, 50)], false))).toBeNull();
    expect(alertSeconds(null)).toBeNull();
  });

  it("never shows less than one second", () => {
    expect(alertSeconds(stats([row("parent-device", 40, 8)]))).toBe(1);
  });
});
