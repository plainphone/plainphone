// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "../i18n/translate";
import { api, ApiError, type Mode, type ModesState, type Phone } from "../lib/api";
import { dayBlocks, ModesPage, slotsOverlap } from "./Modes";

const t = makeT("en");
const notify = vi.fn();
const setPhone = vi.fn();
const phoneRef = vi.hoisted(() => ({ phone: { id: "p1", name: "Alma", profile: "child" } as unknown as Phone }));
vi.mock("./Phone", () => ({ usePhone: () => ({ phone: phoneRef.phone, setPhone, notify }) }));

const free: Mode = { id: "m-free", preset: "free", name: null, allApps: true, allowedPackages: [], contactGroups: ["family", "friends", "others"], quiet: false, isDefault: true };
const school: Mode = { id: "m-school", preset: "school", name: null, allApps: false, allowedPackages: ["a.b", "c.d"], contactGroups: ["family"], quiet: false, isDefault: false };
const night: Mode = { id: "m-night", preset: "night", name: "Sleep", allApps: true, allowedPackages: [], contactGroups: [], quiet: true, isDefault: false };

function state(over: Partial<ModesState> = {}): ModesState {
  return {
    enabled: true,
    parentsMarked: true,
    timezone: "Europe/Copenhagen",
    modes: [free, school, night],
    slots: [],
    current: { modeId: "m-school", until: "14:00" },
    ...over,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { languages: ["en"] });
  phoneRef.phone = { id: "p1", name: "Alma", profile: "child", modesEnabled: true } as unknown as Phone;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  notify.mockClear();
  setPhone.mockClear();
});

function mockGet(s: ModesState) {
  return vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (path.endsWith("/modes")) return s as never;
    if (path.endsWith("/apps")) return { apps: [{ packageName: "a.b", label: "Alpha", core: false }, { packageName: "c.d", label: "Beta", core: false }] } as never;
    throw new Error(`unexpected ${path}`);
  });
}

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><I18nProvider><ModesPage /></I18nProvider></MemoryRouter>));
  const button = (name: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === name || b.getAttribute("aria-label") === name)!;
  return { container, button, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

describe("modes page", () => {
  it("shows only the switch and intro while modes are off", async () => {
    phoneRef.phone = { id: "p1", name: "Alma", profile: "child", modesEnabled: false } as unknown as Phone;
    const get = mockGet(state({ enabled: false }));
    const m = await mount();
    expect(m.container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
    expect(m.container.textContent).toContain(t("modes.switchHelp"));
    expect(m.container.textContent).not.toContain(t("modes.schedule"));
    expect(m.container.textContent).not.toContain(t("modes.add"));
    expect(get).not.toHaveBeenCalled();
    const patch = vi.spyOn(api, "patch").mockResolvedValue({ ...phoneRef.phone, modesEnabled: true });
    await act(async () => (m.container.querySelector('[role="switch"]') as HTMLButtonElement).click());
    expect(patch).toHaveBeenCalledWith("/phones/p1", { modesEnabled: true });
    expect(setPhone).toHaveBeenCalled();
    await m.unmount();
  });

  it("lists the modes with summaries and the current mode, and warns when no parent is marked", async () => {
    mockGet(state({ parentsMarked: false }));
    const m = await mount();
    const text = m.container.textContent!;
    expect(text).toContain("Now: School until");
    expect(text).toContain("2 apps. Family can call");
    expect(text).toContain("Sleep");
    expect(text).toContain("Only parents can call");
    expect(text).toContain(t("modes.summary.quiet"));
    expect(text).toContain(t("modes.default"));
    expect(text).toContain(t("modes.noParents"));
    expect(m.container.querySelector(`a[href="/phones/p1/contacts"]`)?.textContent).toBe(t("modes.goToContacts"));
    await m.unmount();
  });

  it("edits only the name of the default mode and sends null to clear it", async () => {
    mockGet(state());
    const put = vi.spyOn(api, "put").mockResolvedValue({ ...free, name: "Leisure" });
    const m = await mount();
    await act(async () => m.button(`${t("modes.edit")}: ${t("modes.preset.free")}`).click());
    const form = m.container.querySelector("form")!;
    expect(form.querySelectorAll('input[type="radio"]').length).toBe(0);
    expect(form.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    expect(form.querySelector('[role="switch"]')).toBeNull();
    await act(async () => type(form.querySelector('input[name="name"]')!, "Leisure"));
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(put).toHaveBeenCalledWith("/phones/p1/modes/m-free", { name: "Leisure" });
    expect(notify).toHaveBeenCalledWith({ tone: "success", text: t("modes.saved") });
    await m.unmount();
  });

  it("refuses overlapping times before saving", async () => {
    mockGet(state({ slots: [{ id: "s1", modeId: "m-school", days: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 840 }] }));
    const put = vi.spyOn(api, "put");
    const m = await mount();
    await act(async () => m.button(t("modes.addSlot")).click());
    const form = Array.from(m.container.querySelectorAll("form")).at(-1)!;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(m.container.querySelector('[role="alert"]')?.textContent).toBe(t("modes.overlap"));
    await act(async () => m.button(t("modes.save")).click());
    expect(put).not.toHaveBeenCalled();
    await m.unmount();
  });

  it("shows the overlap message when the server answers 400 overlap", async () => {
    mockGet(state());
    const put = vi.spyOn(api, "put").mockRejectedValue(new ApiError(400, "overlap"));
    const m = await mount();
    await act(async () => m.button(t("modes.addSlot")).click());
    const form = Array.from(m.container.querySelectorAll("form")).at(-1)!;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(m.container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => m.button(t("modes.save")).click());
    expect(put).toHaveBeenCalledWith("/phones/p1/mode-schedule", {
      slots: [{ modeId: "m-school", days: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 840 }],
    });
    expect(m.container.querySelector('[role="alert"]')?.textContent).toBe(t("modes.overlap"));
    await m.unmount();
  });
});

describe("plan helpers", () => {
  it("detects overlaps across midnight and the week end", () => {
    expect(slotsOverlap([{ days: [1], startMinute: 480, endMinute: 840 }, { days: [1], startMinute: 840, endMinute: 900 }])).toBe(false);
    expect(slotsOverlap([{ days: [1], startMinute: 480, endMinute: 840 }, { days: [1], startMinute: 839, endMinute: 900 }])).toBe(true);
    expect(slotsOverlap([{ days: [7], startMinute: 1260, endMinute: 420 }, { days: [1], startMinute: 360, endMinute: 480 }])).toBe(true);
    expect(slotsOverlap([{ days: [7], startMinute: 1260, endMinute: 420 }, { days: [1], startMinute: 420, endMinute: 480 }])).toBe(false);
  });

  it("shows a slot that crosses midnight on both days", () => {
    const slots = [{ modeId: "n", days: [1], startMinute: 1260, endMinute: 420 }];
    expect(dayBlocks(slots, 1)).toEqual([{ modeId: "n", start: 1260, end: 1440 }]);
    expect(dayBlocks(slots, 2)).toEqual([{ modeId: "n", start: 0, end: 420 }]);
    expect(dayBlocks(slots, 3)).toEqual([]);
  });
});
