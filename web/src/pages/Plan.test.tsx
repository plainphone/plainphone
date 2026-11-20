// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "../i18n/translate";
import { api, ApiError } from "../lib/api";
import { formatPrice, type Plan } from "../lib/billing";
import { PairPage } from "./Pair";
import { PlanPage } from "./Plan";
import { SettingsPage } from "./Settings";

vi.mock("../lib/session", () => ({
  useMe: () => ({ user: { id: "u1", email: "me@example.test" }, households: [{ id: "h1", name: "Home", role: "owner" }] }),
  useSession: () => ({ refresh: async () => null }),
  useHouseholdId: () => "h1",
}));
vi.mock("./Notifications", () => ({ NotificationsSection: () => null }));
vi.mock("../components/WeeklySummarySettings", () => ({ WeeklySummarySettings: () => null }));

const t = makeT("en");
const off: Plan = {
  billing: false,
  plan: "unlimited",
  source: null,
  until: null,
  limits: { phones: null, trusted: null },
  usage: { phones: 2, trusted: 1 },
  prioritySupport: false,
  prices: { currency: "DKK", plus: 2900, earlyUnlock: 1000 },
  channels: { stripe: false, play: false },
  canManage: false,
};
const free: Plan = { ...off, billing: true, plan: "free", limits: { phones: 1, trusted: 1 }, usage: { phones: 1, trusted: 0 }, channels: { stripe: true, play: false } };
const plus: Plan = { ...off, billing: true, plan: "plus", source: "stripe", until: "2026-12-20T00:00:00Z", prioritySupport: true, channels: { stripe: true, play: false }, canManage: true };
const grandfathered: Plan = { ...off, billing: true, plan: "grandfathered", channels: { stripe: true, play: false } };

let plan: Plan;
const posts: { path: string; body?: unknown }[] = [];
let postImpl: (path: string, body?: unknown) => Promise<unknown>;
let root: Root;
let container: HTMLElement;
const assign = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", { getItem: () => "en", setItem: () => undefined });
  vi.stubGlobal("navigator", { languages: ["en"] });
  plan = off;
  posts.length = 0;
  postImpl = async () => ({ url: "https://checkout.stripe.test/plan" });
  assign.mockReset();
  vi.spyOn(window.location, "assign").mockImplementation(assign);
  vi.spyOn(api, "get").mockImplementation((async (path: string) => {
    if (path === "/households/h1/plan") return plan;
    throw new ApiError(404, "not found");
  }) as never);
  vi.spyOn(api, "post").mockImplementation((async (path: string, body?: unknown) => {
    posts.push({ path, body });
    return postImpl(path, body);
  }) as never);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount(path: string) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/pair" element={<PairPage />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  ));
  await act(async () => undefined);
}
const button = (text: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text);
const planLink = () => container.querySelector('a[href="/plan"]');

it("shows no plan link, no price and the old free promise in Settings while billing is off", async () => {
  await mount("/settings");
  expect(planLink()).toBeNull();
  expect(container.textContent).toContain(t("settings.freePromise"));
  expect(container.textContent).not.toMatch(/DKK|kr\./);
});

it("sends the plan page back to Settings while billing is off", async () => {
  await mount("/plan");
  expect(container.textContent).not.toContain(t("plan.title"));
  expect(container.textContent).toContain(t("settings.title"));
});

it("links the plan from Settings while billing is on", async () => {
  plan = free;
  await mount("/settings");
  expect(planLink()!.textContent).toBe(t("plan.settingsLink"));
  expect(container.textContent).toContain(t("plan.now.free"));
});

it("shows the free plan: usage, what stays free, what Plus adds at the server's price, and an upgrade", async () => {
  plan = free;
  await mount("/plan");
  const text = container.textContent!;
  expect(text).toContain(t("plan.now.free"));
  expect(text).toContain(t("plan.usage.of", { used: 1, max: 1 }));
  expect(text).toContain(t("plan.freeOne"));
  expect(text).toContain(t("plan.freeNever"));
  expect(text).toContain(t("plan.plusTitle"));
  expect(text).toContain(t("plan.price", { price: formatPrice(2900, "DKK", "en") }));
  expect(button(t("plan.manage"))).toBeUndefined();
  await act(async () => button(t("plan.upgrade"))!.click());
  expect(posts).toEqual([{ path: "/households/h1/plan/checkout", body: undefined }]);
  expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/plan");
});

it("hides the upgrade when card payments are not set up", async () => {
  plan = { ...free, channels: { stripe: false, play: true } };
  await mount("/plan");
  expect(button(t("plan.upgrade"))).toBeUndefined();
});

it("shows Plus with its end date and Manage or cancel, without an upgrade", async () => {
  plan = plus;
  await mount("/plan");
  const text = container.textContent!;
  expect(text).toContain(t("plan.now.plus"));
  expect(text).toContain("20 December 2026");
  expect(text).toContain(t("plan.usage.noLimit", { used: 2 }));
  expect(text).not.toContain(t("plan.plusTitle"));
  expect(button(t("plan.upgrade"))).toBeUndefined();
  await act(async () => button(t("plan.manage"))!.click());
  expect(posts[0]!.path).toBe("/households/h1/plan/portal");
});

it("says a Google Play plan is managed in Google Play", async () => {
  plan = { ...plus, source: "play", canManage: false };
  await mount("/plan");
  expect(container.textContent).toContain(t("plan.play"));
  expect(button(t("plan.manage"))).toBeUndefined();
});

it("thanks early households warmly and sells them nothing", async () => {
  plan = grandfathered;
  await mount("/plan");
  expect(container.textContent).toContain(t("plan.grandfathered"));
  expect(container.textContent).not.toContain(t("plan.plusTitle"));
  expect(button(t("plan.upgrade"))).toBeUndefined();
});

it("says the plan can take a minute to show as paid after checkout", async () => {
  plan = free;
  await mount("/plan?checkout=done");
  expect(container.textContent).toContain(t("plan.checkoutDone"));
});

it("explains the free plan and links to it when adding a phone answers 402", async () => {
  plan = free;
  postImpl = async (path) => {
    if (path === "/phones/claim") throw new ApiError(402, "plan_limit", [], { error: "plan_limit", limit: "phones", max: 1 });
    throw new ApiError(404, "not found");
  };
  await mount("/pair?code=K7MP4QXR");
  const name = container.querySelector<HTMLInputElement>('input[name="name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Mine");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(container.textContent).toContain(t("plan.limitPhones", { max: 1 }));
  expect(planLink()!.textContent).toBe(t("plan.limitLink"));
});
