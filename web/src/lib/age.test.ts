// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { makeT } from "@plainphone/i18n/translate";
import {
  AGREEMENT_LINE_MAX,
  type AgePreset,
  clockText,
  durationText,
  linesProblem,
  parseLines,
  presetLines,
  suggestionText,
} from "./age";

const preset: AgePreset = {
  id: "10-11",
  dailyMinutes: { weekday: 90, weekend: 120 },
  bedtime: { startMinute: 20 * 60 + 30, endMinute: 7 * 60 },
  school: { startMinute: 8 * 60, endMinute: 14 * 60 + 30 },
  blockedCategories: ["social", "adult"],
};

describe("age words", () => {
  it("writes durations and clock times", () => {
    const t = makeT("en");
    expect(durationText(t, 90)).toBe("1 h 30 min");
    expect(durationText(t, 120)).toBe("2 h");
    expect(durationText(t, 45)).toBe("45 min");
    expect(clockText(7 * 60 + 5)).toBe("07:05");
  });

  it("says what a preset sets, in the parent's language", () => {
    expect(presetLines(makeT("en"), preset)).toEqual([
      "1 h 30 min a day, 2 h at the weekend",
      "Bedtime 20:30 to 07:00",
      "School time 08:00 to 14:30 on weekdays",
      "Web filter: social media, adult content",
    ]);
    expect(presetLines(makeT("da"), { ...preset, school: null, blockedCategories: [] })).toEqual([
      "1 t. 30 min. om dagen, 2 t. i weekenden",
      "Sengetid 20:30 til 07:00",
      "Ingen skoletid",
    ]);
  });

  it("writes each kind of suggestion", () => {
    const t = makeT("en");
    expect(suggestionText(t, { kind: "time", from: 60, to: 90 })).toBe("More time a day: from 1 h to 1 h 30 min.");
    expect(suggestionText(t, { kind: "bedtime", from: 19 * 60 + 30, to: 20 * 60 + 30 })).toBe("Later bedtime: from 19:30 to 20:30.");
    expect(suggestionText(t, { kind: "category", category: "video" })).toBe("Open video in the web filter.");
    expect(suggestionText(t, { kind: "school" })).toContain("school time");
    expect(suggestionText(t, { kind: "talk" })).toContain("Nothing needs to change");
  });
});

describe("agreement lines", () => {
  it("keeps one trimmed line per row and drops empty rows", () => {
    expect(parseLines("  We eat   together \n\n Ask first\n   ")).toEqual(["We eat together", "Ask first"]);
    expect(parseLines("")).toEqual([]);
  });

  it("flags too many or too long lines", () => {
    expect(linesProblem(["a", "b"], 8)).toBeNull();
    expect(linesProblem(Array.from({ length: 9 }, () => "a"), 8)).toBe("tooMany");
    expect(linesProblem(["x".repeat(AGREEMENT_LINE_MAX + 1)], 8)).toBe("tooLong");
    expect(linesProblem(["x".repeat(AGREEMENT_LINE_MAX)], 8)).toBeNull();
  });
});
