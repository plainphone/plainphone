// SPDX-License-Identifier: Apache-2.0
//
// Wall-clock time in an IANA time zone, for the weekly summary: "Sunday 18:00 in the
// household's zone" must stay 18:00 across a daylight-saving change, so a week is not always
// 168 hours long.

export interface LocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    if (formatters.size >= 32) formatters.delete(formatters.keys().next().value!);
    formatters.set(timeZone, f);
  }
  return f;
}

/** True for a name the runtime knows as a time zone. */
export function validTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock time at an instant. */
export function localTime(at: Date, timeZone: string): LocalTime {
  const parts = formatter(timeZone).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** Milliseconds the zone is ahead of UTC at an instant. */
function offsetAt(at: Date, timeZone: string): number {
  const t = at.getTime() - (at.getTime() % 1000);
  const p = formatter(timeZone).formatToParts(new Date(t));
  const get = (n: string) => Number(p.find((x) => x.type === n)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - t;
}

/**
 * The instant at which a zone's wall clock shows [local]. In the hour that does not exist
 * (spring forward) the time moves forward by the gap; in the hour that happens twice
 * (fall back) the first one is used.
 */
export function zonedTimeToUtc(local: LocalTime, timeZone: string): Date {
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const before = offsetAt(new Date(wall - 86_400_000), timeZone);
  const after = offsetAt(new Date(wall + 86_400_000), timeZone);
  const candidates = [wall - before, wall - after]
    .filter((t, i, all) => all.indexOf(t) === i)
    .filter((t) => {
      const l = localTime(new Date(t), timeZone);
      return l.year === local.year && l.month === local.month && l.day === local.day &&
        l.hour === local.hour && l.minute === local.minute;
    })
    .sort((a, b) => a - b);
  return new Date(candidates[0] ?? wall - before);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A calendar date as YYYY-MM-DD. */
export function dateKey(d: Pick<LocalTime, "year" | "month" | "day">): string {
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

/** The calendar date [days] from a date (negative = earlier), without any time zone in play. */
export function addDays(d: Pick<LocalTime, "year" | "month" | "day">, days: number): Pick<LocalTime, "year" | "month" | "day"> {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(d: Pick<LocalTime, "year" | "month" | "day">): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

export interface Schedule {
  /** 0 = Sunday ... 6 = Saturday. */
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}

export interface Occurrence {
  /** The instant. */
  at: Date;
  /** The local date it falls on. */
  date: string;
  /** The same wall-clock time one week earlier: the start of the period that ends at [at]. */
  previous: Date;
}

/** The first time at or after [from] when the weekly schedule is due. */
export function nextOccurrence(from: Date, s: Schedule): Date {
  const today = localTime(from, s.timeZone);
  for (let ahead = 0; ahead <= 8; ahead++) {
    const date = addDays(today, ahead);
    if (weekdayOf(date) !== s.day) continue;
    const at = zonedTimeToUtc({ ...date, hour: s.hour, minute: s.minute }, s.timeZone);
    if (at.getTime() >= from.getTime()) return at;
  }
  throw new Error("no occurrence found");
}

/** The most recent time at or before [now] when the weekly schedule is due. */
export function lastOccurrence(now: Date, s: Schedule): Occurrence {
  const today = localTime(now, s.timeZone);
  for (let back = 0; back <= 7; back++) {
    const date = addDays(today, -back);
    if (weekdayOf(date) !== s.day) continue;
    const at = zonedTimeToUtc({ ...date, hour: s.hour, minute: s.minute }, s.timeZone);
    if (at.getTime() > now.getTime()) continue;
    const earlier = addDays(date, -7);
    return { at, date: dateKey(date), previous: zonedTimeToUtc({ ...earlier, hour: s.hour, minute: s.minute }, s.timeZone) };
  }
  throw new Error("no occurrence found");
}
