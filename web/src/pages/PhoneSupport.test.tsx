// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import type { Phone } from "../lib/api";
import { ReleaseNotice } from "./PhoneSupport";

const reportedAt = "2026-11-18T19:27:00Z";
const phone: Phone = {
  id: "test", name: "Test phone", profile: "child", mode: "strong", timezone: "UTC",
  locationEnabled: false, pairedAt: reportedAt, lastSeenAt: "2026-11-18T19:30:00Z",
  releaseRequestedAt: "2026-11-18T19:26:00Z", dnsHost: "", dnsSynced: false,
  dnsReady: false, hasLocation: false, openRequests: 0, offlineAlertHours: null, offlineAlertHoursDefault: 48,
  status: {
    appVersion: "0.1.3", batteryPct: null, charging: null, deviceOwner: true, lockIntact: true,
    maintenance: false, failedPolicies: [], rulesEtag: null, rulesAppliedAt: null, dnsHost: null, reportedAt,
  },
};

function render(value: Phone) {
  vi.stubGlobal("navigator", { languages: ["en"] });
  try {
    return renderToStaticMarkup(<I18nProvider><ReleaseNotice phone={value} /></I18nProvider>);
  } finally {
    vi.unstubAllGlobals();
  }
}

it("points parents of older phones to the recovery guide even when the phone reports", () => {
  const markup = render(phone);
  expect(markup).toContain("too old to be released remotely");
  expect(markup).toContain("https://plainphone.org/help/#recovery");
});

it("shows the last report when a current app has not released after three syncs", () => {
  const markup = render({ ...phone, releaseSyncCount: 3, status: { ...phone.status!, appVersion: "0.1.8" } });
  expect(markup).toContain("The phone has not carried out the release.");
  expect(markup).toContain("Last phone report:");
});
