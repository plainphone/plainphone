// SPDX-License-Identifier: Apache-2.0
//
// Formatting helpers. Everything locale-dependent goes through Intl.

import type { Locale } from "./api";

export const intlLocale = (l: Locale) => (l === "da" ? "da-DK" : "en-GB");

export function minutesToHHMM(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "08:30" (from <input type="time">) to minutes after midnight. */
export function hhmmToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** A clock time in the user's format: 08:30 in English, 08.30 in Danish. */
export function formatClock(minute: number, locale: Locale): string {
  const d = new Date(Date.UTC(2024, 0, 1, Math.floor(minute / 60), minute % 60));
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(d);
}

/** A window crosses midnight when it ends at or before it starts. */
export function crossesMidnight(startMinute: number, endMinute: number): boolean {
  return endMinute <= startMinute;
}

export function formatDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** Android key attestation reports the OS security update as YYYYMM. */
export function formatPatchMonth(level: number | null | undefined, locale: Locale): string | null {
  if (!level || !Number.isInteger(level)) return null;
  const year = Math.floor(level / 100);
  const month = level % 100;
  if (year < 2000 || year > 9999 || month < 1 || month > 12) return null;
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1)));
}

/** ISO weekday (1 = Monday ... 7 = Sunday) to a localised name. */
export function weekdayName(isoDay: number, locale: Locale, width: "short" | "long" = "short"): string {
  // 1 January 2024 was a Monday.
  const d = new Date(Date.UTC(2024, 0, isoDay, 12));
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: width, timeZone: "UTC" }).format(d);
}

export interface DurationWords {
  hm: string; // "{h} h {m} min"
  h: string; // "{h} h"
  m: string; // "{m} min"
  lessThanMinute: string;
}

/**
 * A countdown such as "23 h" or "1 h 5 min". Minutes round up, so it never says 0 too early.
 * From 10 hours on, whole hours are enough (the longest delay is 72 hours).
 */
export function formatDuration(ms: number, w: DurationWords): string {
  const totalMin = Math.ceil(Math.max(0, ms) / 60_000);
  if (totalMin < 1) return w.lessThanMinute;
  const fill = (s: string, h: number, m: number) => s.replace("{h}", String(h)).replace("{m}", String(m));
  if (totalMin >= 600) return fill(w.h, Math.round(totalMin / 60), 0);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return fill(w.hm, h, m);
  if (h > 0) return fill(w.h, h, 0);
  return fill(w.m, 0, m);
}

/** "5 minutes ago", "yesterday" and so on. */
export function formatRelative(iso: string, now: number, locale: Locale): string {
  const diffSec = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86_400), "day");
}

export function formatMeters(m: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "unit",
    unit: m >= 1000 ? "kilometer" : "meter",
    maximumFractionDigits: m >= 1000 ? 1 : 0,
  }).format(m >= 1000 ? m / 1000 : m);
}

export function formatMoney(minor: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency, maximumFractionDigits: 0 }).format(
    minor / 100,
  );
}

export function formatList(items: string[], locale: Locale): string {
  return new Intl.ListFormat(intlLocale(locale), { style: "long", type: "conjunction" }).format(items);
}

export function formatCoord(n: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), { minimumFractionDigits: 5, maximumFractionDigits: 5 }).format(n);
}

/** OpenStreetMap link for a position. A plain link: no tiles, no third-party requests from the app. */
export function osmUrl(lat: number, lon: number): string {
  const la = lat.toFixed(5);
  const lo = lon.toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=17/${la}/${lo}`;
}

/** The pairing code as the phone shows it, e.g. "k7mp 4qxr" becomes "K7MP-4QXR". */
export function normaliseCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

/** Minutes as "45 min", "2 h" or "1 h 30 min". */
export function formatMinutes(min: number, w: DurationWords): string {
  const fill = (s: string, h: number, m: number) => s.replace("{h}", String(h)).replace("{m}", String(m));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return fill(w.hm, h, m);
  if (h > 0) return fill(w.h, h, 0);
  return fill(w.m, 0, m);
}

/** The minutes a limit gives on an ISO weekday. */
export function limitOn(limit: { minutes: number; days: Partial<Record<string, number>> }, isoDay: number): number {
  return limit.days[String(isoDay)] ?? limit.minutes;
}

/** Today's ISO weekday and date (YYYY-MM-DD) in a time zone. */
export function todayIn(timezone: string, now: Date = new Date()): { isoDay: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return { isoDay: days.indexOf(get("weekday")) + 1, date: `${get("year")}-${get("month")}-${get("day")}` };
}
