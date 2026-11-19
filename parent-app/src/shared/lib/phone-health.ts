// SPDX-License-Identifier: Apache-2.0
import type { MessageKey, T } from "../i18n/translate";
import { formatRelative } from "./format";

const PHONE_STATUS_STALE_MS = 20 * 60_000;

type PhoneHealth = {
  mode: "strong" | "light";
  lastSeenAt: string | null;
  dnsConfigured?: boolean;
  dnsReady?: boolean;
  status?: {
    reportedAt: string;
    lockIntact: boolean;
    maintenance: boolean;
    callRoleActionNeeded?: boolean;
    webFilterActive?: boolean | null;
    protections?: Partial<Record<string, boolean>>;
  } | null;
};

export type RuleReceipt = { appliedAt: string | null; confirmedAt: string | null; needsUpdate?: boolean };

function recent(when: string | null | undefined, now: number): boolean {
  return !!when && now - Date.parse(when) < PHONE_STATUS_STALE_MS;
}

export function receiptText(receipt: RuleReceipt, lastSeenAt: string | null, now: number, locale: "da" | "en", t: T): string {
  if (!receipt.appliedAt) {
    if (!recent(lastSeenAt, now)) return t("receipt.offline");
    return t(receipt.needsUpdate ? "receipt.updatePhone" : "receipt.waiting");
  }
  const appliedAt = Date.parse(receipt.appliedAt);
  const confirmation = receipt.confirmedAt ? Date.parse(receipt.confirmedAt) : now;
  const clockAhead = appliedAt > confirmation;
  const displayTime = new Date(clockAhead ? confirmation : appliedAt);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(displayTime);
  const dateStyle = { dateStyle: "medium" } as const;
  const dates = new Intl.DateTimeFormat(locale, dateStyle);
  const when = dates.format(displayTime) === dates.format(now)
    ? time
    : `${dates.format(displayTime)}, ${time}`;
  return t(clockAhead ? "receipt.confirmedAt" : "receipt.appliedAt", { time: when });
}

const LIGHT_CHECKS = [
  "deviceAdmin", "accessibility", "usageAccess", "smsRole",
  "alwaysOnVpn", "notifications", "batteryUnrestricted",
] as const;

type HealthRow = { key: string; label: string; detail: string; action?: boolean };

export function healthRows(phone: PhoneHealth, now: number, locale: "da" | "en", t: T): HealthRow[] {
  const seen = recent(phone.lastSeenAt, now);
  // A recent rules poll can arrive without a new status report. Use each timestamp separately.
  const status = seen && recent(phone.status?.reportedAt, now) ? phone.status : undefined;
  const unknown = t(seen ? "health.waitForReport" : "health.reconnect");
  const filter = status?.webFilterActive;
  const role = status?.protections?.phoneRole ?? (status?.callRoleActionNeeded ? false : undefined);
  const rows: HealthRow[] = [
    {
      key: "lock", label: t("health.lock"),
      detail: !status ? unknown : status.maintenance ? t("phone.maintenance") :
        status.lockIntact ? t("phone.lockIntact") : t("health.fixLock"),
      action: status?.lockIntact === false && !status.maintenance,
    },
    {
      key: "filter", label: t("health.filter"),
      detail: phone.dnsConfigured === false ? t("health.noFilterService") :
        phone.dnsReady === false ? t("health.filterWaiting") :
        !status ? unknown : filter === true ? t("health.filterOn") :
        filter === false ? t("health.fixFilter") : t("health.filterUnknown"),
      action: phone.dnsReady === true && filter === false,
    },
    {
      key: "dialer", label: t("prot.phoneRole"),
      detail: role === true ? t("health.phoneAppOn") :
        role === false ? t(status?.callRoleActionNeeded ? "phone.callRoleActionNeeded" : "health.fixPhoneApp") :
        status ? t("health.phoneAppUnknown") : unknown,
      action: role === false,
    },
    {
      key: "lastSeen", label: t("health.lastSeen"),
      detail: phone.lastSeenAt
        ? t(seen ? "health.seen" : "health.seenOffline", { when: formatRelative(phone.lastSeenAt, now, locale) })
        : t("health.neverSeen"),
    },
  ];
  if (phone.mode === "light") {
    for (const key of LIGHT_CHECKS) {
      const value = status?.protections?.[key];
      rows.push({
        key,
        label: t(`prot.${key}` as MessageKey),
        detail: value === true ? t("health.on") : value === false ?
          t(`health.fix.${key}`) : unknown,
        action: value === false && key !== "alwaysOnVpn" && key !== "notifications" && key !== "batteryUnrestricted",
      });
    }
  }
  return rows;
}
