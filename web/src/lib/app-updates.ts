// SPDX-License-Identifier: Apache-2.0
//
// What the parents see about app updates in strong mode (docs/policies.md, "App updates").
// Shared by the dashboard and the parent app.

import type { MessageKey } from "@plainphone/i18n/translate";
import { formatDateTime, intlLocale } from "./format";
import type { Locale } from "./api";

/** The phone's report of its last app update window (`status.appUpdates`). */
export interface AppUpdateWindow {
  id: string;
  trigger: "night" | "parent";
  openedAt: string | null;
  closedAt: string | null;
  updated: number;
  caught: string[];
  error?: "batteryExemption" | "failed";
}

export interface AppUpdateLine {
  key: MessageKey;
  params?: Record<string, string | number>;
  tone: "normal" | "warn";
}

/** The lines under "App updates", in reading order. */
export function appUpdateLines(window: AppUpdateWindow | undefined, locale: Locale): AppUpdateLine[] {
  if (!window) return [{ key: "appUpdates.none", tone: "normal" }];
  if (window.error || !window.openedAt) {
    return [{ key: window.error === "batteryExemption" ? "appUpdates.failedBattery" : "appUpdates.failed", tone: "warn" }];
  }
  const lines: AppUpdateLine[] = window.closedAt
    ? [{
        key: "appUpdates.last",
        params: { from: formatDateTime(window.openedAt, locale), to: endTime(window.openedAt, window.closedAt, locale), count: window.updated },
        tone: "normal",
      }]
    : [{ key: "appUpdates.open", params: { time: formatDateTime(window.openedAt, locale) }, tone: "normal" }];
  if (window.caught.length > 0) lines.push({ key: "appUpdates.caught", params: { count: window.caught.length }, tone: "warn" });
  return lines;
}

/** The longest a window stays open on the phone (InstallLease.APP_UPDATES_MAX_MS). */
export const APP_UPDATE_WINDOW_MS = 45 * 60_000;

/**
 * The line under the rule receipt while a window is open: for a while the phone shows Play and
 * allows updates, which the confirmed rules alone do not say. Null when no window is open.
 */
export function appUpdateReceiptLine(window: AppUpdateWindow | undefined, now: number, locale: Locale): AppUpdateLine | null {
  if (!window?.openedAt || window.closedAt || window.error) return null;
  const until = Date.parse(window.openedAt) + APP_UPDATE_WINDOW_MS;
  if (until <= now) return null;
  const time = new Intl.DateTimeFormat(intlLocale(locale), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(until));
  return { key: "appUpdates.receipt", params: { time }, tone: "normal" };
}

/** The end of a window: only the clock when it ends on the day it started. */
function endTime(openedAt: string, closedAt: string, locale: Locale): string {
  const day = (iso: string) => new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "short" }).format(new Date(iso));
  if (day(openedAt) !== day(closedAt)) return formatDateTime(closedAt, locale);
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(closedAt));
}
