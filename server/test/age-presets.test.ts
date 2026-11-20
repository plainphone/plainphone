// SPDX-License-Identifier: Apache-2.0
// The preset table, the suggestions and the review date arithmetic. Pure: every date is fixed.
import { describe, expect, it } from "vitest";
import { AGE_PRESETS, MAX_SUGGESTIONS, reviewDueAfter, type RulesSnapshot, suggestNext } from "../src/lib/age-presets.js";

const CPH = "Europe/Copenhagen";
const iso = (d: Date) => d.toISOString();

describe("reviewDueAfter", () => {
  it("adds calendar months at 09:00 on the phone's clock", () => {
    expect(iso(reviewDueAfter(new Date("2026-11-16T12:00:00Z"), 3, CPH))).toBe("2027-02-16T08:00:00.000Z");
  });

  it("clamps to the last day of a shorter month", () => {
    expect(iso(reviewDueAfter(new Date("2026-01-31T10:00:00Z"), 1, CPH))).toBe("2026-02-28T08:00:00.000Z");
    expect(iso(reviewDueAfter(new Date("2026-11-30T10:00:00Z"), 3, CPH))).toBe("2027-02-28T08:00:00.000Z");
    expect(iso(reviewDueAfter(new Date("2026-12-31T10:00:00Z"), 2, CPH))).toBe("2027-02-28T08:00:00.000Z");
  });

  it("knows leap years", () => {
    expect(iso(reviewDueAfter(new Date("2028-01-31T10:00:00Z"), 1, CPH))).toBe("2028-02-29T08:00:00.000Z");
  });

  it("goes by the local date, not the UTC date, near midnight", () => {
    // 23:30 UTC on 30 January is 00:30 on 31 January in Copenhagen.
    expect(iso(reviewDueAfter(new Date("2026-01-30T23:30:00Z"), 1, CPH))).toBe("2026-02-28T08:00:00.000Z");
  });

  it("keeps 09:00 on the wall clock across a daylight-saving change", () => {
    // Clocks went forward on 29 March 2026: 09:00 is 08:00 UTC before and 07:00 UTC after.
    expect(iso(reviewDueAfter(new Date("2026-02-28T12:00:00Z"), 1, CPH))).toBe("2026-03-28T08:00:00.000Z");
    expect(iso(reviewDueAfter(new Date("2026-02-28T12:00:00Z"), 2, CPH))).toBe("2026-04-28T07:00:00.000Z");
    // And back: clocks went back on 25 October 2026.
    expect(iso(reviewDueAfter(new Date("2026-07-25T12:00:00Z"), 3, CPH))).toBe("2026-10-25T08:00:00.000Z");
    expect(iso(reviewDueAfter(new Date("2026-07-25T12:00:00Z"), 6, CPH))).toBe("2027-01-25T08:00:00.000Z");
  });

  it("works in a zone without daylight saving and a year ahead", () => {
    expect(iso(reviewDueAfter(new Date("2026-11-16T12:00:00Z"), 12, "UTC"))).toBe("2027-11-16T09:00:00.000Z");
  });
});

describe("preset table", () => {
  it("lets freedom grow with age and never blocks more for an older child", () => {
    for (let i = 1; i < AGE_PRESETS.length; i++) {
      const a = AGE_PRESETS[i - 1]!;
      const b = AGE_PRESETS[i]!;
      expect(b.dailyMinutes.weekday).toBeGreaterThan(a.dailyMinutes.weekday);
      expect(b.dailyMinutes.weekend).toBeGreaterThanOrEqual(b.dailyMinutes.weekday);
      expect(b.bedtime.startMinute).toBeGreaterThan(a.bedtime.startMinute);
      for (const c of b.blockedCategories) expect(a.blockedCategories).toContain(c);
    }
  });
});

describe("suggestNext", () => {
  const rules = (over: Partial<RulesSnapshot> = {}): RulesSnapshot => ({
    weekdayMinutes: 60, bedtimeStart: 19 * 60 + 30, hasSchool: true,
    blockedCategories: ["social", "adult", "gambling", "dating", "video"], ...over,
  });

  it("derives what to open from the current rules and the next preset", () => {
    const s = suggestNext(rules(), "8-9");
    expect(s).toEqual([
      { kind: "time", from: 60, to: 90 },
      { kind: "bedtime", from: 19 * 60 + 30, to: 20 * 60 + 30 },
      { kind: "category", category: "video" },
    ]);
    expect(s.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
  });

  it("does not suggest what is already open, and never something tighter", () => {
    const s = suggestNext(rules({ weekdayMinutes: 200, bedtimeStart: 23 * 60, blockedCategories: ["adult"] }), "8-9");
    expect(s).toEqual([{ kind: "talk" }]);
  });

  it("suggests taking school time off when the next preset has none", () => {
    const s = suggestNext(rules({ weekdayMinutes: 150, bedtimeStart: 22 * 60, blockedCategories: ["adult", "gambling"] }), "12-13");
    expect(s).toEqual([{ kind: "school" }]);
  });

  it("only talks at the last preset", () => {
    expect(suggestNext(rules(), "14plus")).toEqual([{ kind: "talk" }]);
  });

  it("uses the first looser preset when the phone has none", () => {
    expect(suggestNext(rules({ weekdayMinutes: 100 }), null)[0]).toEqual({ kind: "time", from: 100, to: 120 });
    expect(suggestNext(rules({ weekdayMinutes: null }), null)).toEqual([{ kind: "talk" }]);
  });
});
