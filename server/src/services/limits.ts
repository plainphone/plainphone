// SPDX-License-Identifier: Apache-2.0
//
// Daily time limits (docs/time-limits.md). A limit is minutes per day, with optional
// overrides per ISO weekday. Bonuses add minutes to one local date.

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type LimitDays, phoneApps, timeBonuses, timeLimits } from "../db/schema.js";
import { packageName } from "../lib/validation.js";
import type { Ctx } from "./context.js";

type DbLike = Ctx["db"] | Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

export const TOTAL = "*";
const WEEKDAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;
const minutes = z.number().int().min(0).max(1440);

export const limitInput = z.object({
  minutes,
  days: z.partialRecord(z.enum(WEEKDAYS), minutes).default({}),
});
export type Limit = { minutes: number; days: LimitDays };

/** "*" (the total cap) or an Android package name. */
export const limitTarget = z.union([z.literal(TOTAL), packageName]);

/** Minutes allowed on an ISO weekday, before bonuses. */
export function minutesOn(limit: Limit, weekday: number): number {
  return limit.days[String(weekday) as (typeof WEEKDAYS)[number]] ?? limit.minutes;
}

/**
 * A change loosens when it gives more time on any weekday, or removes a limit.
 * Adding a limit or lowering one tightens.
 */
export function limitLoosens(before: Limit | null, after: Limit | null): boolean {
  if (!before) return false;
  if (!after) return true;
  return [1, 2, 3, 4, 5, 6, 7].some((d) => minutesOn(after, d) > minutesOn(before, d));
}

// Reuse ICU formatters without retaining every time zone customers have used.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** The local calendar date (YYYY-MM-DD) in a time zone. */
export function localDate(timezone: string, now: Date): string {
  let formatter = dateFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    if (dateFormatters.size >= 32) dateFormatters.delete(dateFormatters.keys().next().value!);
    dateFormatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const limitJson = (r: { minutes: number; days: LimitDays }): Limit => ({
  minutes: r.minutes,
  // Stable key order, so the rules ETag does not depend on how jsonb stored it.
  days: Object.fromEntries(Object.entries(r.days ?? {}).sort(([a], [b]) => a.localeCompare(b))) as LimitDays,
});

/** Limits and today's and tomorrow's bonuses for a phone, as the rules document and the parent API show them. */
export async function loadTimeLimits(db: DbLike, phone: { id: string; timezone: string }, now: Date) {
  const today = localDate(phone.timezone, now);
  const days = [today, addDays(today, 1)];
  const [rows, bonusRows] = await Promise.all([
    db
      .select({ packageName: timeLimits.packageName, minutes: timeLimits.minutes, days: timeLimits.days })
      .from(timeLimits)
      .where(eq(timeLimits.phoneId, phone.id))
      .orderBy(timeLimits.packageName),
    db
      .select({ packageName: timeBonuses.packageName, day: timeBonuses.day, minutes: timeBonuses.minutes })
      .from(timeBonuses)
      .where(and(eq(timeBonuses.phoneId, phone.id), inArray(timeBonuses.day, days)))
      .orderBy(timeBonuses.day, timeBonuses.packageName, timeBonuses.createdAt),
  ]);
  const total = rows.find((r) => r.packageName === TOTAL);
  return {
    today,
    total: total ? limitJson(total) : null,
    apps: rows.filter((r) => r.packageName !== TOTAL).map((r) => ({ packageName: r.packageName, limit: limitJson(r) })),
    bonuses: bonusRows.map((b) => ({ packageName: b.packageName, date: b.day, minutes: b.minutes })),
  };
}

/** Labels for limited apps, from what the phone reported. */
export async function appLabels(db: DbLike, phoneId: string, packages: string[]): Promise<Map<string, string>> {
  if (packages.length === 0) return new Map();
  const rows = await db
    .select({ p: phoneApps.packageName, label: phoneApps.label })
    .from(phoneApps)
    .where(and(eq(phoneApps.phoneId, phoneId), inArray(phoneApps.packageName, packages)));
  return new Map(rows.map((r) => [r.p, r.label]));
}
