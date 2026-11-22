// SPDX-License-Identifier: Apache-2.0
//
// The key screen's levels (Mild, Firm, Strict, Custom) and its emergency openings section,
// plus the helper's view of the people they help, through the real router against a fake API.
import * as SecureStore from "expo-secure-store";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import type { Op } from "../src/api/models";
import { makeT } from "@plainphone/i18n/translate";
import { formatDateTime } from "@plainphone/shared/format";
import { describeOp } from "@plainphone/shared/ops";
import { fakeApi, ME, PHONE } from "../test/fakeApi";

const routes = "./src/app";
const t = makeT("en");
const SELF_ID = "22222222-2222-4222-8222-222222222222";
const SELF = { ...PHONE, id: SELF_ID, name: "Mine", profile: "self", mode: "light" };
const FUTURE = "2026-11-21T12:00:00Z";
const KEY_PATH = `/phones/${SELF_ID}/key`;
const EMERGENCY_PATH = `/phones/${SELF_ID}/emergency-openings`;
const at = (section: string) => `/phones/${SELF_ID}/${section}`;

const key = {
  keyType: "delay",
  delayHours: 24,
  trustedEmail: null,
  payUnlockEnabled: false,
  payUnlockAmount: 500,
  payUnlockRecipient: "plainphone",
  trustedAccepted: false,
  payUnlockCurrency: "DKK",
  level: "firm",
};
const emergency = { enabled: false, allowance: 3, minutes: 15, used: { month: "2026-11", count: 0 }, openings: [] as unknown[] };

function api(extra: Parameters<typeof fakeApi>[0] = {}, phone: typeof SELF = SELF) {
  return fakeApi({
    "GET /me": { body: ME },
    [`GET /phones/${phone.id}`]: { body: phone },
    [`GET /phones/${phone.id}/changes`]: { body: { changes: [] } },
    [`GET /phones/${phone.id}/apps`]: { body: { apps: [] } },
    [`GET ${KEY_PATH}`]: { body: key },
    [`GET ${EMERGENCY_PATH}`]: { body: emergency },
    [`PUT ${KEY_PATH}`]: { body: { status: "applied" } },
    [`PUT ${EMERGENCY_PATH}`]: { body: { status: "applied" } },
    ...extra,
  });
}
const puts = (calls: { method: string; path: string; body: unknown }[], path: string) => calls.filter((c) => c.method === "PUT" && c.path === path);
const switchChecked = () => screen.getByTestId("emergency-switch").props.accessibilityState.checked;

beforeEach(async () => {
  // Only the clock is pinned: the router and fetch need real timers.
  jest.useFakeTimers({
    now: new Date("2026-11-20T12:00:00Z"),
    doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "clearImmediate", "queueMicrotask", "performance", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "hrtime"],
  });
  await SecureStore.setItemAsync("pp.session", "pp_s_saved");
});
afterEach(() => jest.useRealTimers());

describe("key levels", () => {
  it("offers Mild, Firm and Strict with a description each and selects the current one", async () => {
    api();
    await renderRouter(routes, { initialUrl: at("key") });
    expect(await screen.findByTestId("key-levels")).toBeTruthy();
    for (const l of ["mild", "firm", "strict"] as const) {
      expect(screen.getByLabelText(`${t(`key.level.${l}`)}. ${t(`key.level.${l}Help`)}`)).toBeTruthy();
    }
    expect(screen.getByTestId("key-level-firm").props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId("key-level-mild").props.accessibilityState.checked).toBe(false);
    expect(screen.queryByTestId("key-hours")).toBeNull();
  });

  it("saves Mild and Firm as an ordinary delay key and echoes the pay-to-unlock values", async () => {
    const fake = api();
    await renderRouter(routes, { initialUrl: at("key") });
    await fireEvent.press(await screen.findByTestId("key-level-mild"));
    await fireEvent.press(screen.getByTestId("key-save"));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(puts(fake.calls, KEY_PATH)[0]!.body).toEqual({
      keyType: "delay", delayHours: 1, trustedEmail: null, payUnlockEnabled: false, payUnlockAmount: 500, payUnlockRecipient: "plainphone",
    });
  });

  it("saves Strict with the helper's email", async () => {
    const fake = api();
    await renderRouter(routes, { initialUrl: at("key") });
    await fireEvent.press(await screen.findByTestId("key-level-strict"));
    await fireEvent.changeText(screen.getByTestId("key-email"), "Helper@Example.test");
    await fireEvent.press(screen.getByTestId("key-save"));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(puts(fake.calls, KEY_PATH)[0]!.body).toMatchObject({ keyType: "trusted", trustedEmail: "helper@example.test", delayHours: 24 });
  });

  it("keeps a custom delay: Advanced is open, no card is selected and nothing is sent until saved", async () => {
    const fake = api({ [`GET ${KEY_PATH}`]: { body: { ...key, delayHours: 12, level: "custom" } } });
    await renderRouter(routes, { initialUrl: at("key") });
    expect(await screen.findByText("Custom: 12 hours")).toBeTruthy();
    for (const l of ["mild", "firm", "strict"]) expect(screen.getByTestId(`key-level-${l}`).props.accessibilityState.checked).toBe(false);
    expect(screen.getByTestId("key-advanced").props.accessibilityState.expanded).toBe(true);
    expect(screen.getByTestId("key-hours").props.value).toBe("12");
    expect(puts(fake.calls, KEY_PATH)).toHaveLength(0);
    await fireEvent.press(screen.getByTestId("key-save"));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(puts(fake.calls, KEY_PATH)[0]!.body).toMatchObject({ keyType: "delay", delayHours: 12 });
  });

  it("names 1 and 24 hours typed under Advanced as Mild and Firm", async () => {
    api();
    await renderRouter(routes, { initialUrl: at("key") });
    await fireEvent.press(await screen.findByTestId("key-advanced"));
    await fireEvent.changeText(screen.getByTestId("key-hours"), "48");
    expect(screen.getByTestId("key-level-firm").props.accessibilityState.checked).toBe(false);
    expect(screen.getByText("Custom: 48 hours")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("key-hours"), "1");
    expect(screen.getByTestId("key-level-mild").props.accessibilityState.checked).toBe(true);
  });
});

describe("emergency openings", () => {
  it("is off by default, without the allowance until switched on, and says none used", async () => {
    api();
    await renderRouter(routes, { initialUrl: at("key") });
    expect(await screen.findByTestId("emergency-switch")).toBeTruthy();
    expect(screen.getByText(t("emergency.help"))).toBeTruthy();
    expect(switchChecked()).toBe(false);
    expect(screen.queryByTestId("emergency-allowance")).toBeNull();
    expect(screen.getByText("0 of 3 used this month")).toBeTruthy();
    expect(screen.getByTestId("emergency-none")).toBeTruthy();
  });

  it("saves the switch and openings per month", async () => {
    const fake = api();
    await renderRouter(routes, { initialUrl: at("key") });
    await fireEvent.press(await screen.findByTestId("emergency-switch"));
    await fireEvent.press(screen.getByTestId("emergency-allowance-5"));
    await fireEvent.press(screen.getByTestId("emergency-save"));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(puts(fake.calls, EMERGENCY_PATH)[0]!.body).toEqual({ enabled: true, allowance: 5 });
  });

  it("keeps showing the saved values when the change waits for the key", async () => {
    const fake = api({
      [`PUT ${EMERGENCY_PATH}`]: { status: 202, body: { status: "pending", change: { id: "c1", op: { type: "emergency.set", enabled: true, allowance: 3 }, keyType: "delay", effectiveAt: FUTURE } } },
    });
    await renderRouter(routes, { initialUrl: at("key") });
    await fireEvent.press(await screen.findByTestId("emergency-switch"));
    expect(switchChecked()).toBe(true);
    await fireEvent.press(screen.getByTestId("emergency-save"));
    expect(await screen.findByText(/This takes effect/)).toBeTruthy();
    expect(puts(fake.calls, EMERGENCY_PATH)).toHaveLength(1);
    expect(switchChecked()).toBe(false);
    expect(screen.queryByTestId("emergency-allowance")).toBeNull();
  });

  it("lists the history with app names, falling back to the package name", async () => {
    api({
      [`GET ${EMERGENCY_PATH}`]: {
        body: {
          enabled: true, allowance: 2, minutes: 15, used: { month: "2026-11", count: 2 },
          openings: [
            { id: "o1", packageName: "com.example.maps", appLabel: "Maps", openedAt: "2026-11-19T09:30:00Z", minutes: 15 },
            { id: "o2", packageName: "com.example.chat", appLabel: null, openedAt: "2026-11-18T18:05:00Z", minutes: 15 },
          ],
        },
      },
    });
    await renderRouter(routes, { initialUrl: at("key") });
    expect(await screen.findByText(`Maps, ${formatDateTime("2026-11-19T09:30:00Z", "en")} · 15 min`)).toBeTruthy();
    expect(screen.getByText(`com.example.chat, ${formatDateTime("2026-11-18T18:05:00Z", "en")} · 15 min`)).toBeTruthy();
    expect(screen.getByText("2 of 2 used this month")).toBeTruthy();
    expect(screen.queryByTestId("emergency-none")).toBeNull();
  });

  it("says it is for light-mode phones on a strong-mode phone, with no controls", async () => {
    const fake = api({}, { ...SELF, mode: "strong" });
    await renderRouter(routes, { initialUrl: at("key") });
    expect(await screen.findByText(t("emergency.lightOnly"))).toBeTruthy();
    expect(screen.queryByTestId("emergency-switch")).toBeNull();
    expect(fake.calls.some((c) => c.path === EMERGENCY_PATH)).toBe(false);
  });
});

describe("people I help", () => {
  it("shows each person's emergency openings, and nothing for a server without them", async () => {
    api({
      "GET /approvals": { body: { approvals: [] } },
      "GET /people-i-help": {
        body: {
          people: [
            {
              id: "p1", name: "First", owner: "owner@example.org",
              emergency: {
                enabled: true, allowance: 3, minutes: 15, used: { month: "2026-11", count: 1 },
                openings: [{ id: "o1", packageName: "com.example.maps", appLabel: "Maps", openedAt: "2026-11-19T09:30:00Z", minutes: 15 }],
              },
            },
            { id: "p2", name: "Second", owner: "other@example.org" },
          ],
        },
      },
    });
    await renderRouter(routes, { initialUrl: "/approvals" });
    expect(await screen.findByText("Emergency openings: on, 3 a month · 1 of 3 used this month")).toBeTruthy();
    expect(screen.getByText(`Maps, ${formatDateTime("2026-11-19T09:30:00Z", "en")}`)).toBeTruthy();
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.queryByText("Second")).toBeNull();
    expect(screen.getAllByTestId("emergency-block")).toHaveLength(1);
  });
});

describe("ops", () => {
  it("describes the pending emergency change in all five languages", () => {
    const on: Op = { type: "emergency.set", enabled: true, allowance: 3 };
    const off: Op = { type: "emergency.set", enabled: false, allowance: 3 };
    expect(describeOp(on, makeT("en"), "en")).toBe("Turn on emergency openings, 3 a month");
    expect(describeOp(off, makeT("en"), "en")).toBe("Turn off emergency openings");
    expect(describeOp(on, makeT("da"), "da")).toBe("Slå nødåbninger til, 3 om måneden");
    for (const l of ["sv", "nb", "de"] as const) expect(describeOp(on, makeT(l), l)).not.toBe(describeOp(off, makeT(l), l));
  });
});
