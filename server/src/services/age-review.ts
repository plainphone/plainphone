// SPDX-License-Identifier: Apache-2.0
//
// Age presets, the review date and the family agreement (docs/age-presets.md,
// docs/family-agreement.md). A preset is applied through the same changes as any other rule edit
// (submitChange), so the rules, the phone's wake-up and the weekly summary behave as usual.

import { and, asc, eq, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { dnsSettings, DNS_CATEGORIES, householdMembers, households, phones, schedules, timeLimits, users } from "../db/schema.js";
import {
  AGE_PRESETS, agePreset, type AgePresetId, type RulesSnapshot, type Suggestion, suggestNext, reviewDueAfter,
} from "../lib/age-presets.js";
import { toLocale } from "../lib/locale.js";
import { reviewReminderMail } from "../lib/review-mail.js";
import { localTime, validTimeZone, zonedTimeToUtc } from "../lib/zoned-time.js";
import { type ChangeResult, submitChange } from "./changes.js";
import type { Ctx } from "./context.js";
import { TOTAL } from "./limits.js";
import { notifyUsers } from "./notifications.js";
import { nextRulesRevision, wakePhone } from "./phones.js";

type Phone = typeof phones.$inferSelect;

export const REVIEW_INTERVALS = [1, 2, 3, 6, 12] as const;
export const DEFAULT_REVIEW_MONTHS = 3;
export const AGREEMENT_LINE_MAX = 140;
export const AGREEMENT_LINES_MAX = 8;
export const AGREEMENT_ADULT_LINES_MAX = 5;

const zoneOf = (phone: Pick<Phone, "timezone">) => (validTimeZone(phone.timezone) ? phone.timezone : "UTC");

/** The rules the suggestions compare against. */
export async function currentRules(ctx: Ctx, phoneId: string): Promise<RulesSnapshot> {
  const [limit] = await ctx.db.select().from(timeLimits)
    .where(and(eq(timeLimits.phoneId, phoneId), eq(timeLimits.packageName, TOTAL)));
  const bedtime = await ctx.db.select().from(schedules)
    .where(and(eq(schedules.phoneId, phoneId), eq(schedules.kind, "bedtime"))).orderBy(asc(schedules.createdAt));
  const school = await ctx.db.select({ id: schedules.id }).from(schedules)
    .where(and(eq(schedules.phoneId, phoneId), eq(schedules.kind, "school"))).limit(1);
  const [dns] = await ctx.db.select({ blocked: dnsSettings.blockedCategories }).from(dnsSettings).where(eq(dnsSettings.phoneId, phoneId));
  return {
    weekdayMinutes: limit?.minutes ?? null,
    bedtimeStart: bedtime[0]?.startMinute ?? null,
    hasSchool: school.length > 0,
    blockedCategories: DNS_CATEGORIES.filter((c) => dns?.blocked.includes(c)),
  };
}

/**
 * Applies a preset to a Child phone: the daily cap, bedtime, school time and the blocked web
 * categories become the preset's values. With modes on, bedtime and school time are left alone.
 * Everything stays editable. Applying counts as a review.
 */
export async function applyAgePreset(ctx: Ctx, phone: Phone, userId: string, id: AgePresetId): Promise<ChangeResult[]> {
  const preset = agePreset(id)!;
  const results: ChangeResult[] = [];
  const submit = async (op: Parameters<typeof submitChange>[3]) => { results.push(await submitChange(ctx, phone, userId, op)); };

  await submit({
    type: "timeLimit.set",
    packageName: TOTAL,
    limit: { minutes: preset.dailyMinutes.weekday, days: { "6": preset.dailyMinutes.weekend, "7": preset.dailyMinutes.weekend } },
  });

  const existing = await ctx.db.select().from(schedules).where(eq(schedules.phoneId, phone.id)).orderBy(asc(schedules.createdAt));
  const window = async (kind: "bedtime" | "school", days: number[], w: { startMinute: number; endMinute: number } | null) => {
    const current = existing.find((s) => s.kind === kind);
    if (!w) {
      if (current) await submit({ type: "schedule.delete", scheduleId: current.id });
      return;
    }
    const schedule = { kind, days, startMinute: w.startMinute, endMinute: w.endMinute, allowedPackages: current?.allowedPackages ?? [] };
    if (current) await submit({ type: "schedule.update", scheduleId: current.id, schedule });
    else await submit({ type: "schedule.create", schedule });
  };
  // With modes on, bedtime and school time are slots of the phone's modes (docs/modes.md). A preset
  // fills in the normal rules only (the default mode: daily time and web filter) and leaves the
  // slots, and the school and bedtime windows kept for when modes go off, as they are.
  if (!phone.modesEnabled) {
    await window("bedtime", [1, 2, 3, 4, 5, 6, 7], preset.bedtime);
    await window("school", [1, 2, 3, 4, 5], preset.school);
  }

  const [dns] = await ctx.db.select({ blocked: dnsSettings.blockedCategories }).from(dnsSettings).where(eq(dnsSettings.phoneId, phone.id));
  for (const category of DNS_CATEGORIES) {
    const blocked = preset.blockedCategories.includes(category);
    if (dns?.blocked.includes(category) !== blocked) await submit({ type: "dns.category", category, blocked });
  }

  await ctx.db.transaction(async (tx) => {
    const [fresh] = await tx.select().from(phones).where(eq(phones.id, phone.id)).for("update");
    const restart = fresh?.reviewEnabled ? { reviewDueAt: reviewDueAfter(ctx.now(), fresh.reviewIntervalMonths, zoneOf(phone)), reviewRemindedFor: null } : {};
    await tx.update(phones).set({ agePreset: id, ...restart }).where(eq(phones.id, phone.id));
  });
  return results;
}

export interface ReviewState {
  enabled: boolean;
  intervalMonths: number;
  /** When the reminder is due (the phone's wall-clock 09:00), or null with the reminder off. */
  dueAt: string | null;
  /** The date has come: the dashboard shows a calm "time to review" note. */
  due: boolean;
  suggestions: Suggestion[];
}

export async function reviewState(ctx: Ctx, phone: Phone): Promise<ReviewState> {
  const due = phone.reviewEnabled && phone.reviewDueAt !== null && phone.reviewDueAt.getTime() <= ctx.now().getTime();
  return {
    enabled: phone.reviewEnabled,
    intervalMonths: phone.reviewIntervalMonths,
    dueAt: phone.reviewEnabled ? phone.reviewDueAt?.toISOString() ?? null : null,
    due,
    suggestions: phone.reviewEnabled ? suggestNext(await currentRules(ctx, phone.id), phone.agePreset) : [],
  };
}

export class ReviewError extends Error {
  constructor(readonly status: 400 | 409, message: string) {
    super(message);
  }
}

export interface ReviewInput {
  enabled?: boolean;
  intervalMonths?: number;
  /** A local date (YYYY-MM-DD) in the phone's time zone; the reminder comes at 09:00 that day. */
  dueDate?: string;
}

/** Turns the reminder on or off, changes how often it comes or moves the date. Turning it on starts the clock. */
export async function setReview(ctx: Ctx, phone: Phone, input: ReviewInput): Promise<void> {
  const zone = zoneOf(phone);
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const [fresh] = await tx.select().from(phones).where(eq(phones.id, phone.id)).for("update");
    if (!fresh) return;
    const enabled = input.enabled ?? fresh.reviewEnabled;
    const interval = input.intervalMonths ?? fresh.reviewIntervalMonths;
    let dueAt: Date | null = fresh.reviewDueAt;
    if (input.dueDate !== undefined) {
      const [y, m, d] = input.dueDate.split("-").map(Number) as [number, number, number];
      const day = new Date(Date.UTC(y, m - 1, d));
      if (day.getUTCFullYear() !== y || day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d) throw new ReviewError(400, "not a date");
      const local = localTime(now, zone);
      if (Date.UTC(y, m - 1, d) < Date.UTC(local.year, local.month - 1, local.day)) throw new ReviewError(400, "the date is in the past");
      dueAt = zonedTimeToUtc({ year: y, month: m, day: d, hour: 9, minute: 0 }, zone);
    } else if (enabled && (!fresh.reviewEnabled || dueAt === null || input.intervalMonths !== undefined)) {
      dueAt = reviewDueAfter(now, interval, zone);
    }
    if (!enabled && input.dueDate !== undefined) throw new ReviewError(409, "the reminder is off");
    await tx.update(phones).set({
      reviewEnabled: enabled,
      reviewIntervalMonths: interval,
      reviewDueAt: enabled ? dueAt : null,
      // Only a new date earns a new reminder; resending the same settings must not repeat one.
      ...(enabled && dueAt?.getTime() === fresh.reviewDueAt?.getTime() ? {} : { reviewRemindedFor: null }),
    }).where(eq(phones.id, phone.id));
  });
}

/** "We looked at the rules": the next review is one interval away. */
export async function markReviewed(ctx: Ctx, phone: Phone): Promise<void> {
  if (!phone.reviewEnabled) throw new ReviewError(409, "the reminder is off");
  await ctx.db.update(phones).set({
    reviewDueAt: reviewDueAfter(ctx.now(), phone.reviewIntervalMonths, zoneOf(phone)),
    reviewRemindedFor: null,
  }).where(eq(phones.id, phone.id));
}

/**
 * Sends each due reminder once: push and mail follow the household's summary channels, the same
 * "by email / by notification" switches the parents already chose for calm news. A date that was
 * reminded is claimed before sending, so a restart or a second server cannot repeat it.
 */
export async function sweepReviewReminders(ctx: Ctx): Promise<number> {
  const claimed = await ctx.db.update(phones)
    .set({ reviewRemindedFor: sql`${phones.reviewDueAt}` })
    .where(and(
      eq(phones.reviewEnabled, true),
      eq(phones.profile, "child"),
      isNotNull(phones.reviewDueAt),
      lte(phones.reviewDueAt, ctx.now()),
      isNull(phones.releaseRequestedAt),
      or(isNull(phones.reviewRemindedFor), ne(phones.reviewRemindedFor, phones.reviewDueAt)),
    ))
    .returning();
  for (const phone of claimed) {
    try {
      await sendReminder(ctx, phone);
    } catch (err) {
      console.error(`review reminder failed: ${(err as Error).message}`);
    }
  }
  return claimed.length;
}

async function sendReminder(ctx: Ctx, phone: Phone) {
  const [h] = await ctx.db.select().from(households).where(eq(households.id, phone.householdId));
  if (!h) return;
  const members = await ctx.db
    .select({ id: users.id, email: users.email, locale: users.locale })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, h.id));
  const suggestions = suggestNext(await currentRules(ctx, phone.id), phone.agePreset);
  if (h.summaryByMail && ctx.mail.canSend) {
    for (const m of members) {
      try {
        await ctx.mail.send(reviewReminderMail(m.email, toLocale(m.locale), ctx.cfg.PUBLIC_URL, phone, suggestions));
      } catch (err) {
        console.error(`review mail failed: ${(err as Error).message}`);
      }
    }
  }
  if (h.summaryByPush) {
    await notifyUsers(ctx, members.map((m) => m.id), { type: "review", phoneId: phone.id, phoneName: phone.name }, { respectMuteFor: phone.id });
  }
}

// --- Family agreement ------------------------------------------------------------------------

export interface AgreementInput {
  lines?: string[];
  adultLines?: string[];
  enabled?: boolean;
  onHome?: boolean;
}

/** One line of the family's own words: trimmed, no control characters, one line. */
export function cleanLine(line: string): string {
  return line.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
}

export function cleanLines(lines: string[], max: number): string[] {
  const out = lines.map(cleanLine).filter((l) => l.length > 0);
  if (out.length > max || out.some((l) => l.length > AGREEMENT_LINE_MAX)) throw new ReviewError(400, "too many or too long lines");
  return out;
}

export async function setAgreement(ctx: Ctx, phone: Phone, input: AgreementInput): Promise<void> {
  const lines = input.lines === undefined ? undefined : cleanLines(input.lines, AGREEMENT_LINES_MAX);
  const adultLines = input.adultLines === undefined ? undefined : cleanLines(input.adultLines, AGREEMENT_ADULT_LINES_MAX);
  await ctx.db.update(phones).set({
    ...(lines !== undefined ? { agreementLines: lines } : {}),
    ...(adultLines !== undefined ? { agreementAdultLines: adultLines } : {}),
    ...(input.enabled !== undefined ? { agreementEnabled: input.enabled } : {}),
    ...(input.onHome !== undefined ? { agreementOnHome: input.onHome } : {}),
    agreementUpdatedAt: ctx.now(),
    ...nextRulesRevision(),
  }).where(eq(phones.id, phone.id));
  await wakePhone(ctx, phone.id, "rules");
}

export function agreementJson(phone: Pick<Phone, "agreementLines" | "agreementAdultLines" | "agreementEnabled" | "agreementOnHome" | "agreementUpdatedAt">) {
  return {
    lines: phone.agreementLines,
    adultLines: phone.agreementAdultLines,
    enabled: phone.agreementEnabled,
    onHome: phone.agreementOnHome,
    updatedAt: phone.agreementUpdatedAt?.toISOString() ?? null,
  };
}

/** The agreement as the child's phone gets it in the rules: only while on and with some words. Child phones only. */
export function agreementRules(phone: Pick<Phone, "profile" | "agreementLines" | "agreementAdultLines" | "agreementEnabled" | "agreementOnHome" | "agreementUpdatedAt">) {
  if (phone.profile !== "child" || !phone.agreementEnabled) return undefined;
  if (phone.agreementLines.length === 0 && phone.agreementAdultLines.length === 0) return undefined;
  return {
    lines: phone.agreementLines,
    adultLines: phone.agreementAdultLines,
    onHome: phone.agreementOnHome,
    updatedAt: phone.agreementUpdatedAt?.toISOString() ?? null,
  };
}

export const presetsJson = () => AGE_PRESETS.map((p) => ({
  id: p.id,
  dailyMinutes: p.dailyMinutes,
  bedtime: p.bedtime,
  school: p.school,
  blockedCategories: p.blockedCategories,
}));
