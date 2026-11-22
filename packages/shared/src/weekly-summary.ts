// SPDX-License-Identifier: Apache-2.0
//
// The weekly summary (docs/weekly-summary.md): the shape the server sends, and the short lines
// the dashboard and the parent app show for each phone. Shared with the parent app.

import type { MessageKey, T } from "@plainphone/i18n/translate";
import type { Locale } from "./models";
import { formatMinutes, intlLocale, weekdayName } from "./format";

export type ChangeCategory = "time" | "apps" | "contacts" | "web" | "schedules" | "other";

export interface PhoneWeek {
  phoneId: string;
  name: string;
  usage: null | {
    days: { day: string; minutes: number }[];
    averageMinutes: number;
    topApps: { packageName: string; label: string; minutes: number }[];
  };
  requests: { asked: number; approved: number; rejected: number; byKind: Record<string, number> };
  changes: { total: number; byCategory: Partial<Record<ChangeCategory, number>> };
  events: { protection: number; offline: number; checkin: number };
}

export interface WeeklySummary {
  id: string;
  /** The local date the summary was due (the last day it covers). */
  weekEnd: string;
  periodStart: string;
  periodEnd: string;
  data: { version: number; phones: PhoneWeek[] };
}

export interface SummarySettings {
  enabled: boolean;
  byMail: boolean;
  byPush: boolean;
  actNowOnly: boolean;
  /** 0 = Sunday. */
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
  mailEnabled: boolean;
}

const categoryKey: Record<ChangeCategory, MessageKey> = {
  time: "summary.cat.time",
  apps: "summary.cat.apps",
  contacts: "summary.cat.contacts",
  web: "summary.cat.web",
  schedules: "summary.cat.schedules",
  other: "summary.cat.other",
};

/** The short lines for one phone. A quiet week is a short list. */
export function phoneWeekLines(p: PhoneWeek, t: T): string[] {
  const w = { hm: t("duration.hm"), h: t("duration.h"), m: t("duration.m"), lessThanMinute: t("duration.lessThanMinute") };
  const lines: string[] = [];
  lines.push(p.usage ? t("summary.screen", { time: formatMinutes(p.usage.averageMinutes, w) }) : t("summary.screenNone"));
  if (p.usage && p.usage.topApps.length > 0) {
    lines.push(t("summary.topApps", { apps: p.usage.topApps.map((a) => `${a.label} (${formatMinutes(a.minutes, w)})`).join(", ") }));
  }
  const answered = p.requests.approved + p.requests.rejected;
  lines.push(p.requests.asked === 0 && answered === 0 ? t("summary.requestsNone") : t("summary.requests", { asked: p.requests.asked, answered }));
  if (p.changes.total === 0) lines.push(t("summary.changesNone"));
  else {
    const parts = (Object.entries(p.changes.byCategory) as [ChangeCategory, number][])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([c, n]) => t(categoryKey[c] ?? categoryKey.other, { n }))
      .join(", ");
    lines.push(parts ? t("summary.changesIn", { n: p.changes.total, parts }) : t("summary.changes", { n: p.changes.total }));
  }
  lines.push(p.events.protection > 0 ? t("summary.protection", { n: p.events.protection }) : t("summary.protectionNone"));
  if (p.events.offline > 0) lines.push(t("summary.offline", { n: p.events.offline }));
  if (p.events.checkin > 0) lines.push(t("summary.checkins", { n: p.events.checkin }));
  return lines;
}

/** "Sunday" for day 0, in the reader's language. */
export function summaryDayName(day: number, locale: Locale): string {
  return weekdayName(day === 0 ? 7 : day, locale, "long");
}

/** "18:00". */
export function summaryTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "Sunday 29 Nov", from the local date the first summary comes. */
export function summaryFirstDate(date: string, locale: Locale): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
  return fmt.format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** The seven days a summary covers as "9 Nov to 15 Nov", from the local date it was due. */
export function summaryRange(weekEnd: string, locale: Locale, t: T): string {
  const [y, m, d] = weekEnd.split("-").map(Number) as [number, number, number];
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", timeZone: "UTC" });
  return t("summary.range", {
    from: fmt.format(new Date(Date.UTC(y, m - 1, d - 6, 12))),
    to: fmt.format(new Date(Date.UTC(y, m - 1, d, 12))),
  });
}
