// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "../i18n/translate";
import type { Phone } from "../lib/api";
import { PhoneLayout, PhoneOverview } from "./Phone";

const phoneId = "test-phone";

const phone: Phone = {
  id: phoneId,
  name: "Test phone",
  profile: "child",
  mode: "strong",
  timezone: "Europe/Copenhagen",
  locationEnabled: false,
  pairedAt: null,
  releaseRequestedAt: null,
  lastSeenAt: null,
  dnsHost: "",
  dnsSynced: true,
  dnsReady: true,
  hasLocation: false,
  status: {
    appVersion: "1.0",
    batteryPct: null,
    charging: null,
    deviceOwner: true,
    lockIntact: true,
    maintenance: false,
    failedPolicies: ["install window overran: 42s"],
    rulesEtag: null,
    rulesAppliedAt: null,
    dnsHost: null,
    reportedAt: "2026-11-18T00:00:00Z",
  },
  openRequests: 0,
  offlineAlertHours: null,
  offlineAlertHoursDefault: 24,
};

vi.mock("../components/ui", async (importOriginal) => {
  const ui = await importOriginal<typeof import("../components/ui")>();
  return {
    ...ui,
    useLoad: (fn: () => Promise<unknown>, deps: readonly unknown[]) => {
      const result = ui.useLoad(fn, deps);
      return deps[0] === phoneId ? { ...result, data: phone } : result;
    },
  };
});

it("shows the install-window warning with an intact lock and keeps the duration in closed details", () => {
  vi.stubGlobal("localStorage", { getItem: () => "en" });
  vi.stubGlobal("navigator", { languages: ["en"] });
  try {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/phones/${phoneId}`]}>
          <Routes>
            <Route path="/phones/:pid" element={<PhoneLayout />}>
              <Route index element={<PhoneOverview />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );
    const t = makeT("en");
    const details = html.match(/<details[^>]*class="[^"]*lock-details"[^>]*>[\s\S]*?<\/details>/)?.[0] ?? "";
    const duration = t("phone.installWindowOverrunDuration", { seconds: "42" });
    const outsideDetails = html.replace(details, "");

    expect(html).toContain(t("phone.lockIntact"));
    expect(outsideDetails).toContain(`<p class="notice notice-warn" role="status">${t("phone.installWindowOverrun")}</p>`);
    expect(outsideDetails).not.toContain(duration);
    expect(details).toContain(duration);
    expect(details).not.toMatch(/^<details\b[^>]*\sopen(?:[\s=>])/);
  } finally {
    vi.unstubAllGlobals();
  }
});
