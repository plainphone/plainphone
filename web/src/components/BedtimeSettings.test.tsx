// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import * as jsxRuntime from "react/jsx-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeT } from "@plainphone/i18n/translate";
import { api, type Phone } from "../lib/api";
import { PhoneSwitch, SLEEP_TIP_KEY, SLEEP_TIP_SOURCE, SleepOutsideTip } from "./BedtimeSettings";

vi.mock("../i18n/I18n", () => ({ useI18n: () => ({ t: makeT("en") }) }));
vi.mock("react/jsx-runtime", { spy: true });
vi.mock("react/jsx-dev-runtime", { spy: true });
vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, api: { ...real.api, patch: vi.fn() } };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const phone = { id: "p1", name: "Alma" } as Phone;

function elements() {
  return [...vi.mocked(jsxRuntime.jsx).mock.results, ...vi.mocked(jsxDevRuntime.jsxDEV).mock.results].map(({ value }) => value);
}

describe("sleep outside the bedroom tip", () => {
  it("shows the recommendation with its source until it is dismissed", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    const html = renderToStaticMarkup(<SleepOutsideTip />);
    expect(html).toContain("Let the phone sleep outside the bedroom");
    expect(html).toContain(`href="${SLEEP_TIP_SOURCE}"`);
    expect(html).toContain("Got it");
  });

  it("remembers the dismissal and stays away afterwards", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem });
    renderToStaticMarkup(<SleepOutsideTip />);
    const button = elements().find((el) => el?.type === "button" && el.props.children === "Got it");
    expect(button).toBeDefined();
    button.props.onClick();
    expect(setItem).toHaveBeenCalledWith(SLEEP_TIP_KEY, "1");

    vi.stubGlobal("localStorage", { getItem: () => "1", setItem });
    expect(renderToStaticMarkup(<SleepOutsideTip />)).toBe("");
  });
});

describe("phone switches", () => {
  const props = { label: "Silent bedtime", help: "One line.", setPhone: vi.fn(), notify: vi.fn() };

  it("treats a missing value as on, and shows off when the parent turned it off", () => {
    const on = renderToStaticMarkup(<PhoneSwitch {...props} phone={phone} field="silentBedtime" />);
    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-checked="true"');
    const off = renderToStaticMarkup(<PhoneSwitch {...props} phone={{ ...phone, silentBedtime: false }} field="silentBedtime" />);
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain("One line.");
  });

  it("saves the one field that changed", async () => {
    vi.mocked(api.patch).mockResolvedValue({ ...phone, pinApprovalEnabled: false });
    renderToStaticMarkup(<PhoneSwitch {...props} phone={phone} field="pinApprovalEnabled" />);
    const toggle = elements().find((el) => el?.type === "button" && el.props.role === "switch");
    toggle.props.onClick();
    await vi.waitFor(() => expect(props.setPhone).toHaveBeenCalled());
    expect(api.patch).toHaveBeenCalledWith("/phones/p1", { pinApprovalEnabled: false });
  });
});
