// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "../i18n/translate";
import type { Phone } from "../lib/api";
import { PhoneSettingsPage } from "./PhoneSettings";
import { SetupPhonePage } from "./AddPhone";
import { PhoneLayout, PhoneOverview } from "./Phone";

const phoneId = "test-phone";

const phone: Phone & { status: NonNullable<Phone["status"]> } = {
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

let currentPhone: Phone;
let requestedSection = "";
let latestAndroid: { versionCode: number; versionName: string } | undefined;

vi.mock("../components/ui", async (importOriginal) => {
  const ui = await importOriginal<typeof import("../components/ui")>();
  return {
    ...ui,
    useLoad: (fn: () => Promise<unknown>, deps: readonly unknown[]) => {
      const result = ui.useLoad(fn, deps);
      if (requestedSection === "/settings" && fn.toString().includes("getPhoneSettings")) return result;
      if (deps[0] === phoneId) return { ...result, data: currentPhone };
      return deps[0] === true ? { ...result, data: latestAndroid } : result;
    },
  };
});

function renderPhone(data: Phone, section = "") {
  currentPhone = data;
  requestedSection = section;
  vi.stubGlobal("localStorage", { getItem: () => "en" });
  vi.stubGlobal("navigator", { languages: ["en"] });
  try {
    return renderToStaticMarkup(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/phones/${phoneId}${section}`]}>
          <Routes>
            <Route path="/phones/:pid" element={<PhoneLayout />}>
              <Route index element={<PhoneOverview />} />
              <Route path="settings" element={<PhoneSettingsPage />} />
              <Route path="setup" element={<SetupPhonePage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );
  } finally {
    vi.unstubAllGlobals();
  }
}

it.each(["/settings", "/setup"])("offers a labeled language picker on %s", (section) => {
  const html = renderPhone({ ...phone, language: "nb" }, section);
  expect(html).toContain("Plainphone language");
  expect(html).toContain('value="nb" lang="nb" selected="">Norsk bokmål');
  expect(html).toContain("Use phone language");
});

it("shows the saved household time zone when regenerating a setup QR code", () => {
  const html = renderPhone({ ...phone, timezone: "Europe/Oslo" }, "/setup");
  expect(html).toContain("Household time zone");
  expect(html).toContain('value="Europe/Oslo" selected="">Europe/Oslo');
  expect(html).toContain('value="Europe/Copenhagen"');
});

it.each([
  { mode: "light", state: "prompted", errorCode: undefined, guidance: "pair it again", latest: undefined },
  { mode: "light", state: "prompted", errorCode: undefined, guidance: "pair it again",
    latest: { versionCode: 10, versionName: "0.1.9" } },
  { mode: "strong", state: "refused", errorCode: "signature_mismatch", guidance: "release Device Owner", latest: undefined },
  { mode: "light", state: "upToDate", errorCode: undefined, guidance: "pair it again",
    latest: { versionCode: 11, versionName: "0.1.10" } },
] as const)("shows setup guidance for a test-key phone in $mode mode reporting $state", ({
  mode, state, errorCode, guidance, latest,
}) => {
  latestAndroid = latest;
  try {
    const html = renderPhone({
      ...phone,
      mode,
      status: {
        ...phone.status,
        mode,
        deviceOwner: mode === "strong",
        appVersion: "0.1.9",
        appVersionCode: 10,
        update: { state, errorCode, detail: null, checkedAt: null, latestVersion: state === "upToDate" ? "0.1.9" : "0.1.10" },
      },
    });
    expect(html).toContain(guidance);
    if (mode === "light") {
      expect(html).toContain("deletes its saved rules");
      expect(html).toContain("24 hours by default without a key");
      expect(html).toContain("approval from the trusted person");
    }
    expect(html).not.toContain(makeT("en")("phone.updateNow"));
  } finally {
    latestAndroid = undefined;
  }
});

it.each([
  { installed: "0.1.8", offered: "0.1.9" },
  { installed: "0.1.10", offered: "0.1.11" },
])("keeps the normal update prompt from $installed to $offered", ({ installed, offered }) => {
  const html = renderPhone({
    ...phone,
    mode: "light",
    status: {
      ...phone.status,
      mode: "light",
      deviceOwner: false,
      appVersion: installed,
      appVersionCode: 10,
      update: { state: "prompted", detail: null, checkedAt: null, latestVersion: offered },
    },
  });
  expect(html).toContain(makeT("en")("phone.updateAvailable", { version: offered }));
});

it("shows the install-window warning with an intact lock and keeps the duration in closed details", () => {
  const html = renderPhone(phone);
  const t = makeT("en");
  const details = html.match(/<details[^>]*class="[^"]*lock-details"[^>]*>[\s\S]*?<\/details>/)?.[0] ?? "";
  const duration = t("phone.installWindowOverrunDuration", { seconds: "42" });
  const outsideDetails = html.replace(details, "");

  expect(html).toContain(t("phone.lockIntact"));
  expect(outsideDetails).toContain(`<p class="notice notice-warn" role="status">${t("phone.installWindowOverrun")}</p>`);
  expect(outsideDetails).not.toContain(duration);
  expect(details).toContain(duration);
  expect(details).not.toMatch(/^<details\b[^>]*\sopen(?:[\s=>])/);
});

it("shows the account warning on its own with an intact lock and closed technical details", () => {
  const failedPolicy = "restriction no_modify_accounts";
  const html = renderPhone({
    ...phone,
    status: { ...phone.status, failedPolicies: [failedPolicy], lateGoogleAccount: true },
  });
  const t = makeT("en");
  const details = html.match(/<details[^>]*class="[^"]*lock-details"[^>]*>[\s\S]*?<\/details>/)?.[0] ?? "";

  expect(details).toContain(failedPolicy);
  expect(details).not.toMatch(/^<details\b[^>]*\sopen(?:[\s=>])/);
  expect(html).toContain(t("phone.lockIntact"));
  expect(html).not.toContain(t("phone.installWindowOverrun"));
  expect(html.replace(details, "")).toContain(
    `<p class="notice notice-warn" role="status">${t("phone.lateGoogleAccount")}</p>`,
  );
});

it("shows code-pairing recovery instructions instead of the setup QR action", () => {
  const t = makeT("en");
  const codeClaim = renderPhone({ ...phone, mode: "light", setupQrAvailable: false });
  const qrSetup = renderPhone({ ...phone, mode: "light", setupQrAvailable: true });

  expect(codeClaim).toContain(t("setup.codePendingBody"));
  expect(codeClaim).not.toContain(t("setup.showQr"));
  expect(qrSetup).toContain(t("setup.showQr"));
});
