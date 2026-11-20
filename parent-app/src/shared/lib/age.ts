// SPDX-License-Identifier: Apache-2.0
//
// Age presets, the review date and the family agreement (docs/age-presets.md,
// docs/family-agreement.md): the types of the API and the words for them, shared by the dashboard
// and the parent app. Platform-free.

import type { MessageKey, T } from "../i18n/translate";

export const AGE_PRESET_IDS = ["8-9", "10-11", "12-13", "14plus"] as const;
export type AgePresetId = (typeof AGE_PRESET_IDS)[number];

export const REVIEW_INTERVALS = [1, 2, 3, 6, 12] as const;
export const AGREEMENT_LINE_MAX = 140;
export const AGREEMENT_LINES_MAX = 8;
export const AGREEMENT_ADULT_LINES_MAX = 5;

export interface AgePreset {
  id: AgePresetId;
  dailyMinutes: { weekday: number; weekend: number };
  bedtime: { startMinute: number; endMinute: number };
  school: { startMinute: number; endMinute: number } | null;
  blockedCategories: string[];
}

export type AgeSuggestion =
  | { kind: "time"; from: number; to: number }
  | { kind: "bedtime"; from: number; to: number }
  | { kind: "school" }
  | { kind: "category"; category: string }
  | { kind: "talk" };

export interface ReviewState {
  enabled: boolean;
  intervalMonths: number;
  dueAt: string | null;
  due: boolean;
  suggestions: AgeSuggestion[];
}

export interface AgeState {
  agePreset: AgePresetId | null;
  review: ReviewState;
}

export interface Agreement {
  lines: string[];
  adultLines: string[];
  enabled: boolean;
  onHome: boolean;
  updatedAt: string | null;
}

const PRESET_NAME: Record<AgePresetId, MessageKey> = {
  "8-9": "age.preset.8-9",
  "10-11": "age.preset.10-11",
  "12-13": "age.preset.12-13",
  "14plus": "age.preset.14plus",
};

const CATEGORY_NAME: Record<string, MessageKey> = {
  social: "age.cat.social",
  adult: "age.cat.adult",
  gambling: "age.cat.gambling",
  games: "age.cat.games",
  dating: "age.cat.dating",
  video: "age.cat.video",
};

export const presetName = (t: T, id: AgePresetId) => t(PRESET_NAME[id]);
const categoryName = (t: T, category: string) => (CATEGORY_NAME[category] ? t(CATEGORY_NAME[category]!) : category);

/** "1 h 30 min" in the language's own units. */
export function durationText(t: T, minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t("age.duration.m", { m });
  return m === 0 ? t("age.duration.h", { h }) : t("age.duration.hm", { h, m });
}

/** Minutes after midnight as 24-hour clock time. */
export const clockText = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** What a preset sets, as short lines the parents can read before they choose it. */
export function presetLines(t: T, p: AgePreset): string[] {
  const lines = [
    t("age.summary.time", { weekday: durationText(t, p.dailyMinutes.weekday), weekend: durationText(t, p.dailyMinutes.weekend) }),
    t("age.summary.bedtime", { from: clockText(p.bedtime.startMinute), to: clockText(p.bedtime.endMinute) }),
    p.school
      ? t("age.summary.school", { from: clockText(p.school.startMinute), to: clockText(p.school.endMinute) })
      : t("age.summary.noSchool"),
  ];
  if (p.blockedCategories.length > 0) {
    lines.push(t("age.summary.blocked", { list: p.blockedCategories.map((c) => categoryName(t, c)).join(", ") }));
  }
  return lines;
}

/** One idea for what to open next, as a short sentence. */
export function suggestionText(t: T, s: AgeSuggestion): string {
  switch (s.kind) {
    case "time": return t("age.review.time", { from: durationText(t, s.from), to: durationText(t, s.to) });
    case "bedtime": return t("age.review.bedtime", { from: clockText(s.from), to: clockText(s.to) });
    case "school": return t("age.review.school");
    case "category": return t("age.review.category", { category: categoryName(t, s.category) });
    case "talk": return t("age.review.talk");
  }
}

/** The lines in a text box: one per row, trimmed, empty rows dropped. */
export const parseLines = (text: string): string[] =>
  text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 0);

export type LinesProblem = "tooLong" | "tooMany" | null;

export function linesProblem(lines: string[], max: number): LinesProblem {
  if (lines.length > max) return "tooMany";
  return lines.some((l) => l.length > AGREEMENT_LINE_MAX) ? "tooLong" : null;
}
