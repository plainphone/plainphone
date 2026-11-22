// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "@plainphone/i18n/translate";
import { api } from "../lib/api";
import { SetupPhonePage } from "./AddPhone";

it.each([null, "replacement"])("hides the displayed QR when polling returns %s as the token id", async (nextId) => {
  const phone = {
    id: "test-phone",
    name: "Test phone",
    mode: "light",
    pairedAt: null,
    setupQrAvailable: true,
    setupEnrollmentId: "original",
  };
  const path = `/phones/${phone.id}`;
  const get = vi.spyOn(api, "get").mockResolvedValue(phone);
  vi.spyOn(api, "post").mockResolvedValue({
    enrollment: { id: phone.setupEnrollmentId, token: "pp_e_test", expiresAt: new Date(Date.now() + 60_000).toISOString() },
    provisioning: { mode: "light", serverUrl: "https://example.org", adminComponent: "test/.Admin" },
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { languages: ["en"], clipboard: { writeText: vi.fn() } });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.useFakeTimers();

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const t = makeT("en");
  const qr = () => container.querySelector(`[aria-label="${t("add.qrAlt")}"]`);

  try {
    await act(async () => root.render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`${path}/setup`]}>
          <Routes><Route path="/phones/:pid/setup" element={<SetupPhonePage />} /></Routes>
        </MemoryRouter>
      </I18nProvider>,
    ));
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(qr()).not.toBeNull();
    expect(container.textContent).toContain(t("add.copyLink"));
    expect(container.textContent).toContain(t("add.light1"));

    get.mockResolvedValue({ ...phone, setupEnrollmentId: nextId });
    await act(async () => vi.advanceTimersByTimeAsync(4_000));

    expect(get).toHaveBeenLastCalledWith(path);
    expect(qr()).toBeNull();
    expect(container.textContent).not.toContain(t("add.copyLink"));
    expect(container.textContent).not.toContain(t("add.light1"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(t("add.outdatedQr"));
    expect(container.querySelector(`a[href="${path}/setup"]`)?.textContent).toBe(t("add.newLink"));
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
