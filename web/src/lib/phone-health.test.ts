// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { makeT } from "../i18n/translate";
import { healthRows, receiptText } from "./phone-health";

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

  it("keeps an unconfigured filter and a maintenance pause neutral", () => {
    const rows = healthRows({ ...phone, dnsConfigured: false, dnsReady: false,
      status: { ...phone.status, maintenance: true } }, now, "en", t);
    expect(rows.find((row) => row.key === "filter")).toMatchObject({ action: false, detail: t("health.noFilterService") });
    expect(rows.find((row) => row.key === "lock")).toMatchObject({ action: false, detail: t("phone.maintenance") });
  });
});

describe("rule confirmations", () => {
  const waiting = { appliedAt: null, confirmedAt: null };
  it("distinguishes waiting for a connected phone from a likely offline one", () => {
    expect(receiptText(waiting, at(10), now, "en", t)).toBe(t("receipt.waiting"));
    expect(receiptText({ ...waiting, needsUpdate: true }, at(10), now, "en", t)).toBe(t("receipt.updatePhone"));
    expect(receiptText(waiting, at(21), now, "en", t)).toBe(t("receipt.offline"));
  });

  it("keeps the confirmation time visible while offline and handles an ahead phone clock", () => {
    const time = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .format(new Date(at(1)));
    expect(receiptText({ appliedAt: at(1), confirmedAt: at(0) }, at(30), now, "en", t))
      .toBe(t("receipt.appliedAt", { time }));
    expect(receiptText({ appliedAt: at(-15), confirmedAt: at(1) }, at(0), now, "en", t))
      .toBe(t("receipt.confirmedAt", { time }));
  });
});
