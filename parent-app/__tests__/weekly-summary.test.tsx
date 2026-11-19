// SPDX-License-Identifier: Apache-2.0
//
// The weekly summary in the parent app: the screen, the household settings and the push route.
import * as SecureStore from "expo-secure-store";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { routeForPush } from "../src/lib/notifications";
import { fakeApi, ME } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";
const HID = ME.households[0]!.id;

const settings = {
  enabled: true, byMail: true, byPush: true, actNowOnly: true,
  day: 0, hour: 18, minute: 0, timeZone: "Europe/Copenhagen", mailEnabled: true,
};

const phoneWeek = (over: Record<string, unknown> = {}) => ({
  phoneId: "11111111-1111-4111-8111-111111111111",
  name: "Phone A",
  usage: { days: [{ day: "2026-11-16", minutes: 135 }], averageMinutes: 135, topApps: [{ packageName: "a", label: "Video app", minutes: 75 }] },
  requests: { asked: 3, approved: 2, rejected: 1, byKind: { app: 3 } },
  changes: { total: 3, byCategory: { time: 2, apps: 1 } },
  events: { protection: 0, offline: 2, checkin: 0 },
  ...over,
});

beforeEach(async () => {
  await SecureStore.setItemAsync("pp.session", "pp_s_saved");
});

describe("weekly summary screen", () => {
  it("shows the latest week with its numbers, newest first, and opens the week from a link first", async () => {
    fakeApi({
      "GET /me": { body: ME },
      [`GET /households/${HID}/summary-settings`]: { body: settings },
      [`GET /households/${HID}/summaries`]: {
        body: {
          summaries: [
            { id: "new", weekEnd: "2026-11-22", periodStart: "2026-11-15T17:00:00Z", periodEnd: "2026-11-22T17:00:00Z", data: { version: 1, phones: [phoneWeek()] } },
            { id: "old", weekEnd: "2026-11-15", periodStart: "2026-11-08T17:00:00Z", periodEnd: "2026-11-15T17:00:00Z", data: { version: 1, phones: [phoneWeek({ name: "Phone B", usage: null })] } },
          ],
        },
      },
    });
    await renderRouter(routes, { initialUrl: "/summary?week=old" });
    expect(await screen.findByText("Weekly summary")).toBeTruthy();
    // The week from the link first, then the rest.
    const cards = await screen.findAllByTestId(/^summary-(new|old)$/);
    expect(cards.map((c) => c.props.testID)).toEqual(["summary-old", "summary-new"]);
    expect(screen.getByText("Screen time per day: 2 h 15 min on average")).toBeTruthy();
    expect(screen.getAllByText("Rule changes: 3 (time limits 2, apps 1)")).toHaveLength(2);
    expect(screen.getAllByText("Requests: 3 asked, 3 answered")).toHaveLength(2);
    expect(screen.getAllByText("Out of contact: 2")).toHaveLength(2);
    expect(screen.getByText("No screen time reported. It is reported for phones that have a time limit.")).toBeTruthy();
  });

  it("says when the first summary arrives", async () => {
    fakeApi({
      "GET /me": { body: ME },
      [`GET /households/${HID}/summary-settings`]: { body: settings },
      [`GET /households/${HID}/summaries`]: { body: { summaries: [] } },
    });
    await renderRouter(routes, { initialUrl: "/summary" });
    expect(await screen.findByText("Your first summary arrives on Sunday at 18:00.")).toBeTruthy();
  });
});

describe("weekly summary settings", () => {
  it("shows the defaults and sends each change to the server", async () => {
    const api = fakeApi({
      "GET /me": { body: ME },
      "GET /health": { body: { ok: true, mail: "smtp" } },
      [`GET /households/${HID}/summary-settings`]: { body: settings },
      [`PATCH /households/${HID}/summary-settings`]: ({ body }) => ({ body: { ...settings, ...(body as object) } }),
    });
    await renderRouter(routes, { initialUrl: "/settings" });
    const actNow = await screen.findByTestId("summary-act-now");
    expect(actNow.props.accessibilityState.checked).toBe(true);
    await fireEvent.press(actNow);
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ actNowOnly: false }));
    await waitFor(() => expect(screen.getByTestId("summary-act-now").props.accessibilityState.checked).toBe(false));
    await fireEvent.press(screen.getByTestId("summary-mail"));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ byMail: false }));
    await fireEvent.press(screen.getByTestId("summary-enabled"));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ enabled: false }));
    // Off: the delivery choices disappear.
    await waitFor(() => expect(screen.queryByTestId("summary-act-now")).toBeNull());
  });

  it("cannot switch mail on when the server cannot send it", async () => {
    fakeApi({
      "GET /me": { body: ME },
      "GET /health": { body: { ok: true, mail: "smtp" } },
      [`GET /households/${HID}/summary-settings`]: { body: { ...settings, mailEnabled: false, byMail: false } },
    });
    await renderRouter(routes, { initialUrl: "/settings" });
    const mail = await screen.findByTestId("summary-mail");
    expect(mail.props.accessibilityState.disabled).toBe(true);
  });
});

describe("push route", () => {
  it("opens the summary from a summary notification", () => {
    expect(routeForPush({ type: "summary", url: "/summary?week=abc" })).toBe("/summary");
    expect(routeForPush({ url: "/summary?week=abc" })).toBe("/summary");
    expect(routeForPush({ url: "/summary" })).toBe("/summary");
    expect(routeForPush({ url: "/summaryx" })).toBe("/");
  });
});
