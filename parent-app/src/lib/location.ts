// SPDX-License-Identifier: Apache-2.0
//
// The location screen's logic, the same rules as web/src/pages/Location.tsx: "Find"
// asks the phone for a fresh position and polls until it answers; a ring and an
// "Are you okay?" are polled while something is still open on the phone.
import type { Checkin, Locale, LocationState, Ring } from "../api/models";
import type { TFn } from "../i18n/I18n";
import { formatClock, formatDateTime, intlLocale } from "../shared/lib/format";

export const POLL_MS = 5000;
export const FIND_TIMEOUT_MS = 90_000;
export const CHECKIN_MINUTES = [5, 10, 15, 30] as const;

/** A fix answers a request when it was recorded at or after the request. */
export function answers(loc: LocationState["location"], requestedAt: string): boolean {
  return Boolean(loc && new Date(loc.recordedAt).getTime() >= new Date(requestedAt).getTime());
}

/** Something on the phone is still open, so the screen keeps polling. */
export function needsPolling(s: LocationState): boolean {
  const c = s.checkin;
  return Boolean(s.ring?.active || c?.status === "waiting" || (c?.status === "noReply" && c.sendsLocation && !c.locatedAt));
}

/**
 * When "always" ends, as one line: "On until 14:05" today, "On until Tuesday 24 Nov at 14:05" on another day.
 * The end of "Today" is the phone's midnight, which reads best as "midnight" rather than "00:00 tomorrow".
 */
export function alwaysUntilText(iso: string, now: number, t: TFn, locale: Locale): string {
  const end = new Date(iso);
  const minute = end.getHours() * 60 + end.getMinutes();
  const time = formatClock(minute, locale);
  const day = (d: Date) => d.toDateString();
  const today = new Date(now);
  if (day(end) === day(today)) return t("native.alwaysUntil", { time });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (minute === 0 && day(end) === day(tomorrow)) return t("native.alwaysUntilMidnight");
  const date = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "long", day: "numeric", month: "short" }).format(end);
  return t("native.alwaysUntilDate", { date, time });
}

/** "4:05" */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What a ring or a check-in is doing, as one line of text. */
export interface StatusLine {
  /** Changes when the situation changes, not when the countdown ticks. Screen readers announce on change. */
  kind: string;
  text: string;
  /** Still open on the phone (a pulse dot, a stop button). */
  live: boolean;
  warn: boolean;
}

export function ringStatus(ring: Ring | null, now: number, t: TFn, locale: Locale): StatusLine | null {
  if (!ring) return null;
  const left = new Date(ring.endsAt).getTime() - now;
  const active = ring.active && left > 0;
  const time = (iso: string) => formatDateTime(iso, locale);
  const params = { left: countdown(left) };
  if (ring.answeredAt) {
    return {
      kind: active ? "answeredStillRinging" : "answered",
      text: t(active ? "ring.answeredStillRinging" : "ring.answered", { time: time(ring.answeredAt), ...params }),
      live: active,
      warn: false,
    };
  }
  if (active) {
    return { kind: ring.shownAt ? "ringing" : "waiting", text: t(ring.shownAt ? "ring.ringing" : "ring.waiting", params), live: true, warn: false };
  }
  if (ring.stoppedAt) return { kind: "stopped", text: t("ring.stoppedAt", { time: time(ring.stoppedAt) }), live: false, warn: false };
  return { kind: "noAnswer", text: t("ring.noAnswer"), live: false, warn: false };
}

export function checkinStatus(checkin: Checkin | null, now: number, t: TFn, locale: Locale): StatusLine | null {
  if (!checkin) return null;
  const time = (iso: string) => formatDateTime(iso, locale);
  switch (checkin.status) {
    case "waiting":
      return {
        kind: checkin.shownAt ? "shown" : "waiting",
        text: t(checkin.shownAt ? "checkin.shown" : "checkin.waiting", { left: countdown(new Date(checkin.deadline).getTime() - now) }),
        live: true,
        warn: false,
      };
    case "answered": {
      const call = checkin.answer === "call";
      return {
        kind: call ? "answeredCall" : "answeredOk",
        text: t(call ? "checkin.answeredCall" : "checkin.answeredOk", { time: time(checkin.answeredAt ?? checkin.createdAt) }),
        live: false,
        warn: false,
      };
    }
    case "cancelled":
      return { kind: "cancelled", text: t("checkin.cancelledAt", { time: time(checkin.stoppedAt ?? checkin.createdAt) }), live: false, warn: false };
    case "noReply":
      if (checkin.locatedAt) return { kind: "noReplyLocated", text: t("checkin.noReplyLocated", { time: time(checkin.locatedAt) }), live: false, warn: true };
      if (checkin.sendsLocation) return { kind: "noReplyLocating", text: t("checkin.noReplyLocating"), live: false, warn: true };
      return { kind: "noReply", text: t("checkin.noReply"), live: false, warn: true };
  }
}
