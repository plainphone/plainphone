// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { WeeklySummarySettings } from "../components/WeeklySummarySettings";
import { I18nProvider } from "../i18n/I18n";
import { SummaryPage } from "./Summary";

const state = vi.hoisted(() => ({ response: {} as unknown }));
vi.mock("../components/ui", async (original) => ({
  ...(await original<typeof import("../components/ui")>()),
  useLoad: () => ({ data: state.response, error: null, loading: false, reload: () => Promise.resolve(), setData: () => undefined }),
}));
vi.mock("../lib/session", () => ({
  useMe: () => ({ households: [{ id: "h1", name: "Home", role: "owner" }], user: { id: "u1", email: "parent@example.org", locale: "en" } }),
  useActiveHousehold: () => ({ id: "h1", name: "Home", role: "owner" }),
  chooseHousehold: () => undefined,
}));

afterEach(() => vi.unstubAllGlobals());

const settings = { enabled: true, byMail: true, byPush: true, actNowOnly: true, day: 0, hour: 18, minute: 0, timeZone: "Europe/Copenhagen", mailEnabled: true };
const week = {
  phoneId: "p", name: "Phone A",
  usage: { days: [{ day: "2026-11-16", minutes: 135 }], averageMinutes: 135, topApps: [{ packageName: "a", label: "Video app", minutes: 75 }] },
  requests: { asked: 3, approved: 2, rejected: 1, byKind: {} },
  changes: { total: 3, byCategory: { time: 2, apps: 1 } },
  events: { protection: 0, offline: 0, checkin: 0 },
};

function render(ui: React.ReactNode) {
  vi.stubGlobal("localStorage", { getItem: () => "en" });
  vi.stubGlobal("navigator", { languages: ["en"] });
  return renderToStaticMarkup(<I18nProvider><MemoryRouter>{ui}</MemoryRouter></I18nProvider>);
}

it("lists the weeks with each phone's numbers", () => {
  state.response = {
    settings,
    summaries: [{ id: "w1", weekEnd: "2026-11-22", periodStart: "2026-11-15T17:00:00Z", periodEnd: "2026-11-22T17:00:00Z", data: { version: 1, phones: [week] } }],
  };
  const html = render(<SummaryPage />);
  expect(html).toContain("Weekly summary");
  expect(html).toContain("16 Nov to 22 Nov");
  expect(html).toContain("Phone A");
  expect(html).toContain("Screen time per day: 2 h 15 min on average");
  expect(html).toContain("Most used: Video app (1 h 15 min)");
  expect(html).toContain("Rule changes: 3 (time limits 2, apps 1)");
});

it("says on which date the first summary comes, when it waits for a full week", () => {
  state.response = { settings, summaries: [], firstSummaryOn: "2026-11-29" };
  const html = render(<SummaryPage />);
  expect(html).toContain("Your first summary comes on Sunday 29 Nov.");
  expect(html).not.toContain("arrives on");
});

it("falls back to the weekly time when no date is known", () => {
  state.response = { settings, summaries: [], firstSummaryOn: null };
  expect(render(<SummaryPage />)).toContain("Your first summary arrives on Sunday at 18:00.");
});

it("shows the settings with the defaults on, and hides the choices when the summary is off", () => {
  state.response = settings;
  const on = render(<WeeklySummarySettings />);
  for (const label of ["Send a weekly summary", "By email", "By notification", "Only alert me when I must act"]) expect(on).toContain(label);
  expect(on.match(/type="checkbox"[^>]*checked/g)).toHaveLength(4);
  expect(on).toContain("Sunday");
  expect(on).toContain('value="18:00"');
  expect(on).toContain("Time zone: Europe/Copenhagen");

  state.response = { ...settings, enabled: false };
  const off = render(<WeeklySummarySettings />);
  expect(off).toContain("Send a weekly summary");
  expect(off).not.toContain("By email");
  expect(off).not.toContain("Only alert me when I must act");
});

it("disables the mail choice when the server cannot send mail", () => {
  state.response = { ...settings, mailEnabled: false, byMail: false };
  const html = render(<WeeklySummarySettings />);
  expect(html).toContain("This server cannot send email.");
  expect(html).toMatch(/<input[^>]*disabled[^>]*aria-labelledby="summary-byMail-label"|<input[^>]*aria-labelledby="summary-byMail-label"[^>]*disabled/);
});
