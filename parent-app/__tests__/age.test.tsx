// SPDX-License-Identifier: Apache-2.0
//
// Age presets, the review reminder and the family agreement in the parent app: the setup steps, the
// phone's two screens and the "time to review" note on the overview. Dates are fixed in the fake API.
import * as SecureStore from "expo-secure-store";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Linking as NativeLinking } from "react-native";
import { fakeApi, ME, PHONE } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";
const base = `/phones/${PHONE.id}`;
const presets = [
  { id: "8-9", dailyMinutes: { weekday: 60, weekend: 90 }, bedtime: { startMinute: 1170, endMinute: 420 }, school: null, blockedCategories: ["social"] },
  { id: "10-11", dailyMinutes: { weekday: 90, weekend: 120 }, bedtime: { startMinute: 1230, endMinute: 420 }, school: null, blockedCategories: ["adult"] },
];
const review = (over: Record<string, unknown> = {}) => ({
  enabled: true, intervalMonths: 3, dueAt: "2027-02-16T08:00:00.000Z", due: false,
  suggestions: [{ kind: "time", from: 60, to: 90 }, { kind: "category", category: "video" }], ...over,
});
const agreement = (over: Record<string, unknown> = {}) => ({ lines: [], adultLines: [], enabled: true, onHome: false, updatedAt: null, ...over });
const phone = (over: Record<string, unknown> = {}) => ({ ...PHONE, agePreset: null, reviewEnabled: false, reviewDue: false, ...over });

function api(extra: Parameters<typeof fakeApi>[0] = {}, p: Record<string, unknown> = phone()) {
  return fakeApi({
    "GET /me": { body: ME },
    [`GET ${base}`]: { body: p },
    [`GET ${base}/changes`]: { body: { changes: [] } },
    [`GET ${base}/apps`]: { body: { apps: [] } },
    [`GET ${base}/sos`]: { body: { events: [], callbackNumber: null } },
    "GET /age-presets": { body: { presets } },
    ...extra,
  });
}

beforeEach(async () => {
  await SecureStore.setItemAsync("pp.session", "pp_s_saved");
});

describe("setup", () => {
  it("saves the chosen age, the review reminder and the agreement on the new phone", async () => {
    const open = jest.spyOn(NativeLinking, "openURL").mockResolvedValue(undefined);
    try {
      const fake = api({
        "POST /phones/enroll": { status: 201, body: { phone: PHONE } },
        [`POST ${base}/age-preset`]: { body: { agePreset: "10-11", review: review() } },
        [`PUT ${base}/review`]: { body: { agePreset: "10-11", review: review() } },
        [`PUT ${base}/agreement`]: { body: agreement() },
      });
      await renderRouter(routes, { initialUrl: "/strong-setup" });
      await fireEvent.changeText(await screen.findByLabelText("Name"), "Test phone");
      await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
      await fireEvent.press(await screen.findByTestId("age-10-11"));
      await fireEvent.press(screen.getByTestId("review-6"));
      await fireEvent.press(screen.getByTestId("setup-age-next"));
      await fireEvent.changeText(await screen.findByTestId("agreement-lines"), "I put the phone away at dinner\n\nI ask before I install apps");
      await fireEvent.changeText(screen.getByTestId("agreement-adult-lines"), "Adults leave the phone in the hall");
      await fireEvent.press(screen.getByTestId("setup-agreement-next"));
      await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringMatching(`${base}/setup$`)));
      const sent = fake.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);
      expect(sent).toEqual(["POST /phones/enroll", `POST ${base}/age-preset`, `PUT ${base}/review`, `PUT ${base}/agreement`]);
      expect(fake.calls.find((c) => c.path.endsWith("/age-preset"))?.body).toEqual({ preset: "10-11" });
      expect(fake.calls.find((c) => c.path.endsWith("/review"))?.body).toEqual({ enabled: true, intervalMonths: 6 });
      expect(fake.calls.find((c) => c.path.endsWith("/agreement"))?.body).toEqual({
        lines: ["I put the phone away at dinner", "I ask before I install apps"],
        adultLines: ["Adults leave the phone in the hall"],
      });
    } finally {
      open.mockRestore();
    }
  });
});

describe("growing up screen", () => {
  it("applies an age after saying what it sets, and shows ideas for what to open next", async () => {
    const fake = api({
      [`GET ${base}/age`]: { body: { agePreset: "8-9", review: review() } },
      [`POST ${base}/age-preset`]: { body: { agePreset: "10-11", review: review({ suggestions: [{ kind: "talk" }] }) } },
    });
    await renderRouter(routes, { initialUrl: `${base}/growing` });
    expect(await screen.findByText("Growing up")).toBeTruthy();
    expect(screen.getByText("• More time a day: from 1 h to 1 h 30 min.")).toBeTruthy();
    expect(screen.getByText("• Open video in the web filter.")).toBeTruthy();
    expect(screen.getByText("Started from: 8 to 9 years")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("age-10-11"));
    await fireEvent.press(screen.getByTestId("age-apply"));
    await waitFor(() => expect(screen.getByText("• Nothing needs to change. Ask what they would like to try next.")).toBeTruthy());
    expect(fake.calls.find((c) => c.path.endsWith("/age-preset"))?.body).toEqual({ preset: "10-11" });
  });

  it("turns the reminder off, changes how often it comes and checks the date", async () => {
    const fake = api({
      [`GET ${base}/age`]: { body: { agePreset: null, review: review() } },
      [`PUT ${base}/review`]: (call) => ({ body: { agePreset: null, review: review((call.body as { enabled?: boolean }).enabled === false ? { enabled: false, dueAt: null, suggestions: [] } : {}) } }),
    });
    await renderRouter(routes, { initialUrl: `${base}/growing` });
    const date = await screen.findByTestId("review-date");
    await fireEvent.changeText(date, "2020-01-01");
    await fireEvent(date, "endEditing");
    expect(await screen.findByText("Pick today or a later date.")).toBeTruthy();
    expect(fake.calls.some((c) => c.method === "PUT")).toBe(false);
    await fireEvent.press(screen.getByTestId("review-6"));
    await waitFor(() => expect(fake.calls.find((c) => c.method === "PUT")?.body).toEqual({ intervalMonths: 6 }));
    await fireEvent.press(screen.getByTestId("review-switch"));
    await waitFor(() => expect(fake.calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({ enabled: false }));
    await waitFor(() => expect(screen.queryByTestId("review-done")).toBeNull());
  });

  it("marks the rules as looked at", async () => {
    const fake = api({
      [`GET ${base}/age`]: { body: { agePreset: null, review: review({ due: true }) } },
      [`POST ${base}/review/done`]: { body: { agePreset: null, review: review({ dueAt: "2027-05-16T07:00:00.000Z" }) } },
    });
    await renderRouter(routes, { initialUrl: `${base}/growing` });
    expect(await screen.findByText(/Time to review the rules/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("review-done"));
    await waitFor(() => expect(fake.calls.some((c) => c.path.endsWith("/review/done"))).toBe(true));
  });

  it("is not there for a Myself phone", async () => {
    api({}, phone({ profile: "self" }));
    await renderRouter(routes, { initialUrl: `${base}/growing` });
    await waitFor(() => expect(screen).toHavePathname(base));
  });
});

describe("agreement screen", () => {
  it("saves the lines in the family's words and the switches separately", async () => {
    const fake = api({
      [`GET ${base}/agreement`]: { body: agreement({ lines: ["We eat together"] }) },
      [`PUT ${base}/agreement`]: (call) => ({ body: agreement({ lines: ["We eat together"], ...(call.body as object) }) }),
    });
    await renderRouter(routes, { initialUrl: `${base}/agreement` });
    const lines = await screen.findByTestId("agreement-lines");
    expect(lines.props.value).toBe("We eat together");
    expect(screen.getByTestId("agreement-save").props.accessibilityState?.disabled).toBeTruthy();
    await fireEvent.changeText(lines, "We eat together\n\n  I ask first  ");
    await fireEvent.press(screen.getByTestId("agreement-save"));
    await waitFor(() => expect(fake.calls.find((c) => c.method === "PUT")?.body).toEqual({ lines: ["We eat together", "I ask first"], adultLines: [] }));
    await fireEvent.press(await screen.findByTestId("agreement-home"));
    await waitFor(() => expect(fake.calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({ onHome: true }));
    await fireEvent.press(screen.getByTestId("agreement-enabled"));
    await waitFor(() => expect(fake.calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({ enabled: false }));
    await waitFor(() => expect(screen.queryByTestId("agreement-home")).toBeNull());
  });

  it("will not save a line that is too long", async () => {
    const fake = api({ [`GET ${base}/agreement`]: { body: agreement() } });
    await renderRouter(routes, { initialUrl: `${base}/agreement` });
    await fireEvent.changeText(await screen.findByTestId("agreement-lines"), "x".repeat(141));
    expect(await screen.findByText("Keep each line under 140 characters.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("agreement-save"));
    expect(fake.calls.some((c) => c.method === "PUT")).toBe(false);
  });
});

describe("overview", () => {
  it("links to both screens for a Child phone, and says when the review date has come", async () => {
    api({}, phone({ reviewEnabled: true, reviewDue: true }));
    await renderRouter(routes, { initialUrl: base });
    expect(await screen.findByTestId("section-growing")).toBeTruthy();
    expect(screen.getByTestId("section-agreement")).toBeTruthy();
    expect(screen.getByText(/Time to review the rules/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("review-due"));
    await waitFor(() => expect(screen).toHavePathname(`${base}/growing`));
  });

  it("shows neither on a phone from an older server, or on a Myself phone", async () => {
    const { agePreset: _a, reviewEnabled: _r, reviewDue: _d, ...old } = phone();
    api({}, old);
    await renderRouter(routes, { initialUrl: base });
    expect(await screen.findByTestId("section-apps")).toBeTruthy();
    expect(screen.queryByTestId("section-growing")).toBeNull();
  });
});
