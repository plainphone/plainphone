// SPDX-License-Identifier: Apache-2.0
//
// Age presets and the review date (docs/age-presets.md). The table below is the one place that
// says what each age starts with: setup, the phone's settings page and (later) modes read it.
// A preset only fills in values the parents can change afterwards; it locks nothing.

import { AGE_PRESET_IDS, type DnsCategory } from "../db/schema.js";
import { addDays, localTime, zonedTimeToUtc } from "./zoned-time.js";

export { AGE_PRESET_IDS };
export type AgePresetId = (typeof AGE_PRESET_IDS)[number];

export interface AgePreset {
  id: AgePresetId;
  /** Minutes a day on weekdays and at the weekend (Saturday and Sunday). */
  dailyMinutes: { weekday: number; weekend: number };
  /** Bedtime window, every day, in minutes after local midnight. It crosses midnight. */
  bedtime: { startMinute: number; endMinute: number };
  /** School time, Monday to Friday; null for no school window. */
  school: { startMinute: number; endMinute: number } | null;
  /** Categories the web filter blocks; the others are left open. */
  blockedCategories: DnsCategory[];
}

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

/** Starting points, not claims about what is right for a child: each family changes them. */
export const AGE_PRESETS: readonly AgePreset[] = [
  {
    id: "8-9",
    dailyMinutes: { weekday: 60, weekend: 90 },
    bedtime: { startMinute: h(19, 30), endMinute: h(7) },
    school: { startMinute: h(8), endMinute: h(14, 30) },
    blockedCategories: ["social", "adult", "gambling", "dating", "video"],
  },
  {
    id: "10-11",
    dailyMinutes: { weekday: 90, weekend: 120 },
    bedtime: { startMinute: h(20, 30), endMinute: h(7) },
    school: { startMinute: h(8), endMinute: h(14, 30) },
    blockedCategories: ["social", "adult", "gambling", "dating"],
  },
  {
    id: "12-13",
    dailyMinutes: { weekday: 120, weekend: 150 },
    bedtime: { startMinute: h(21), endMinute: h(7) },
    school: { startMinute: h(8), endMinute: h(14, 30) },
    blockedCategories: ["adult", "gambling", "dating"],
  },
  {
    id: "14plus",
    dailyMinutes: { weekday: 150, weekend: 180 },
    bedtime: { startMinute: h(22), endMinute: h(7) },
    school: null,
    blockedCategories: ["adult", "gambling"],
  },
];

export function agePreset(id: string | null | undefined): AgePreset | undefined {
  return AGE_PRESETS.find((p) => p.id === id);
}

/** The current rules as far as the suggestions look at them. */
export interface RulesSnapshot {
  weekdayMinutes: number | null;
  /** Start of the bedtime window (minutes after midnight), or null with no bedtime. */
  bedtimeStart: number | null;
  hasSchool: boolean;
  blockedCategories: DnsCategory[];
}

export type Suggestion =
  | { kind: "time"; from: number; to: number }
  | { kind: "bedtime"; from: number; to: number }
  | { kind: "school" }
  | { kind: "category"; category: DnsCategory }
  /** Nothing more to open next: talk about what the child would like to try, and about releasing the phone. */
  | { kind: "talk" };

export const MAX_SUGGESTIONS = 3;

/**
 * What the parents could open up next, from what is set now. The reference is the next preset
 * after the phone's own (or, with no preset, the first one that gives more time than today). It
 * only ever suggests something looser than the current rules, never a tighter value.
 */
export function suggestNext(current: RulesSnapshot, presetId: AgePresetId | null): Suggestion[] {
  const at = AGE_PRESETS.findIndex((p) => p.id === presetId);
  const next = at >= 0
    ? AGE_PRESETS[at + 1]
    : AGE_PRESETS.find((p) => current.weekdayMinutes !== null && p.dailyMinutes.weekday > current.weekdayMinutes);
  const out: Suggestion[] = [];
  if (next) {
    if (current.weekdayMinutes !== null && next.dailyMinutes.weekday > current.weekdayMinutes) {
      out.push({ kind: "time", from: current.weekdayMinutes, to: next.dailyMinutes.weekday });
    }
    if (current.bedtimeStart !== null && next.bedtime.startMinute > current.bedtimeStart) {
      out.push({ kind: "bedtime", from: current.bedtimeStart, to: next.bedtime.startMinute });
    }
    for (const category of current.blockedCategories) {
      if (!next.blockedCategories.includes(category)) out.push({ kind: "category", category });
    }
    if (current.hasSchool && next.school === null) out.push({ kind: "school" });
  }
  return out.length > 0 ? out.slice(0, MAX_SUGGESTIONS) : [{ kind: "talk" }];
}

/**
 * The review moment [months] calendar months after [from], at 09:00 on the phone's wall clock. A
 * day that does not exist in the later month (31 January + 1 month) becomes the month's last day,
 * and 09:00 follows the clock across daylight-saving changes.
 */
export function reviewDueAfter(from: Date, months: number, timeZone: string): Date {
  const start = localTime(from, timeZone);
  const index = start.year * 12 + (start.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const lastDay = addDays({ year: month === 12 ? year + 1 : year, month: month === 12 ? 1 : month + 1, day: 1 }, -1).day;
  return zonedTimeToUtc({ year, month, day: Math.min(start.day, lastDay), hour: 9, minute: 0 }, timeZone);
}
