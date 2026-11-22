// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "@plainphone/i18n/translate";
import { formatDateTime } from "../lib/format";
import { describeOp } from "../lib/ops";
import { EmergencyBlock } from "./EmergencyOpenings";

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => "en" });
  vi.stubGlobal("navigator", { languages: ["en"] });
});
afterEach(() => vi.unstubAllGlobals());

const render = (emergency: Parameters<typeof EmergencyBlock>[0]["emergency"]) =>
  renderToStaticMarkup(<I18nProvider><EmergencyBlock emergency={emergency} /></I18nProvider>);

it("shows the setting, this month's use and the latest openings under a person", () => {
  const html = render({
    enabled: true,
    allowance: 3,
    minutes: 15,
    used: { month: "2026-11", count: 1 },
    openings: [{ id: "o1", packageName: "com.example.maps", appLabel: "Maps", openedAt: "2026-11-19T09:30:00Z", minutes: 15 }],
  });
  expect(html).toContain("Emergency openings: on, 3 a month");
  expect(html).toContain("1 of 3 used this month");
  expect(html).toContain(`Maps, ${formatDateTime("2026-11-19T09:30:00Z", "en")}`);
});

it("says off, and lists nothing when there are no openings", () => {
  const html = render({ enabled: false, allowance: 3, minutes: 15, used: { month: "2026-11", count: 0 }, openings: [] });
  expect(html).toContain("Emergency openings: off");
  expect(html).not.toContain("<li");
});

it("renders nothing when an older server sends no emergency block", () => {
  expect(render(undefined)).toBe("");
});

it("describes the pending change in all five languages", () => {
  const on = { type: "emergency.set", enabled: true, allowance: 3 } as const;
  const off = { type: "emergency.set", enabled: false, allowance: 3 } as const;
  expect(describeOp(on, makeT("en"), "en")).toBe("Turn on emergency openings, 3 a month");
  expect(describeOp(off, makeT("en"), "en")).toBe("Turn off emergency openings");
  expect(describeOp(on, makeT("da"), "da")).toBe("Slå nødåbninger til, 3 om måneden");
  for (const l of ["sv", "nb", "de"] as const) {
    expect(describeOp(on, makeT(l), l)).toContain("3");
    expect(describeOp(off, makeT(l), l)).not.toBe(describeOp(on, makeT(l), l));
  }
});
