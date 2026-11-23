// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { makeT } from "@plainphone/i18n/translate";
import { healthRows, receiptText } from "@plainphone/shared/phone-health";

const now = Date.parse("2026-11-19T12:00:00Z");
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const t = makeT("en");

describe("phone health", () => {
  const phone = {
    mode: "light" as const, lastSeenAt: at(1), dnsConfigured: true, dnsReady: true,
    status: {
      reportedAt: at(2), lockIntact: false, maintenance: false, webFilterActive: false,
      protections: { phoneRole: false, smsRole: true },
    },
  };
  it("flags a reported failure and gives a next step", () => {
    const rows = healthRows(phone, now, "en", t);
    expect(rows.find((row) => row.key === "filter")).toMatchObject({ action: true, detail: t("health.fixFilter") });
    expect(rows.find((row) => row.key === "dialer")).toMatchObject({ action: true, detail: t("health.fixPhoneApp") });
    expect(rows.find((row) => row.key === "smsRole")).toMatchObject({ action: false, detail: t("health.on") });
  });

  it.each([
    { filterWorking: true, filterIssue: undefined, action: false, detail: "filter.privateWorking" },
    { filterWorking: false, filterIssue: "wrongHost", action: true, detail: "filter.privateWrongHost" },
    { filterWorking: false, filterIssue: "unverified", action: false, detail: "filter.privateUnverified" },
  ] as const)("shows the Private DNS filter state (%#)", ({ filterWorking, filterIssue, action, detail }) => {
    const status = { ...phone.status, webFilterActive: undefined, filterMethod: "privateDns" as const, filterWorking, filterIssue,
      protections: { alwaysOnVpn: false, phoneRole: true } };
    const rows = healthRows({ ...phone, status }, now, "en", t);
    expect(rows.find((row) => row.key === "filter")).toMatchObject({ action, detail: t(detail) });
    expect(rows.some((row) => row.key === "alwaysOnVpn")).toBe(false);
  });

  it("leaves the device admin row out for a Play phone only", () => {
    const status = { ...phone.status, protections: { deviceAdmin: false, phoneRole: true, smsRole: true } };
    const play = healthRows({ ...phone, status: { ...status, distribution: "play" as const } }, now, "en", t);
    expect(play.some((row) => row.key === "deviceAdmin")).toBe(false);
    for (const distribution of ["github" as const, undefined]) {
      const rows = healthRows({ ...phone, status: { ...status, distribution } }, now, "en", t);
      expect(rows.find((row) => row.key === "deviceAdmin")).toMatchObject({ action: true, detail: t("health.fix.deviceAdmin") });
    }
  });

  it("keeps the Always-on VPN row hidden for a Private DNS phone whose report went stale", () => {
    const status = { ...phone.status, reportedAt: at(60 * 24), filterMethod: "privateDns" as const };
    const rows = healthRows({ ...phone, status }, now, "en", t);
    expect(rows.some((row) => row.key === "alwaysOnVpn")).toBe(false);
  });

  it.each([
    { protections: { usageAccess: true }, action: false, detail: "health.waitForReport" },
    { protections: { usageAccess: true, usageAccessGranted: false }, action: false, detail: "health.usageAccessOff" },
    { protections: { usageAccess: false, usageAccessGranted: false }, action: true, detail: "health.fix.usageAccess" },
    { protections: { usageAccess: true, usageAccessGranted: true }, action: false, detail: "health.on" },
  ] as const)("shows actual usage access with the correct urgency for $protections", ({ protections, action, detail }) => {
    const rows = healthRows({ ...phone, status: { ...phone.status, protections } }, now, "en", t);
    expect(rows.find((row) => row.key === "usageAccess")).toMatchObject({
      action,
      detail: t(detail),
    });
  });

  it("never treats a recent poll as a fresh protection report", () => {
    const rows = healthRows({ ...phone, status: { ...phone.status, reportedAt: at(30) } }, now, "en", t);
    expect(rows.some((row) => row.action)).toBe(false);
    expect(rows.find((row) => row.key === "lock")?.detail).toBe(t("health.waitForReport"));
  });

  it("does not call a filtered phone 'being set up' while its address is not tagged yet", () => {
    const filtered = healthRows({ ...phone, dnsReady: false, rulesDnsReady: true }, now, "en", t);
    expect(filtered.find((row) => row.key === "filter")?.detail).not.toBe(t("health.filterWaiting"));
    const waiting = healthRows({ ...phone, dnsReady: false, rulesDnsReady: false }, now, "en", t);
    expect(waiting.find((row) => row.key === "filter")?.detail).toBe(t("health.filterWaiting"));
    // Servers from before the field: the address flag stands in for it.
    const old = healthRows({ ...phone, dnsReady: false }, now, "en", t);
    expect(old.find((row) => row.key === "filter")?.detail).toBe(t("health.filterWaiting"));
  });

  it("keeps an unconfigured filter and a maintenance pause neutral", () => {
    const rows = healthRows({ ...phone, dnsConfigured: false, dnsReady: false,
      status: { ...phone.status, maintenance: true } }, now, "en", t);
    expect(rows.find((row) => row.key === "filter")).toMatchObject({ action: false, detail: t("health.noFilterService") });
    expect(rows.find((row) => row.key === "lock")).toMatchObject({ action: false, detail: t("phone.maintenance") });
  });
});

describe("rule confirmations", () => {
  const waiting = { appliedAt: null, confirmedAt: null };
  it("uses the shared status copy for waiting, offline and never connected", () => {
    const hours = (h: number) => at(h * 60);
    expect(receiptText(waiting, { lastSeenAt: at(10) }, now, "en", t)).toBe(t("status.waiting.hint"));
    expect(receiptText({ ...waiting, needsUpdate: true }, { lastSeenAt: at(10) }, now, "en", t)).toBe(t("receipt.updatePhone"));
    expect(receiptText(waiting, { lastSeenAt: hours(25) }, now, "en", t)).toBe(t("status.stale.hint"));
    expect(receiptText(waiting, { lastSeenAt: null }, now, "en", t)).toBe(t("status.never.hint"));
  });

  it("keeps the confirmation time visible while offline and handles an ahead phone clock", () => {
    const time = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .format(new Date(at(1)));
    expect(receiptText({ appliedAt: at(1), confirmedAt: at(0) }, { lastSeenAt: at(30) }, now, "en", t))
      .toBe(t("receipt.appliedAt", { time }));
    expect(receiptText({ appliedAt: at(-15), confirmedAt: at(1) }, { lastSeenAt: at(0) }, now, "en", t))
      .toBe(t("receipt.confirmedAt", { time }));
  });
});

describe("iPhone health", () => {
  const iphone = (authorizationStatus?: "notDetermined" | "denied" | "approved") => ({
    mode: "light" as const, platform: "ios" as const, lastSeenAt: at(1), dnsConfigured: true, dnsReady: true,
    status: {
      reportedAt: at(2), lockIntact: authorizationStatus === "approved", maintenance: false, webFilterActive: null,
      ...(authorizationStatus ? { ios: { authorizationStatus } } : {}),
    },
  });

  it("checks Apple's Screen Time permission instead of Android's protections", () => {
    const rows = healthRows(iphone("approved"), now, "en", t);
    expect(rows.find((r) => r.key === "screenTime")).toMatchObject({ action: false, detail: t("health.on") });
    expect(rows.some((r) => r.key === "dialer" || r.key === "deviceAdmin" || r.key === "accessibility")).toBe(false);
  });

  it.each([
    ["denied", "platform.iphone.authDenied"],
    ["notDetermined", "platform.iphone.authNotDetermined"],
  ] as const)("asks the parent to act when the permission is %s", (status, key) => {
    expect(healthRows(iphone(status), now, "en", t).find((r) => r.key === "screenTime")).toMatchObject({ action: true, detail: t(key) });
  });

  it("waits for a report before judging", () => {
    expect(healthRows(iphone(), now, "en", t).find((r) => r.key === "screenTime")).toMatchObject({ action: false });
  });
});
