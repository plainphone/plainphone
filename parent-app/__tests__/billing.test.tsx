// SPDX-License-Identifier: Apache-2.0
//
// Billing in the store app (docs/billing.md): nothing at all while billing is off; with billing on
// a read-only plan, the "Offer early unlock" switch on the delay key, and a bought early unlock's
// state with the withdrawal control. Never anything to buy.
import * as SecureStore from "expo-secure-store";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { makeT } from "../src/shared/i18n/translate";
import { formatDateTime } from "../src/shared/lib/format";
import { fakeApi, ME, PHONE } from "../test/fakeApi";

const routes = "./src/app";
const t = makeT("en");
const HID = ME.households[0].id;
const SELF_ID = "22222222-2222-4222-8222-222222222222";
const SELF = { ...PHONE, id: SELF_ID, name: "Mine", profile: "self", mode: "light" };
const KEY_PATH = `/phones/${SELF_ID}/key`;
const FUTURE = "2026-11-21T12:00:00Z";
const PURCHASE_ID = "33333333-3333-4333-8333-333333333333";

const key = {
  keyType: "delay", delayHours: 24, trustedEmail: null, payUnlockEnabled: false, payUnlockAmount: 500,
  payUnlockRecipient: "plainphone", trustedAccepted: false, payUnlockCurrency: "DKK", level: "firm",
};
const off = {
  billing: false, plan: "unlimited", source: null, until: null, limits: { phones: null, trusted: null },
  usage: { phones: 2, trusted: 1 }, prioritySupport: false, prices: { currency: "DKK", plus: 2900, earlyUnlock: 1000 },
  channels: { stripe: false, play: false }, canManage: false,
};
const free = { ...off, billing: true, plan: "free", limits: { phones: 1, trusted: 1 }, usage: { phones: 1, trusted: 0 }, channels: { stripe: true, play: true } };
const purchase = {
  id: PURCHASE_ID, status: "scheduled", channel: "stripe", amount: 1000, currency: "DKK", consentAt: "2026-11-20T11:50:00Z",
  paidAt: "2026-11-20T11:55:00Z", unlockAt: "2026-11-20T12:05:00Z", deliveredAt: null, withdrawnAt: null, refundedAt: null, canWithdraw: true,
};

function api(plan: unknown, extra: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    "GET /me": { body: ME },
    [`GET /households/${HID}/plan`]: { body: plan },
    [`GET /households/${HID}/members`]: { body: { members: [{ id: "u1", email: "parent@example.org", role: "owner" }], invites: [] } },
    [`GET /households/${HID}/reset-protection`]: { body: { available: false, accounts: [] } },
    [`GET /phones/${SELF_ID}`]: { body: SELF },
    [`GET /phones/${SELF_ID}/changes`]: { body: { changes: [] } },
    [`GET /phones/${SELF_ID}/apps`]: { body: { apps: [] } },
    [`GET ${KEY_PATH}`]: { body: key },
    [`GET /phones/${SELF_ID}/emergency-openings`]: { body: { enabled: false, allowance: 3, minutes: 15, used: { month: "2026-11", count: 0 }, openings: [] } },
    [`PUT ${KEY_PATH}`]: { body: { status: "applied" } },
    ...extra,
  });
}

beforeEach(async () => {
  jest.useFakeTimers({
    now: new Date("2026-11-20T12:00:00Z"),
    doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "clearImmediate", "queueMicrotask", "performance", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "hrtime"],
  });
  await SecureStore.setItemAsync("pp.session", "pp_s_saved");
});
afterEach(() => jest.useRealTimers());

describe("billing off", () => {
  it("shows no plan in the household", async () => {
    api(off);
    await renderRouter(routes, { initialUrl: "/household" });
    expect(await screen.findByText(/parent@example.org/)).toBeTruthy();
    expect(screen.queryByTestId("plan-card")).toBeNull();
    expect(screen.queryByText(t("plan.title"))).toBeNull();
  });

  it("shows no early unlock switch and no pay-to-unlock leftovers on the key screen", async () => {
    const fake = api(off);
    await renderRouter(routes, { initialUrl: `/phones/${SELF_ID}/key` });
    expect(await screen.findByTestId("key-levels")).toBeTruthy();
    expect(screen.queryByTestId("key-early-unlock")).toBeNull();
    expect(screen.queryByText(/Pay to unlock|Money goes to|Plainphone project/)).toBeNull();
    await fireEvent.press(screen.getByTestId("key-save"));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(fake.calls.find((c) => c.method === "PUT")!.body).toMatchObject({ payUnlockEnabled: false });
  });
});

describe("billing on", () => {
  it("shows the plan read-only, with no upgrade and no price", async () => {
    api(free);
    await renderRouter(routes, { initialUrl: "/household" });
    expect(await screen.findByTestId("plan-card")).toBeTruthy();
    expect(screen.getByText(t("plan.now.free"))).toBeTruthy();
    expect(screen.getByText(`${t("plan.usage.phones")}: ${t("plan.usage.of", { used: 1, max: 1 })}`)).toBeTruthy();
    expect(screen.getByText(t("plan.freeNever"))).toBeTruthy();
    expect(screen.queryByText(t("plan.upgrade"))).toBeNull();
    expect(screen.queryByText(t("plan.plusTitle"))).toBeNull();
    expect(screen.queryByText(/29|DKK|kr\./)).toBeNull();
  });

  it("says a plan paid through Google Play is paid there", async () => {
    api({ ...free, plan: "plus", source: "play", until: "2026-12-20T00:00:00Z", limits: { phones: null, trusted: null } });
    await renderRouter(routes, { initialUrl: "/household" });
    expect(await screen.findByText(t("plan.playShort"))).toBeTruthy();
    expect(screen.getByText(t("plan.now.plus"))).toBeTruthy();
  });

  it("offers early unlock on the delay key and saves it with the key", async () => {
    const fake = api(free);
    await renderRouter(routes, { initialUrl: `/phones/${SELF_ID}/key` });
    const sw = await screen.findByTestId("key-early-unlock");
    expect(screen.getByText(t("early.switchHelpApp"))).toBeTruthy();
    await fireEvent(sw, "valueChange", true);
    await fireEvent.press(screen.getByTestId("key-save"));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(fake.calls.find((c) => c.method === "PUT")!.body).toMatchObject({ keyType: "delay", payUnlockEnabled: true, payUnlockAmount: 500 });
  });

  it("hides the switch for a trusted person key", async () => {
    api(free);
    await renderRouter(routes, { initialUrl: `/phones/${SELF_ID}/key` });
    expect(await screen.findByTestId("key-early-unlock")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("key-level-strict"));
    expect(screen.queryByTestId("key-early-unlock")).toBeNull();
  });
});

describe("early unlock on a waiting change", () => {
  const change = (earlyUnlock?: unknown) => ({
    id: "c1", op: { type: "app.set", packageName: "com.example.insta", allowed: true }, keyType: "delay", effectiveAt: FUTURE,
    ...(earlyUnlock ? { earlyUnlock } : {}),
  });
  const offer = { available: true, reason: null, price: 1000, currency: "DKK", unlockMinutes: 10, nextAvailableAt: null, purchase: null };

  it("never offers to buy, even when the server has an offer", async () => {
    api(free, { [`GET /phones/${SELF_ID}/changes`]: { body: { changes: [change(offer)] } } });
    await renderRouter(routes, { initialUrl: `/phones/${SELF_ID}` });
    expect(await screen.findByTestId("pending-c1")).toBeTruthy();
    expect(screen.queryByTestId("early-unlock-c1")).toBeNull();
    expect(screen.queryByText(t("early.open"))).toBeNull();
  });

  it("shows a scheduled unlock and withdraws from the contract with confirm: true", async () => {
    const fake = api(off, {
      [`GET /phones/${SELF_ID}/changes`]: { body: { changes: [change({ ...offer, available: false, reason: "inProgress", purchase })] } },
      [`POST /early-unlocks/${PURCHASE_ID}/withdraw`]: { body: { ...purchase, status: "refund_due", canWithdraw: false } },
    });
    await renderRouter(routes, { initialUrl: `/phones/${SELF_ID}` });
    expect(await screen.findByText(t("early.scheduled", { time: formatDateTime(purchase.unlockAt, "en") }))).toBeTruthy();
    await fireEvent.press(screen.getByTestId("early-withdraw"));
    expect(screen.getByText(t("early.withdrawContract", { id: PURCHASE_ID }))).toBeTruthy();
    expect(screen.getByText(t("early.withdrawReceipt", { email: ME.user.email }))).toBeTruthy();
    expect(fake.calls.some((c) => c.path.endsWith("/withdraw"))).toBe(false);
    await fireEvent.press(screen.getByTestId("early-withdraw-confirm"));
    await waitFor(() => expect(fake.calls.find((c) => c.path.endsWith("/withdraw"))?.body).toEqual({ confirm: true }));
    expect(await screen.findByText(t("early.withdrawDone"))).toBeTruthy();
  });
});
