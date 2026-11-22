// SPDX-License-Identifier: Apache-2.0
//
// Pending changes described in plain words, e.g. "Show Instagram" or "Allow example.com".

import type { MessageKey, T } from "@plainphone/i18n/translate";
import type { DnsCategory, Locale, Op, ScheduleInput } from "./api";
import { formatClock, formatList, formatMinutes, weekdayName } from "./format";
import { formatSettingValue, settingName } from "./settings";

export function categoryLabel(c: DnsCategory, t: T): string {
  return t(`filter.cat.${c}` as MessageKey);
}

export function formatDays(days: number[], locale: Locale, t: T): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const key = sorted.join(",");
  if (key === "1,2,3,4,5,6,7") return t("sched.everyDay");
  if (key === "1,2,3,4,5") return t("sched.weekdays");
  if (key === "6,7") return t("sched.weekend");
  return formatList(
    sorted.map((d) => weekdayName(d, locale, "short")),
    locale,
  );
}

export function formatWindow(s: Pick<ScheduleInput, "startMinute" | "endMinute">, locale: Locale, t: T): string {
  return t("sched.time", { start: formatClock(s.startMinute, locale), end: formatClock(s.endMinute, locale) });
}

export function kindLabel(kind: ScheduleInput["kind"], t: T): string {
  return t(kind === "school" ? "sched.kind.school" : "sched.kind.bedtime");
}

/** Danish weekdays are lowercase mid-sentence; English ones keep their capital, "every day" does not. */
function daysInSentence(days: string, locale: Locale): string {
  if (locale === "da") return days.toLocaleLowerCase("da-DK");
  return days.startsWith("Every ") ? days.toLowerCase() : days;
}

/**
 * Describes an op. `appLabel` turns a package name into the app's name when it is known.
 */
export function describeOp(op: Op, t: T, locale: Locale, appLabel: (pkg: string) => string = (p) => p): string {
  switch (op.type) {
    case "app.set":
      return t(op.allowed ? "op.appShow" : "op.appHide", { app: appLabel(op.packageName) });
    case "contact.add":
      return t("op.contactAdd", { name: op.name, number: op.number });
    case "contact.schedule":
      return t(op.restricted ? "contacts.restrictOn" : "contacts.restrictOff");
    case "contact.remove":
      return t("op.contactRemove");
    case "dns.method":
      return t(op.method === "privateDns" ? "filter.privateDns" : "filter.vpn");
    case "dns.category":
      return t(op.blocked ? "op.categoryOn" : "op.categoryOff", {
        category: categoryLabel(op.category, t).toLocaleLowerCase(locale === "da" ? "da-DK" : "en-GB"),
      });
    case "openMode.set":
      return t(op.enabled ? "op.openOn" : "op.openOff");
    case "openMode.category":
      return t(op.blocked ? "op.openCategoryBlock" : "op.openCategoryAllow", {
        category: t(`open.cat.${op.category}` as MessageKey).toLocaleLowerCase(locale === "da" ? "da-DK" : "en-GB"),
      });
    case "dns.allowDomain":
      return t(op.present ? "op.allowAdd" : "op.allowRemove", { domain: op.domain });
    case "dns.blockDomain":
      return t(op.present ? "op.blockAdd" : "op.blockRemove", { domain: op.domain });
    case "schedule.create":
    case "schedule.update":
      return t(op.type === "schedule.create" ? "op.scheduleCreate" : "op.scheduleUpdate", {
        kind: kindLabel(op.schedule.kind, t).toLocaleLowerCase(locale === "da" ? "da-DK" : "en-GB"),
        days: daysInSentence(formatDays(op.schedule.days, locale, t), locale),
        time: formatWindow(op.schedule, locale, t),
      });
    case "schedule.delete":
      return t("op.scheduleDelete");
    case "setting.set": {
      const setting = settingName(op.key, t);
      const { mode, value } = op.setting;
      if (mode === "free") return t("op.settingFree", { setting });
      const shown = value === undefined ? null : formatSettingValue(op.key, value, t);
      if (mode === "preset") return t("op.settingPreset", { setting, value: shown ?? "" });
      return shown === null ? t("op.settingLock", { setting }) : t("op.settingLockValue", { setting, value: shown });
    }
    case "home.set":
      return t("op.homeSet");
    case "key.set":
      return op.key.keyType === "trusted"
        ? t("op.keyTrusted", { email: op.key.trustedEmail ?? "" })
        : t("op.keyDelay", { hours: op.key.delayHours });
    case "emergency.set":
      return op.enabled ? t("op.emergencyOn", { n: op.allowance }) : t("op.emergencyOff");
    case "phone.remove":
      return t("op.phoneRemove");
    case "move.allow":
      return t("move.allow");
    case "move.start":
      return t("move.approval", { server: op.serverUrl });
    case "phone.release":
      return t("op.phoneRelease");
    case "timeLimit.set": {
      const total = op.packageName === "*";
      if (!op.limit) return total ? t("op.limitTotalRemove") : t("op.limitAppRemove", { app: appLabel(op.packageName) });
      const time = formatMinutes(op.limit.minutes, minuteWords(t));
      const more = Object.keys(op.limit.days).length > 0 ? t("op.limitSomeDays") : "";
      return (total ? t("op.limitTotal", { time }) : t("op.limitApp", { app: appLabel(op.packageName), time })) + more;
    }
    case "timeLimit.bonus":
      return op.packageName === "*"
        ? t("op.bonusTotal", { minutes: op.minutes })
        : t("op.bonusApp", { app: appLabel(op.packageName), minutes: op.minutes });
    case "catalog.add":
      return t("op.catalogAdd", { app: op.label });
    case "catalog.remove":
      return t("op.catalogRemove", { app: appLabel(op.packageName) });
  }
}

export function minuteWords(t: T) {
  return { hm: t("duration.hm"), h: t("duration.h"), m: t("duration.m"), lessThanMinute: t("duration.lessThanMinute") };
}
