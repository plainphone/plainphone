// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "@plainphone/i18n/translate";
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
  lastSeenAt: new Date().toISOString(),
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
    reportedAt: new Date().toISOString(),
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

function renderPhone(data: Phone, section = "", locale: "en" | "da" = "en") {
  currentPhone = data;
  requestedSection = section;
  vi.stubGlobal("localStorage", { getItem: () => locale });
  vi.stubGlobal("navigator", { languages: [locale] });
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

it.each(["en", "da"] as const)("shows the battery fix by the version and Update button in %s", (locale) => {
  const html = renderPhone({
    ...phone,
    status: {
      ...phone.status,
      appVersionCode: 11,
      failedPolicies: ["battery exemption missing: self-update cannot run"],
      lockIntact: true,
    },
  }, "", locale);
  const t = makeT(locale);
  const versionRow = html.match(/<li><div class="phone-version">[\s\S]*?<\/li>/)?.[0];
  expect(versionRow).toContain(t("phone.updateNow"));
  expect(versionRow).toContain(t("phone.updateBatteryExemptionMissing"));
  expect(html).not.toContain("battery exemption missing: self-update cannot run");
});


it.each(["en", "da"] as const)("says a Play phone is updated through Google Play, with no Update now, in %s", (locale) => {
  const t = makeT(locale);
  const status = { ...phone.status, appVersionCode: 11, failedPolicies: [] };
  const play = renderPhone({ ...phone, status: { ...status, distribution: "play" } }, "", locale);
  const versionRow = play.match(/<li><div class="phone-version">[\s\S]*?<\/li>/)?.[0];
  expect(versionRow).toContain(t("phone.updatedByPlay"));
  expect(play).not.toContain(t("phone.updateNow"));
  for (const distribution of ["github" as const, undefined]) {
    const html = renderPhone({ ...phone, status: { ...status, distribution } }, "", locale);
    expect(html).toContain(t("phone.updateNow"));
    expect(html).not.toContain(t("phone.updatedByPlay"));
  }
});

it("does not ask a light Play phone for a device admin", () => {
  const t = makeT("en");
  const protections = { deviceAdmin: false, accessibility: true, usageAccess: true, vpn: true, phoneRole: true, smsRole: true };
  const light = { ...phone, mode: "light" as const, status: { ...phone.status, mode: "light" as const, deviceOwner: false, failedPolicies: [], protections } };
  const play = renderPhone({ ...light, status: { ...light.status, distribution: "play" } });
  expect(play).not.toContain(t("prot.deviceAdmin.missing"));
  expect(play).toContain(t("light.allOk"));
  expect(play).toContain(t("light.weaker4Play"));
  expect(play).not.toContain(t("light.weaker4"));
  const github = renderPhone(light);
  expect(github).toContain(t("prot.deviceAdmin.missing"));
  expect(github).toContain(t("light.weaker4"));
});

it("replaces a legacy battery update error with the fix text", () => {
  const detail = "Could not open and relock the install session";
  const html = renderPhone({
    ...phone,
    status: {
      ...phone.status,
      appVersionCode: 11,
      failedPolicies: [],
      update: { state: "failed", errorCode: "battery_exemption_missing", detail, checkedAt: null, latestVersion: null },
    },
  });
  expect(html).toContain(makeT("en")("phone.updateBatteryExemptionLegacy"));
  expect(html).not.toContain(detail);
});

it("keeps an independent update error visible alongside the battery fix", () => {
  const detail = "Download timed out";
  const html = renderPhone({
    ...phone,
    status: {
      ...phone.status,
      appVersionCode: 11,
      failedPolicies: ["battery exemption missing: self-update cannot run"],
      update: { state: "failed", errorCode: "network", detail, checkedAt: null, latestVersion: null },
    },
  });
  const t = makeT("en");
  expect(html).toContain(t("phone.updateBatteryExemptionMissing"));
  expect(html).toContain(t("phone.updateNetwork"));
  expect(html).toContain(detail);
});

it("keeps device notices and app updates available with the health board off", () => {
  const t = makeT("en");
  const html = renderPhone({
    ...phone, healthBoardEnabled: false, pairedAt: phone.lastSeenAt,
    status: { ...phone.status, appVersionCode: 11, lateGoogleAccount: true, clockMoved: true, callRoleActionNeeded: true },
  });
  expect(html).toContain(t("phone.lateGoogleAccount"));
  expect(html).toContain(t("phone.clockMoved").replaceAll("'", "&#x27;"));
  expect(html).toContain(t("phone.callRoleActionNeeded"));
  expect(html).toContain(t("phone.updateNow"));
  expect(html).not.toContain(t("health.lastSeen"));
});

it("uses switches, not checkboxes, for every on/off choice on the phone page", () => {
  const html = renderPhone({
    ...phone, pairedAt: phone.lastSeenAt, changeReceiptsEnabled: true, healthBoardEnabled: false, weeklySummaryEnabled: true,
    pinApprovalEnabled: true, supportEnabled: true, releaseWarningsEnabled: false,
  });
  expect(html).not.toContain('type="checkbox"');
  const switches = [...html.matchAll(/role="switch"[^>]*aria-checked="(true|false)"[^>]*aria-labelledby="([^"]+)"/g)];
  const labelOf = (id: string) => html.match(new RegExp(`id="${id}">([^<]+)<`))?.[1];
  const state = Object.fromEntries(switches.map(([, on, id]) => [labelOf(id!), on]));
  expect(state).toMatchObject({
    "Rule confirmations": "true", "Phone health": "false", "Weekly summary": "true",
    "Support tools": "true", "Release warnings": "false",
  });
});

const allYes = (over: Record<string, "yes" | "partial" | "no"> = {}): Phone["capabilities"] => ({
  apps: "yes", contacts: "yes", webFilter: "yes", bedtimeSilence: "yes", calmHome: "yes", phoneSettings: "yes", selfKeys: "yes", ...over,
});

it("says on each rule what an iPhone cannot do, and only there", () => {
  const t = makeT("en");
  const html = renderPhone({
    ...phone, platform: "ios", tier: "family_controls",
    capabilities: allYes({ contacts: "partial", calmHome: "no" }),
  });
  expect(html).toContain(t("platform.ios.contacts"));
  expect(html).toContain(t("platform.ios.calmHome"));
  expect(html).toContain(t("platform.iosNote").split(".")[0]);
  expect(html).toContain(`<span class="tag">${t("platform.iphone")}</span>`);
  // Rules the iPhone does fully get no line.
  expect(html).not.toContain(t("platform.ios.apps"));
  expect(html).not.toContain(t("platform.ios.webFilter"));
});

it("follows the capability map, not the platform alone", () => {
  const t = makeT("en");
  const html = renderPhone({ ...phone, platform: "ios", tier: "supervised", capabilities: allYes({ contacts: "partial" }) });
  expect(html).toContain(t("platform.ios.contacts"));
  expect(html).not.toContain(t("platform.ios.calmHome"));
});

it("shows no iPhone lines on an Android phone, even with gaps in its map", () => {
  const t = makeT("en");
  const html = renderPhone({ ...phone, mode: "light", platform: "android", tier: "light", capabilities: allYes({ apps: "partial" }) });
  expect(html).not.toContain(t("platform.ios.apps"));
  expect(html).not.toContain(t("platform.iphone"));
  expect(html).toContain(t("mode.light"));
});

it("writes the iPhone line in the parent's language", () => {
  const html = renderPhone({ ...phone, platform: "ios", capabilities: allYes({ contacts: "partial" }) }, "", "da");
  expect(html).toContain(makeT("da")("platform.ios.contacts"));
});

it.each([
  { when: "open", until: "2026-11-16T12:03:00Z", reportedAt: "2026-11-16T11:59:00Z", line: "phone.liftedOpen", notice: "notice-info", time: "12:03" },
  { when: "past and silent", until: "2026-11-16T11:50:00Z", reportedAt: "2026-11-16T11:49:00Z", line: "phone.liftedOverdue", notice: "notice-warn", time: "11:50" },
] as const)("shows the lifted account window as a calm line or a warning when $when", ({ until, reportedAt, line, notice, time }) => {
  const zone = process.env.TZ;
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
  try {
    const html = renderPhone({
      ...phone,
      status: { ...phone.status, failedPolicies: [], liftedPolicies: [{ name: "restriction no_modify_accounts", until }], reportedAt },
    });
    const t = makeT("en");
    expect(html).toContain(`<p class="notice ${notice}" role="status">${t(line, { time })}</p>`);
    expect(html).toContain(t("phone.lockIntact"));
  } finally {
    vi.useRealTimers();
    if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
  }
});

it("shows no lifted line without a lifted step, or when the server already lists it as failed", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
  try {
    const name = "restriction no_modify_accounts";
    const past = [{ name, until: "2026-11-16T11:40:00Z" }];
    for (const status of [phone.status, { ...phone.status, failedPolicies: [name], liftedPolicies: past }]) {
      const html = renderPhone({ ...phone, status });
      expect(html).not.toContain("Account changes were allowed");
      expect(html).not.toContain("Account changes are allowed");
    }
  } finally {
    vi.useRealTimers();
  }
});

it("shows a rule an iPhone cannot do as text instead of a link to switches that do nothing", () => {
  const t = makeT("en");
  const html = renderPhone({ ...phone, platform: "ios", mode: "light", capabilities: allYes({ calmHome: "no", contacts: "partial" }) });
  expect(html).not.toContain(`href="/phones/${phoneId}/home"`);
  expect(html).toContain('class="row-link row-static"');
  expect(html).toContain(t("platform.ios.calmHome"));
  // Partial rules stay links, with their line.
  expect(html).toContain(`href="/phones/${phoneId}/contacts"`);
  // An iPhone is a light phone, but light mode's Android setup section does not apply.
  expect(html).not.toContain(t("light.intro"));
});

it("keeps every rule a link on Android", () => {
  const html = renderPhone({ ...phone, platform: "android", capabilities: allYes({ calmHome: "no" }) });
  expect(html).toContain(`href="/phones/${phoneId}/home"`);
  expect(html).not.toContain("row-static");
});
