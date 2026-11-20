// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "../i18n/translate";
import { api, type EmergencyOpenings, type SelfKey } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { KeyPage } from "./Key";

const t = makeT("en");
const PID = "phone-1";

const { ctx } = vi.hoisted(() => ({
  ctx: { phone: {} as Record<string, unknown>, run: undefined as unknown as (fn: () => Promise<unknown>) => Promise<unknown> },
}));

vi.mock("./Phone", () => ({
  usePhone: () => ({ phone: ctx.phone, run: (fn: () => Promise<unknown>) => ctx.run(fn), notify: () => undefined }),
}));
vi.mock("../lib/session", () => ({ useMe: () => ({ user: { email: "me@example.test" } }) }));

const baseKey: SelfKey = {
  keyType: "delay",
  delayHours: 24,
  trustedEmail: null,
  payUnlockEnabled: false,
  payUnlockAmount: 0,
  payUnlockRecipient: "plainphone",
  trustedAccepted: false,
  payUnlockCurrency: "DKK",
  level: "firm",
};

const baseEmergency: EmergencyOpenings = { enabled: false, allowance: 3, minutes: 15, used: { month: "2026-11", count: 0 }, openings: [] };

const calls: { method: string; path: string; body?: unknown }[] = [];
let key: SelfKey;
let emergency: EmergencyOpenings;
let putResult: unknown;
let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", { getItem: () => "en", setItem: () => undefined });
  vi.stubGlobal("navigator", { languages: ["en"] });
  calls.length = 0;
  key = { ...baseKey };
  emergency = { ...baseEmergency };
  putResult = { status: "applied" };
  ctx.phone = { id: PID, profile: "self", mode: "light", pairedAt: null };
  ctx.run = async (fn) => fn();
  vi.spyOn(api, "get").mockImplementation((async (path: string) => {
    calls.push({ method: "GET", path });
    return path.endsWith("/emergency-openings") ? emergency : key;
  }) as never);
  vi.spyOn(api, "put").mockImplementation((async (path: string, body?: unknown) => {
    calls.push({ method: "PUT", path, body });
    return putResult;
  }) as never);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><I18nProvider><KeyPage /></I18nProvider></MemoryRouter>));
  await act(async () => undefined);
}

const radio = (name: string) => container.querySelector<HTMLInputElement>(`input[name="keyLevel"][value="${name}"]`)!;
const checkedLevels = () => Array.from(container.querySelectorAll<HTMLInputElement>('input[name="keyLevel"]:checked')).map((i) => i.value);
const sw = () => container.querySelector<HTMLButtonElement>('[role="switch"]')!;
const keyForm = () => container.querySelectorAll("form")[0]!;
const emergencyForm = () => container.querySelectorAll("form")[1]!;
const saveIn = (form: HTMLElement) => form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const puts = () => calls.filter((c) => c.method === "PUT");

async function click(el: Element) {
  await act(async () => (el as HTMLElement).click());
}
async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit(form: HTMLElement) {
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
const hoursSelect = () => container.querySelector<HTMLSelectElement>("details.key-advanced select")!;

it("offers Mild, Firm and Strict with a description each and selects the current level", async () => {
  await mount();
  const group = container.querySelector("fieldset.choices")!;
  expect(group.querySelector("legend")!.textContent).toBe(t("key.type"));
  for (const l of ["mild", "firm", "strict"] as const) {
    expect(group.textContent).toContain(t(`key.level.${l}`));
    expect(group.textContent).toContain(t(`key.level.${l}Help`));
  }
  expect(checkedLevels()).toEqual(["firm"]);
  expect(container.querySelector("details.key-advanced")!.hasAttribute("open")).toBe(false);
});

it("saves Mild and Firm as an ordinary delay key, echoing the pay-to-unlock fields", async () => {
  await mount();
  await click(radio("mild"));
  await submit(keyForm());
  expect(puts()[0]).toEqual({
    method: "PUT",
    path: `/phones/${PID}/key`,
    body: { keyType: "delay", delayHours: 1, trustedEmail: null, payUnlockEnabled: false, payUnlockAmount: 0, payUnlockRecipient: "plainphone" },
  });
  await click(radio("firm"));
  await submit(keyForm());
  expect(puts()[1]!.body).toMatchObject({ keyType: "delay", delayHours: 24, trustedEmail: null });
});

it("saves Strict with the email, and asks for a valid one first", async () => {
  await mount();
  await click(radio("strict"));
  await submit(keyForm());
  expect(puts()).toHaveLength(0);
  expect(container.textContent).toContain(t("key.emailInvalid"));
  const email = container.querySelector<HTMLInputElement>('input[type="email"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(email, "Helper@Example.test");
    email.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await submit(keyForm());
  expect(puts()[0]!.body).toMatchObject({ keyType: "trusted", trustedEmail: "helper@example.test", delayHours: 24 });
});

it("saves Strict with a QR invite when that is chosen", async () => {
  await mount();
  await click(radio("strict"));
  await click(container.querySelector('input[type="checkbox"]')!);
  await submit(keyForm());
  expect(puts()[0]!.body).toMatchObject({ keyType: "trusted", trustedEmail: null, qrInvite: true });
});

it("keeps a custom delay: Advanced is open, no card is selected, and nothing is sent until saved", async () => {
  key = { ...baseKey, delayHours: 12, level: "custom" };
  await mount();
  expect(checkedLevels()).toEqual([]);
  expect(container.querySelector("details.key-advanced")!.hasAttribute("open")).toBe(true);
  expect(container.textContent).toContain(t("key.level.custom", { hours: 12 }));
  expect(hoursSelect().value).toBe("12");
  expect(puts()).toHaveLength(0);
  await submit(keyForm());
  expect(puts()[0]!.body).toMatchObject({ keyType: "delay", delayHours: 12 });
});

it("picks a custom number of hours under Advanced, and names 1 and 24 hours as Mild and Firm", async () => {
  await mount();
  await choose(hoursSelect(), "48");
  expect(checkedLevels()).toEqual([]);
  expect(container.textContent).toContain(t("key.level.custom", { hours: 48 }));
  await submit(keyForm());
  expect(puts()[0]!.body).toMatchObject({ keyType: "delay", delayHours: 48 });
  await choose(hoursSelect(), "1");
  expect(checkedLevels()).toEqual(["mild"]);
});

it("shows the emergency section off by default, without the allowance until it is switched on", async () => {
  await mount();
  expect(container.textContent).toContain(t("emergency.title"));
  expect(container.textContent).toContain(t("emergency.help"));
  expect(sw().getAttribute("aria-checked")).toBe("false");
  expect(emergencyForm().querySelector("select")).toBeNull();
  expect(saveIn(emergencyForm()).disabled).toBe(true);
  expect(container.textContent).toContain(t("emergency.used", { used: 0, total: 3 }));
  expect(container.textContent).toContain(t("emergency.none"));
});

it("saves the switch and openings per month", async () => {
  await mount();
  await click(sw());
  const select = emergencyForm().querySelector("select")!;
  expect(select.value).toBe("3");
  await choose(select, "5");
  await submit(emergencyForm());
  expect(puts()[0]).toEqual({ method: "PUT", path: `/phones/${PID}/emergency-openings`, body: { enabled: true, allowance: 5 } });
});

it("keeps showing the saved values when the change waits for the key", async () => {
  putResult = { status: "pending", change: { id: "c1" } };
  await mount();
  await click(sw());
  expect(sw().getAttribute("aria-checked")).toBe("true");
  await submit(emergencyForm());
  expect(puts()).toHaveLength(1);
  expect(sw().getAttribute("aria-checked")).toBe("false");
  expect(emergencyForm().querySelector("select")).toBeNull();
});

it("lists the history with app names, falling back to the package name", async () => {
  emergency = {
    enabled: true,
    allowance: 2,
    minutes: 15,
    used: { month: "2026-11", count: 2 },
    openings: [
      { id: "o1", packageName: "com.example.maps", appLabel: "Maps", openedAt: "2026-11-19T09:30:00Z", minutes: 15 },
      { id: "o2", packageName: "com.example.chat", appLabel: null, openedAt: "2026-11-18T18:05:00Z", minutes: 15 },
    ],
  };
  await mount();
  expect(sw().getAttribute("aria-checked")).toBe("true");
  const items = Array.from(container.querySelectorAll(".emergency-list li")).map((li) => li.textContent);
  expect(items).toEqual([
    `Maps, ${formatDateTime("2026-11-19T09:30:00Z", "en")} · 15 min`,
    `com.example.chat, ${formatDateTime("2026-11-18T18:05:00Z", "en")} · 15 min`,
  ]);
  expect(container.textContent).toContain(t("emergency.used", { used: 2, total: 2 }));
  expect(container.textContent).not.toContain(t("emergency.none"));
});

it("says emergency openings are for light-mode phones on a strong-mode phone, with no controls", async () => {
  ctx.phone = { id: PID, profile: "self", mode: "strong", pairedAt: null };
  await mount();
  expect(container.textContent).toContain(t("emergency.lightOnly"));
  expect(container.querySelector('[role="switch"]')).toBeNull();
  expect(calls.some((c) => c.path.endsWith("/emergency-openings"))).toBe(false);
});
