// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "../i18n/translate";
import { api, type Phone } from "../lib/api";
import { TimeSwitches } from "./TimeSwitches";

const t = makeT("en");
const base = { id: "p1", name: "Alma", profile: "child" } as Phone;

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
  await act(async () => root.render(<I18nProvider><TimeSwitches phone={phone} setPhone={setPhone} notify={notify} /></I18nProvider>));
  const sw = (label: string) => {
    const el = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'))
      .find((b) => document.getElementById(b.getAttribute("aria-labelledby")!)?.textContent === label);
    return el!;
  };
  return { container, sw, setPhone, notify, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

it("shows both switches on when the phone has no setting yet, each with its one-line help", async () => {
  const m = await mount(base);
  expect(m.sw(t("time.askSwitch")).getAttribute("aria-checked")).toBe("true");
  expect(m.sw(t("time.warnSwitch")).getAttribute("aria-checked")).toBe("true");
  expect(m.container.textContent).toContain(t("time.askHelp"));
  expect(m.container.textContent).toContain(t("time.warnHelp"));
  const described = m.sw(t("time.askSwitch")).getAttribute("aria-describedby")!;
  expect(document.getElementById(described)?.textContent).toBe(t("time.askHelp"));
  await m.unmount();
});

it("shows a switch off only when the server says false", async () => {
  const m = await mount({ ...base, askMoreTimeEnabled: false, limitWarningEnabled: true });
  expect(m.sw(t("time.askSwitch")).getAttribute("aria-checked")).toBe("false");
  expect(m.sw(t("time.warnSwitch")).getAttribute("aria-checked")).toBe("true");
  await m.unmount();
});

it("saves each switch with PATCH, and keeps both off while saving", async () => {
  let finish!: (p: Phone) => void;
  const patch = vi.spyOn(api, "patch").mockImplementation(() => new Promise((r) => { finish = r as (p: Phone) => void; }));
  const m = await mount(base);
  await act(async () => m.sw(t("time.askSwitch")).click());
  expect(patch).toHaveBeenCalledWith("/phones/p1", { askMoreTimeEnabled: false });
  expect(m.sw(t("time.askSwitch")).disabled).toBe(true);
  expect(m.sw(t("time.warnSwitch")).disabled).toBe(true);
  const saved = { ...base, askMoreTimeEnabled: false } as Phone;
  await act(async () => finish(saved));
  expect(m.setPhone).toHaveBeenCalledWith(saved);
  expect(m.sw(t("time.warnSwitch")).disabled).toBe(false);

  patch.mockResolvedValue({ ...saved, limitWarningEnabled: false });
  await act(async () => m.sw(t("time.warnSwitch")).click());
  expect(patch).toHaveBeenLastCalledWith("/phones/p1", { limitWarningEnabled: false });
  await m.unmount();
});

it("tells the parent when saving fails", async () => {
  vi.spyOn(api, "patch").mockRejectedValue(new Error("boom"));
  const m = await mount(base);
  await act(async () => m.sw(t("time.warnSwitch")).click());
  expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ tone: "error" }));
  await m.unmount();
});

it("leaves out the ask switch on a Self phone", async () => {
  const m = await mount({ ...base, profile: "self" } as Phone);
  expect(m.container.textContent).not.toContain(t("time.askSwitch"));
  expect(m.container.textContent).toContain(t("time.warnSwitch"));
  await m.unmount();
});
