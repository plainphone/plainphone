// SPDX-License-Identifier: Apache-2.0
//
// The weekly summary (docs/weekly-summary.md): one calm overview per household and week
// instead of a stream of alerts. The sweeper builds it when the household's chosen day and
// time arrive and delivers it once, by mail and/or push. What goes in is only what the
// parents can already see: numbers, and app names from the phone's own list.

import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  householdMembers,
  householdSummaries,
  households,
  phoneApps,
  moreTimeRequests,
  phoneRequests,
  phones,
  phoneUsageDays,
  summaryEvents,
  users,
} from "../db/schema.js";
import { addDays, dateKey, lastOccurrence, localTime, nextOccurrence, validTimeZone } from "../lib/zoned-time.js";
import { weeklySummaryMail } from "../lib/summary-mail.js";
import { toSummaryLocale, type ChangeCategory } from "../lib/summary-text.js";
import type { Ctx } from "./context.js";
import { TOTAL } from "./limits.js";
import { notifyUsers } from "./notifications.js";

type Db = Ctx["db"] | Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

/** Built summaries are kept this long: the dashboard shows the last 8 weeks. */
export const SUMMARY_KEEP_WEEKS = 8;
/** A summary that could not be built on time (server down) is still built up to this long after. */
export const SUMMARY_CATCH_UP_MS = 3 * 86_400_000;
/** Daily use and events are kept this long, a little more than the weeks a summary can reach back. */
export const SUMMARY_RAW_KEEP_DAYS = 21;
/** Two summaries of a household are at least this far apart, whatever day the parents move it to. */
const MIN_GAP_MS = 5 * 86_400_000;
/** The first summary waits for this much history, so it is never nearly empty. */
const FIRST_SUMMARY_MIN_MS = 7 * 86_400_000;
const TOP_APPS = 3;

export interface PhoneSummary {
  phoneId: string;
  name: string;
  /** Null when the phone reported no use that week (use is reported when a limit is set). */
  usage: null | {
    /** Local dates with a report, with the day's total in minutes. */
    days: { day: string; minutes: number }[];
    averageMinutes: number;
    topApps: { packageName: string; label: string; minutes: number }[];
  };
  requests: { asked: number; approved: number; rejected: number; byKind: Record<string, number> };
  changes: { total: number; byCategory: Partial<Record<ChangeCategory, number>> };
  events: { protection: number; offline: number; checkin: number };
}

export interface SummaryData {
  version: 1;
  phones: PhoneSummary[];
}

/** Builds the numbers for one household and period. Pure reads, so it can run again. */
export async function buildSummary(
  db: Db,
  householdId: string,
  period: { start: Date; end: Date; lastDate: string },
): Promise<SummaryData> {
  const phoneRows = await db
    .select({ id: phones.id, name: phones.name, enabled: phones.weeklySummaryEnabled })
    .from(phones)
    .where(eq(phones.householdId, householdId))
    .orderBy(phones.createdAt, phones.id);
  const included = phoneRows.filter((p) => p.enabled);
  const ids = included.map((p) => p.id);
  if (ids.length === 0) return { version: 1, phones: [] };
  const [y, m, d] = period.lastDate.split("-").map(Number) as [number, number, number];
  // The seven full days before the due day: the due day itself is only partly over.
  const firstDay = dateKey(addDays({ year: y, month: m, day: d }, -7));
  const lastDay = dateKey(addDays({ year: y, month: m, day: d }, -1));
  const inPeriod = (col: Parameters<typeof gte>[0]) => and(gte(col, period.start), lt(col, period.end));

  const usage = await db
    .select()
    .from(phoneUsageDays)
    .where(and(inArray(phoneUsageDays.phoneId, ids), gte(phoneUsageDays.day, firstDay), sql`${phoneUsageDays.day} <= ${lastDay}`));
  const labels = await db
    .select({ phoneId: phoneApps.phoneId, packageName: phoneApps.packageName, label: phoneApps.label })
    .from(phoneApps)
    .where(inArray(phoneApps.phoneId, ids));
  const asked = await db
    .select({ phoneId: phoneRequests.phoneId, kind: phoneRequests.kind, n: sql<number>`count(*)::int` })
    .from(phoneRequests)
    .where(and(inArray(phoneRequests.phoneId, ids), inPeriod(phoneRequests.createdAt)))
    .groupBy(phoneRequests.phoneId, phoneRequests.kind);
  const answered = await db
    .select({ phoneId: phoneRequests.phoneId, status: phoneRequests.status, n: sql<number>`count(*)::int` })
    .from(phoneRequests)
    .where(and(inArray(phoneRequests.phoneId, ids), inArray(phoneRequests.status, ["approved", "rejected"]), inPeriod(phoneRequests.decidedAt)))
    .groupBy(phoneRequests.phoneId, phoneRequests.status);
  // "Ask for more time" (docs/more-time.md) has its own table: asked by when it was made, answered by when it was decided.
  const moreAsked = await db
    .select({ phoneId: moreTimeRequests.phoneId, n: sql<number>`count(*)::int` })
    .from(moreTimeRequests)
    .where(and(inArray(moreTimeRequests.phoneId, ids), inPeriod(moreTimeRequests.createdAt)))
    .groupBy(moreTimeRequests.phoneId);
  const moreAnswered = await db
    .select({ phoneId: moreTimeRequests.phoneId, status: moreTimeRequests.status, n: sql<number>`count(*)::int` })
    .from(moreTimeRequests)
    .where(and(inArray(moreTimeRequests.phoneId, ids), inArray(moreTimeRequests.status, ["approved", "declined"]), inPeriod(moreTimeRequests.decidedAt)))
    .groupBy(moreTimeRequests.phoneId, moreTimeRequests.status);
  const events = await db
    .select({ phoneId: summaryEvents.phoneId, kind: summaryEvents.kind, detail: summaryEvents.detail, n: sql<number>`count(*)::int` })
    .from(summaryEvents)
    .where(and(inArray(summaryEvents.phoneId, ids), inPeriod(summaryEvents.at)))
    .groupBy(summaryEvents.phoneId, summaryEvents.kind, summaryEvents.detail);

  return {
    version: 1,
    phones: included.map((p) => {
      const rows = usage.filter((u) => u.phoneId === p.id);
      const perDay = new Map<string, { total: number | null; apps: number }>();
      for (const r of rows) {
        const e = perDay.get(r.day) ?? { total: null, apps: 0 };
        if (r.packageName === TOTAL) e.total = r.minutes;
        else e.apps += r.minutes;
        perDay.set(r.day, e);
      }
      const days = [...perDay.entries()]
        .map(([day, e]) => ({ day, minutes: e.total ?? e.apps }))
        .sort((a, b) => a.day.localeCompare(b.day));
      const byApp = new Map<string, number>();
      for (const r of rows) if (r.packageName !== TOTAL) byApp.set(r.packageName, (byApp.get(r.packageName) ?? 0) + r.minutes);
      const label = new Map(labels.filter((l) => l.phoneId === p.id).map((l) => [l.packageName, l.label]));
      const topApps = [...byApp.entries()]
        .filter(([, minutes]) => minutes > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, TOP_APPS)
        .map(([packageName, minutes]) => ({ packageName, label: label.get(packageName) ?? packageName, minutes }));
      const sum = days.reduce((a, d) => a + d.minutes, 0);
      const byKind: Record<string, number> = {};
      for (const a of asked.filter((r) => r.phoneId === p.id)) byKind[a.kind] = a.n;
      const moreTime = moreAsked.find((r) => r.phoneId === p.id)?.n ?? 0;
      if (moreTime > 0) byKind.time = moreTime;
      const count = (status: string) => answered.find((r) => r.phoneId === p.id && r.status === status)?.n ?? 0;
      const moreCount = (status: string) => moreAnswered.find((r) => r.phoneId === p.id && r.status === status)?.n ?? 0;
      const mine = events.filter((e) => e.phoneId === p.id);
      const total = (kind: string) => mine.filter((e) => e.kind === kind).reduce((a, e) => a + e.n, 0);
      const byCategory: Partial<Record<ChangeCategory, number>> = {};
      for (const e of mine.filter((x) => x.kind === "change")) {
        const c = (e.detail ?? "other") as ChangeCategory;
        byCategory[c] = (byCategory[c] ?? 0) + e.n;
      }
      return {
        phoneId: p.id,
        name: p.name,
        usage: days.length === 0 ? null : { days, averageMinutes: Math.round(sum / days.length), topApps },
        requests: { asked: Object.values(byKind).reduce((a, n) => a + n, 0), approved: count("approved") + moreCount("approved"), rejected: count("rejected") + moreCount("declined"), byKind },
        changes: { total: total("change"), byCategory },
        events: { protection: total("protection"), offline: total("offline"), checkin: total("checkin") },
      };
    }),
  };
}

/**
 * When a household gets its first summary: the first due time after a full week of history. History
 * starts when the feature went live for the household or when the phone enrolled, whichever is later,
 * and the earliest phone that is in the summary counts. Null when no phone is in the summary.
 */
export async function firstSummaryAt(db: Db, h: typeof households.$inferSelect): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: phones.createdAt })
    .from(phones)
    .where(and(eq(phones.householdId, h.id), eq(phones.weeklySummaryEnabled, true)));
  if (rows.length === 0) return null;
  const start = Math.min(...rows.map((r) => Math.max(r.createdAt.getTime(), h.summarySince.getTime())));
  return nextOccurrence(new Date(start + FIRST_SUMMARY_MIN_MS), {
    day: h.summaryDay,
    hour: h.summaryHour,
    minute: h.summaryMinute,
    timeZone: zoneOf(h),
  });
}

function zoneOf(h: { timeZone: string }): string {
  return validTimeZone(h.timeZone) ? h.timeZone : "UTC";
}

/**
 * Builds the summaries that are due and delivers each once. Idempotent: the unique week
 * per household makes a second run (another sweep, another server) a no-op, and delivery is
 * claimed before it is sent, so a crash can skip a delivery but never repeat one.
 */
export async function sweepSummaries(ctx: Ctx): Promise<{ built: number; delivered: number }> {
  const now = ctx.now();
  let built = 0;
  const due = await ctx.db.select().from(households).where(eq(households.summaryEnabled, true));
  for (const h of due) {
    const tz = zoneOf(h);
    const occ = lastOccurrence(now, { day: h.summaryDay, hour: h.summaryHour, minute: h.summaryMinute, timeZone: tz });
    if (now.getTime() - occ.at.getTime() > SUMMARY_CATCH_UP_MS) continue;
    // The first summary waits for a full week of history (see firstSummaryAt).
    const first = await firstSummaryAt(ctx.db, h);
    if (!first || occ.at.getTime() < first.getTime()) continue;
    const [known] = await ctx.db.select({ id: householdSummaries.id }).from(householdSummaries)
      .where(and(eq(householdSummaries.householdId, h.id), eq(householdSummaries.weekEnd, occ.date)));
    if (known) continue;
    // Moving the day must not send a second summary in the same week.
    const [latest] = await ctx.db.select({ periodEnd: householdSummaries.periodEnd }).from(householdSummaries)
      .where(eq(householdSummaries.householdId, h.id)).orderBy(desc(householdSummaries.periodEnd)).limit(1);
    if (latest && occ.at.getTime() - latest.periodEnd.getTime() < MIN_GAP_MS) continue;
    try {
      const data = await buildSummary(ctx.db, h.id, { start: occ.previous, end: occ.at, lastDate: occ.date });
      const inserted = await ctx.db
        .insert(householdSummaries)
        .values({ householdId: h.id, weekEnd: occ.date, periodStart: occ.previous, periodEnd: occ.at, data })
        .onConflictDoNothing()
        .returning({ id: householdSummaries.id });
      if (inserted.length > 0) built += 1;
    } catch (err) {
      // One household must not stop the others or the sweeps after this one; the next pass retries.
      console.error(`weekly summary not built: ${(err as Error).message}`);
    }
  }
  const delivered = await deliverSummaries(ctx);
  await pruneSummaries(ctx);
  return { built, delivered };
}

async function deliverSummaries(ctx: Ctx): Promise<number> {
  const now = ctx.now();
  // Only recent ones: an old summary that was never claimed is not worth a mail any more.
  const claimed = await ctx.db
    .update(householdSummaries)
    .set({ deliveredAt: now })
    .where(and(
      sql`${householdSummaries.deliveredAt} is null`,
      gte(householdSummaries.periodEnd, new Date(now.getTime() - SUMMARY_CATCH_UP_MS)),
      inArray(householdSummaries.householdId, ctx.db.select({ id: households.id }).from(households).where(eq(households.summaryEnabled, true))),
    ))
    .returning();
  for (const s of claimed) {
    try {
      await deliverOne(ctx, s);
    } catch (err) {
      console.error(`weekly summary delivery failed: ${(err as Error).message}`);
    }
  }
  return claimed.length;
}

async function deliverOne(ctx: Ctx, s: typeof householdSummaries.$inferSelect): Promise<void> {
  const [h] = await ctx.db.select().from(households).where(eq(households.id, s.householdId));
  if (!h) return;
  const data = s.data as SummaryData;
  // Nothing to say about an empty household.
  if (data.phones.length === 0) return;
  const members = await ctx.db
    .select({ id: users.id, email: users.email, locale: users.locale })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, h.id));
  if (h.summaryByMail && ctx.mail.canSend) {
    for (const m of members) {
      try {
        await ctx.mail.send(weeklySummaryMail(m.email, toSummaryLocale(m.locale), ctx.cfg.PUBLIC_URL, s.id, data));
      } catch (err) {
        console.error(`summary mail failed: ${(err as Error).message}`);
      }
    }
  }
  if (h.summaryByPush) {
    await notifyUsers(ctx, members.map((m) => m.id), { type: "summary", summaryId: s.id });
  }
}

async function pruneSummaries(ctx: Ctx): Promise<void> {
  const now = ctx.now();
  const cutoff = new Date(now.getTime() - SUMMARY_KEEP_WEEKS * 7 * 86_400_000 - 86_400_000);
  await ctx.db.delete(householdSummaries).where(lt(householdSummaries.periodEnd, cutoff));
  const rawCutoff = new Date(now.getTime() - SUMMARY_RAW_KEEP_DAYS * 86_400_000);
  await ctx.db.delete(summaryEvents).where(lt(summaryEvents.at, rawCutoff));
  await ctx.db.delete(phoneUsageDays).where(lt(phoneUsageDays.day, dateKey(localTime(rawCutoff, "UTC"))));
}

/** The last [SUMMARY_KEEP_WEEKS] summaries of a household, newest first. */
export async function listSummaries(db: Db, householdId: string) {
  return db
    .select()
    .from(householdSummaries)
    .where(eq(householdSummaries.householdId, householdId))
    .orderBy(desc(householdSummaries.weekEnd))
    .limit(SUMMARY_KEEP_WEEKS);
}
