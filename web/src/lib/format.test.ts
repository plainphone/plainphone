// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { makeT } from "@plainphone/i18n/translate";
import type { Op } from "./api";
import {
  crossesMidnight,
  formatClock,
  formatDuration,
  formatMoney,
  hhmmToMinutes,
  minutesToHHMM,
  normaliseCode,
  osmUrl,
  weekdayName,
} from "@plainphone/shared/format";
import { describeOp, formatDays } from "@plainphone/shared/ops";

const words = { hm: "{h} h {m} min", h: "{h} h", m: "{m} min", lessThanMinute: "less than a minute" };

describe("times", () => {
  it("converts between minutes and HH:MM", () => {
    expect(minutesToHHMM(0)).toBe("00:00");
    expect(minutesToHHMM(8 * 60 + 5)).toBe("08:05");
    expect(minutesToHHMM(1439)).toBe("23:59");
    expect(hhmmToMinutes("21:30")).toBe(1290);
    expect(hhmmToMinutes("24:00")).toBeNull();
    expect(hhmmToMinutes("nonsense")).toBeNull();
  });

  it("formats clock times per locale", () => {
    expect(formatClock(8 * 60, "en")).toBe("08:00");
    expect(formatClock(8 * 60, "da")).toBe("08.00");
  });

  it("knows when a window crosses midnight", () => {
    expect(crossesMidnight(21 * 60, 7 * 60)).toBe(true);
    expect(crossesMidnight(8 * 60, 15 * 60)).toBe(false);
  });

  it("names ISO weekdays from Monday", () => {
    expect(weekdayName(1, "en", "long")).toBe("Monday");
    expect(weekdayName(7, "da", "long")).toBe("søndag");
  });
});

describe("formatDuration", () => {
  it("counts down in hours and minutes, rounding up", () => {
    expect(formatDuration(3600_000 + 5 * 60_000, words)).toBe("1 h 5 min");
    expect(formatDuration(3600_000 + 4 * 60_000 + 1, words)).toBe("1 h 5 min");
    expect(formatDuration(2 * 3600_000, words)).toBe("2 h");
    expect(formatDuration(23 * 3600_000 + 5 * 60_000, words)).toBe("23 h");
    expect(formatDuration(24 * 3600_000 - 1000, words)).toBe("24 h");
    expect(formatDuration(59_000, words)).toBe("1 min");
    expect(formatDuration(0, words)).toBe("less than a minute");
    expect(formatDuration(72 * 3600_000, words)).toBe("72 h");
  });
});

describe("other formats", () => {
  it("formats money in Danish kroner", () => {
    expect(formatMoney(50_000, "DKK", "da").replace(/\s/g, " ")).toBe("500 kr.");
  });

  it("normalises pairing codes like the server", () => {
    expect(normaliseCode("k7mp 4qxr")).toBe("K7MP-4QXR");
    expect(normaliseCode("K7M")).toBe("K7M");
    expect(normaliseCode("k7mp-4qxr-extra")).toBe("K7MP-4QXR");
  });

  it("links to OpenStreetMap", () => {
    expect(osmUrl(55.6761, 12.5683)).toBe("https://www.openstreetmap.org/?mlat=55.67610&mlon=12.56830#map=17/55.67610/12.56830");
  });
});

describe("describeOp", () => {
  const en = makeT("en");
  const da = makeT("da");
  const label = (p: string) => (p === "com.instagram.android" ? "Instagram" : p);

  it("describes changes in plain words", () => {
    const show: Op = { type: "app.set", packageName: "com.instagram.android", allowed: true };
    expect(describeOp(show, en, "en", label)).toBe("Show Instagram");
    expect(describeOp(show, da, "da", label)).toBe("Vis Instagram");
    expect(describeOp({ type: "dns.allowDomain", domain: "example.com", present: true }, en, "en")).toBe("Allow example.com");
    expect(describeOp({ type: "dns.category", category: "games", blocked: false }, en, "en")).toBe("Turn off the filter for games");
    expect(describeOp({ type: "dns.category", category: "social", blocked: false }, da, "da")).toBe("Slå filteret fra for sociale medier");
  });

  it("describes schedules with days and times", () => {
    const op: Op = {
      type: "schedule.update",
      scheduleId: "x",
      schedule: { kind: "bedtime", days: [1, 2, 3, 4, 5], startMinute: 21 * 60, endMinute: 7 * 60, allowedPackages: [] },
    };
    expect(describeOp(op, en, "en")).toBe("Change bedtime to Monday to Friday, 21:00 to 07:00");
    expect(describeOp(op, da, "da")).toBe("Ændr sengetid til mandag til fredag, 21.00 til 07.00");
    expect(formatDays([6, 7], "en", en)).toBe("Saturday and Sunday");
    expect(formatDays([1, 3], "en", en)).toBe("Mon and Wed");
  });
});
