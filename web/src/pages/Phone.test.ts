// SPDX-License-Identifier: Apache-2.0
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import type { Phone } from "../lib/api";
import { PhoneStatusBlock } from "./Phone";

it("shows the system check's own date even after a newer phone sync", () => {
  const now = Date.parse("2026-11-17T21:00:00Z");
  const phone: Phone = {
    id: "phone", name: "Test", profile: "child", mode: "strong", timezone: "UTC", locationEnabled: false,
    pairedAt: "2026-11-16T10:00:00Z", lastSeenAt: new Date(now).toISOString(), dnsHost: "", dnsSynced: false,
    dnsReady: false, hasLocation: false, openRequests: 0, offlineAlertHours: null, offlineAlertHoursDefault: 48, releaseRequestedAt: null,
    status: {
      appVersion: "1.0", batteryPct: null, charging: false, deviceOwner: true, lockIntact: true,
      maintenance: false, failedPolicies: [], rulesEtag: null, rulesAppliedAt: null, dnsHost: null,
      reportedAt: new Date(now).toISOString(),
    },
    attestation: { state: "verified", checkedAt: "2026-11-17T20:00:00Z", deviceLocked: true, osPatchLevel: null },
  };
  vi.stubGlobal("navigator", { languages: ["en"] });
  try {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, { children: createElement(PhoneStatusBlock, { phone, now }) }),
    );
    expect(html).toContain("System checked 1 hour ago");
  } finally {
    vi.unstubAllGlobals();
  }
});
