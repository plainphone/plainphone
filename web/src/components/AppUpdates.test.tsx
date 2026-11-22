// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "@plainphone/i18n/translate";
import { api, type Phone, type PhoneStatus } from "../lib/api";
import { appUpdateLines, appUpdateReceiptLine, type AppUpdateWindow } from "../lib/app-updates";
import { AppUpdates } from "./AppUpdates";

const t = makeT("en");
const base = { id: "p1", name: "Alma", profile: "child", mode: "strong", status: null } as unknown as Phone;
const night: AppUpdateWindow = {
  id: "w1", trigger: "night", openedAt: "2026-11-16T02:10:00Z", closedAt: "2026-11-16T02:55:00Z", updated: 3, caught: [],
};
const withReport = (appUpdates: AppUpdateWindow, over: Partial<Phone> = {}) =>
  ({ ...base, status: { appUpdates } as unknown as PhoneStatus, ...over }) as Phone;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { languages: ["en"] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(phone: Phone, setPhone = vi.fn(), notify = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<I18nProvider><AppUpdates phone={phone} setPhone={setPhone} notify={notify} /></I18nProvider>));
  const sw = () => container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  const button = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === t("appUpdates.now"))!;
  return { container, sw, button, setPhone, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

it("is on by default with its one-line help, and says when no window has run yet", async () => {
  const m = await mount(base);
  expect(m.sw().getAttribute("aria-checked")).toBe("true");
  expect(m.container.textContent).toContain(t("appUpdates.help"));
  expect(m.container.textContent).toContain(t("appUpdates.none"));
  await m.unmount();
});

it("is not shown for a light-mode phone", async () => {
  const m = await mount({ ...base, mode: "light" } as Phone);
  expect(m.container.textContent).toBe("");
  await m.unmount();
});

it("saves the switch with PATCH", async () => {
  const patch = vi.spyOn(api, "patch").mockResolvedValue({ ...base, appUpdatesEnabled: false });
  const m = await mount(base);
  await act(async () => m.sw().click());
  expect(patch).toHaveBeenCalledWith("/phones/p1", { appUpdatesEnabled: false });
  expect(m.setPhone).toHaveBeenCalledWith(expect.objectContaining({ appUpdatesEnabled: false }));
  await m.unmount();
});

it("asks the phone to update now and says when it will happen", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue(undefined);
  const m = await mount(withReport(night));
  await act(async () => m.button().click());
  expect(post).toHaveBeenCalledWith("/phones/p1/app-updates");
  expect(m.container.textContent).toContain(t("appUpdates.requested"));
  await m.unmount();
});

it("stops saying the request is on its way once the phone reports a newer window", async () => {
  const waiting = await mount(withReport(night, { appUpdatesRequestedAt: "2026-11-16T09:00:00Z" }));
  expect(waiting.container.textContent).toContain(t("appUpdates.requested"));
  await waiting.unmount();
  const done = await mount(withReport({ ...night, trigger: "parent", openedAt: "2026-11-16T09:01:00Z", closedAt: null },
    { appUpdatesRequestedAt: "2026-11-16T09:00:00Z" }));
  expect(done.container.textContent).not.toContain(t("appUpdates.requested"));
  await done.unmount();
});

it("shows the last window and the new apps it kept hidden", async () => {
  const m = await mount(withReport({ ...night, caught: ["com.example.game"] }));
  expect(m.container.textContent).toContain("Apps updated: 3.");
  expect(m.container.textContent).toContain(t("appUpdates.caught", { count: 1 }));
  await m.unmount();
});

it("describes every state of a window", () => {
  expect(appUpdateLines(undefined, "en").map((l) => l.key)).toEqual(["appUpdates.none"]);
  expect(appUpdateLines({ ...night, closedAt: null }, "en").map((l) => l.key)).toEqual(["appUpdates.open"]);
  expect(appUpdateLines(night, "en")[0]).toMatchObject({ key: "appUpdates.last", params: { count: 3 } });
  expect(appUpdateLines({ ...night, openedAt: null, error: "batteryExemption" }, "en"))
    .toEqual([{ key: "appUpdates.failedBattery", tone: "warn" }]);
  expect(appUpdateLines({ ...night, openedAt: null, error: "failed" }, "en"))
    .toEqual([{ key: "appUpdates.failed", tone: "warn" }]);
});

it("does not say the request is on its way while a nightly window that serves it is open", async () => {
  const open = await mount(withReport({ ...night, closedAt: null }, { appUpdatesRequestedAt: "2026-11-16T02:20:00Z" }));
  expect(open.container.textContent).not.toContain(t("appUpdates.requested"));
  expect(open.container.textContent).toContain("Updating apps since");
  await open.unmount();
});

it("adds the open window to the rule receipt until it ends", () => {
  const opened = Date.parse(night.openedAt!);
  const open = { ...night, closedAt: null };
  const end = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(opened + 45 * 60_000));
  expect(appUpdateReceiptLine(open, opened + 60_000, "en")).toEqual({ key: "appUpdates.receipt", params: { time: end }, tone: "normal" });
  expect(appUpdateReceiptLine(open, opened + 45 * 60_000, "en")).toBeNull();
  expect(appUpdateReceiptLine(night, opened + 60_000, "en")).toBeNull();
  expect(appUpdateReceiptLine(undefined, opened, "en")).toBeNull();
  expect(appUpdateReceiptLine({ ...open, openedAt: null, error: "failed" }, opened, "en")).toBeNull();
});
