// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { lastOccurrence, validTimeZone, zonedTimeToUtc } from "../src/lib/zoned-time.js";

const CPH = "Europe/Copenhagen";
const sunday18 = { day: 0, hour: 18, minute: 0, timeZone: CPH };
const iso = (d: Date) => d.toISOString();
const hours = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 3_600_000;

describe("weekly schedule in a time zone", () => {
  it("finds Sunday 18:00 local time in winter", () => {
    const o = lastOccurrence(new Date("2026-11-22T17:30:00Z"), sunday18);
    expect(iso(o.at)).toBe("2026-11-22T17:00:00.000Z");
    expect(o.date).toBe("2026-11-22");
    expect(iso(o.previous)).toBe("2026-11-15T17:00:00.000Z");
  });

  it("is not due a minute early, and the previous Sunday is the last one", () => {
    const o = lastOccurrence(new Date("2026-11-22T16:59:00Z"), sunday18);
    expect(o.date).toBe("2026-11-15");
    expect(iso(o.at)).toBe("2026-11-15T17:00:00.000Z");
  });

  it("keeps 18:00 local across the spring change: the week is 167 hours", () => {
    // Clocks go forward on Sunday 2026-03-29 at 01:00 UTC.
    const o = lastOccurrence(new Date("2026-03-29T16:00:00Z"), sunday18);
    expect(iso(o.at)).toBe("2026-03-29T16:00:00.000Z");
    expect(iso(o.previous)).toBe("2026-03-22T17:00:00.000Z");
    expect(hours(o.at, o.previous)).toBe(167);
    expect(iso(lastOccurrence(new Date("2026-03-29T15:59:00Z"), sunday18).at)).toBe("2026-03-22T17:00:00.000Z");
  });

  it("keeps 18:00 local across the autumn change: the week is 169 hours", () => {
    // Clocks go back on Sunday 2026-10-25 at 01:00 UTC.
    const o = lastOccurrence(new Date("2026-10-25T17:00:00Z"), sunday18);
    expect(iso(o.at)).toBe("2026-10-25T17:00:00.000Z");
    expect(iso(o.previous)).toBe("2026-10-18T16:00:00.000Z");
    expect(hours(o.at, o.previous)).toBe(169);
  });

  it("moves a time that does not exist forward and uses the first of a time that happens twice", () => {
    expect(iso(zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, CPH))).toBe("2026-03-29T01:30:00.000Z");
    expect(iso(zonedTimeToUtc({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, CPH))).toBe("2026-10-25T00:30:00.000Z");
  });

  it("follows the household's own zone, including one ahead of UTC by 13 hours", () => {
    const ny = lastOccurrence(new Date("2026-11-22T23:00:00Z"), { ...sunday18, timeZone: "America/New_York" });
    expect(iso(ny.at)).toBe("2026-11-22T23:00:00.000Z");
    const nz = lastOccurrence(new Date("2026-11-22T05:00:00Z"), { ...sunday18, timeZone: "Pacific/Auckland" });
    expect(iso(nz.at)).toBe("2026-11-22T05:00:00.000Z");
    expect(nz.date).toBe("2026-11-22");
  });

  it("supports any chosen day and a time with minutes", () => {
    const o = lastOccurrence(new Date("2026-11-18T12:00:00Z"), { day: 3, hour: 7, minute: 45, timeZone: CPH });
    expect(iso(o.at)).toBe("2026-11-18T06:45:00.000Z");
  });

  it("knows valid time zone names", () => {
    expect(validTimeZone(CPH)).toBe(true);
    expect(validTimeZone("Mars/Base")).toBe(false);
  });
});
