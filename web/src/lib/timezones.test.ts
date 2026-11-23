// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { timeZoneOptions, utcOffset, zoneLabel } from "./timezones";

const winter = new Date("2026-01-15T12:00:00Z");
const summer = new Date("2026-07-15T12:00:00Z");
const all = ["America/Argentina/Buenos_Aires", "Asia/Kolkata", "Europe/Berlin", "Europe/Copenhagen", "Europe/London",
  "Europe/Oslo", "Europe/Stockholm", "Europe/Vienna", "Europe/Zurich", "Pacific/Auckland"];

it("writes the offset at the given moment, with daylight saving time", () => {
  expect(utcOffset("Europe/Copenhagen", winter)).toBe("UTC+1");
  expect(utcOffset("Europe/Copenhagen", summer)).toBe("UTC+2");
  expect(utcOffset("Asia/Kolkata", winter)).toBe("UTC+5:30");
  expect(utcOffset("Europe/London", winter)).toBe("UTC");
});

it("names a zone by its city, in the parent's language for the common ones", () => {
  expect(zoneLabel("Europe/Copenhagen", "da", winter)).toBe("København (UTC+1)");
  expect(zoneLabel("Europe/Vienna", "de", summer)).toBe("Wien (UTC+2)");
  expect(zoneLabel("America/Argentina/Buenos_Aires", "en", winter)).toBe("Buenos Aires (UTC-3)");
  expect(zoneLabel("UTC", "en", winter)).toBe("UTC");
});

it("puts the browser's zone first, then the common zones, then the rest by city", () => {
  const { common, rest } = timeZoneOptions({ browserZone: "Pacific/Auckland", selected: "Europe/Oslo", locale: "en", at: winter, all });
  expect(common.map((o) => o.zone)).toEqual([
    "Pacific/Auckland", "Europe/Copenhagen", "Europe/Stockholm", "Europe/Oslo", "Europe/Berlin", "Europe/Vienna", "Europe/Zurich", "Europe/London",
  ]);
  expect(rest.map((o) => o.label)).toEqual(["Buenos Aires (UTC-3)", "Kolkata (UTC+5:30)", "UTC"]);
});

it("lists the browser's zone once when it is a common zone", () => {
  const { common, rest } = timeZoneOptions({ browserZone: "Europe/Oslo", selected: "Europe/Oslo", locale: "nb", at: winter, all });
  expect(common[0]).toEqual({ zone: "Europe/Oslo", label: "Oslo (UTC+1)" });
  expect(common.filter((o) => o.zone === "Europe/Oslo")).toHaveLength(1);
  expect(rest.some((o) => o.zone === "Europe/Oslo")).toBe(false);
});

it("keeps a saved zone this browser does not know", () => {
  const { rest } = timeZoneOptions({ browserZone: undefined, selected: "America/Nuuk", locale: "da", at: winter, all });
  expect(rest.map((o) => o.zone)).toContain("America/Nuuk");
});
