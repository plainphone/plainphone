// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { makeT } from "../i18n/translate";
import { type PhoneWeek, phoneWeekLines, summaryDayName, summaryRange, summaryTime } from "./weekly-summary";

const week: PhoneWeek = {
  phoneId: "p",
  name: "Phone A",
  usage: { days: [{ day: "2026-11-16", minutes: 135 }], averageMinutes: 135, topApps: [{ packageName: "a", label: "Video app", minutes: 75 }] },
  requests: { asked: 3, approved: 2, rejected: 1, byKind: { app: 3 } },
  changes: { total: 3, byCategory: { time: 2, apps: 1 } },
  events: { protection: 1, offline: 2, checkin: 0 },
};

const quiet: PhoneWeek = {
  phoneId: "q",
  name: "Phone B",
  usage: null,
  requests: { asked: 0, approved: 0, rejected: 0, byKind: {} },
  changes: { total: 0, byCategory: {} },
  events: { protection: 0, offline: 0, checkin: 0 },
};

it("states the week's numbers", () => {
  expect(phoneWeekLines(week, makeT("en"))).toEqual([
    "Screen time per day: 2 h 15 min on average",
    "Most used: Video app (1 h 15 min)",
    "Requests: 3 asked, 3 answered",
    "Rule changes: 3 (time limits 2, apps 1)",
    "Protection removed: 1",
    "Out of contact: 2",
  ]);
});

it("keeps a quiet week short, and says why there is no screen time", () => {
  expect(phoneWeekLines(quiet, makeT("en"))).toEqual([
    "No screen time reported. It is reported for phones that have a time limit.",
    "No requests",
    "No rule changes",
    "Protection stayed on",
  ]);
});

it("reads in every language without blanks", () => {
  for (const locale of ["en", "da", "sv", "nb", "de"] as const) {
    for (const p of [week, quiet]) {
      for (const line of phoneWeekLines(p, makeT(locale))) expect(line).not.toMatch(/\{|undefined|NaN/);
    }
  }
  expect(phoneWeekLines(week, makeT("da"))[0]).toBe("Skærmtid pr. dag: 2 t. 15 min. i gennemsnit");
});

it("names the day and time and the seven days a week covers", () => {
  expect(summaryDayName(0, "en")).toBe("Sunday");
  expect(summaryDayName(1, "da")).toBe("mandag");
  expect(summaryTime(7, 5)).toBe("07:05");
  expect(summaryRange("2026-11-22", "en", makeT("en"))).toBe("16 Nov to 22 Nov");
  // Across a month boundary.
  expect(summaryRange("2026-12-02", "en", makeT("en"))).toBe("26 Nov to 2 Dec");
});
