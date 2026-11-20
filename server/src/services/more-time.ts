// SPDX-License-Identifier: Apache-2.0
//
// "Ask for more time" (docs/more-time.md). When an app's time or the daily cap runs out, the person
// with the phone can ask for more, with an optional short reason. A parent answers 15 minutes,
// 1 hour, the rest of the day, or no. The first answer wins. An approval is an ordinary time bonus
// for that app (or the daily cap) on the day of the request, so the phone applies it offline-safe
// through `/rules`. Unanswered requests expire at the phone's local midnight.

import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { moreTimeRequests, phoneApps, phones, timeLimits } from "../db/schema.js";
import { applyOp } from "./changes.js";
import type { Ctx } from "./context.js";
import { localDate, TOTAL } from "./limits.js";
import { notifyAlertRecipients, notifyHousehold, phoneAlertRecipients } from "./notifications.js";
import { respondWithRules, wakePhone } from "./phones.js";

type Phone = typeof phones.$inferSelect;
type Row = typeof moreTimeRequests.$inferSelect;

export const MORE_TIME_ANSWERS = ["15", "60", "day", "no"] as const;
export type MoreTimeAnswer = (typeof MORE_TIME_ANSWERS)[number];
export const MORE_TIME_REASON_MAX = 140;
/** Answered requests stay visible this long, so a second parent sees what the first one decided. */
export const MORE_TIME_RECENT_HOURS = 24;
/** Rows are deleted after this many days: the reason is text the child wrote. */
export const MORE_TIME_HISTORY_DAYS = 30;

export class MoreTimeError extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 429,
    message: string,
  ) {
    super(message);
  }
}

/** Whole minutes left of the local day in [timezone], rounded up. */
export function minutesLeftToday(timezone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hourCycle: "h23",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const secondsLeft = 86_400 - (get("hour") * 3600 + get("minute") * 60 + get("second"));
  return Math.min(1440, Math.max(1, Math.ceil(secondsLeft / 60)));
}

/** What a choice gives, in minutes. Null means no. */
export function minutesFor(answer: MoreTimeAnswer, timezone: string, now: Date): number | null {
  if (answer === "no") return null;
  if (answer === "day") return minutesLeftToday(timezone, now);
  return Number(answer);
}

export function moreTimeJson(r: Row) {
  return {
    id: r.id,
    packageName: r.packageName,
    reason: r.reason,
    day: r.day,
    status: r.status,
    answer: r.answer,
    grantedMinutes: r.grantedMinutes,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    /** "phone" when a parent answered on the phone itself with the parent PIN, else "parent" (or null while open). */
    decidedVia: r.decidedAt ? (r.decidedVia ?? "parent") : null,
  };
}

/** Pending requests from an earlier local day can no longer be answered. */
async function expireStale(ctx: Ctx, phone: Pick<Phone, "id" | "timezone">) {
  await ctx.db
    .update(moreTimeRequests)
    .set({ status: "expired" })
    .where(
      and(
        eq(moreTimeRequests.phoneId, phone.id),
        eq(moreTimeRequests.status, "pending"),
        lt(moreTimeRequests.day, localDate(phone.timezone, ctx.now())),
      ),
    );
}

async function hasLimit(db: Ctx["db"] | Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0], phoneId: string, target: string) {
  const [limit] = await db
    .select({ p: timeLimits.packageName })
    .from(timeLimits)
    .where(and(eq(timeLimits.phoneId, phoneId), eq(timeLimits.packageName, target)));
  return Boolean(limit);
}

/** The app's name for a parent, or null for the daily cap. */
async function targetLabel(ctx: Ctx, phoneId: string, target: string): Promise<string | null> {
  if (target === TOTAL) return null;
  const [app] = await ctx.db
    .select({ label: phoneApps.label })
    .from(phoneApps)
    .where(and(eq(phoneApps.phoneId, phoneId), eq(phoneApps.packageName, target)));
  return app?.label ?? target;
}

/** Creates a request, or returns today's open one for the same app (or the daily cap). */
export async function createMoreTimeRequest(
  ctx: Ctx,
  phone: Phone,
  input: { packageName: string; reason?: string | undefined },
  /** Asked right before a new request is made, so asking again for an open one never uses up the allowance. */
  mayCreate: () => boolean = () => true,
): Promise<{ request: Row; created: boolean }> {
  if (!phone.askMoreTimeEnabled) throw new MoreTimeError(403, "asking for more time is switched off for this phone");
  if (phone.profile !== "child") throw new MoreTimeError(409, "only a child's phone can ask for more time");
  const reason = input.reason?.trim() || null;
  const out = await ctx.db.transaction(async (tx) => {
    // One at a time per phone, so the duplicate check holds.
    await tx.execute(sql`select id from phones where id = ${phone.id} for update`);
    if (!(await hasLimit(tx, phone.id, input.packageName))) throw new MoreTimeError(409, "there is no time limit to ask more time on");
    const day = localDate(phone.timezone, ctx.now());
    await tx
      .update(moreTimeRequests)
      .set({ status: "expired" })
      .where(and(eq(moreTimeRequests.phoneId, phone.id), eq(moreTimeRequests.status, "pending"), lt(moreTimeRequests.day, day)));
    const [open] = await tx
      .select()
      .from(moreTimeRequests)
      .where(
        and(
          eq(moreTimeRequests.phoneId, phone.id),
          eq(moreTimeRequests.packageName, input.packageName),
          eq(moreTimeRequests.status, "pending"),
        ),
      );
    if (open) return { request: open, created: false };
    if (!mayCreate()) throw new MoreTimeError(429, "too many requests for more time; wait for an answer");
    const [row] = await tx
      .insert(moreTimeRequests)
      .values({ phoneId: phone.id, packageName: input.packageName, reason, day, createdAt: ctx.now() })
      .returning();
    return { request: row!, created: true };
  });
  if (out.created) {
    await notifyHousehold(ctx, phone.id, {
      type: "moreTime",
      requestId: out.request.id,
      phoneId: phone.id,
      phoneName: phone.name,
      what: await targetLabel(ctx, phone.id, input.packageName),
      reason,
      // Without receipts the notification does not promise that the phone will confirm.
      receipts: phone.changeReceiptsEnabled && phone.pairedAt !== null,
    });
  }
  return out;
}

/**
 * Answers a request. The first answer wins: a later one changes nothing and gets the result
 * back with `won: false`, so a second parent (or a double tap on the notification) just sees it.
 */
export async function answerMoreTimeRequest(
  ctx: Ctx,
  phone: Phone,
  requestId: string,
  /** Null when a parent answered on the phone itself ([via] "phone"). */
  userId: string | null,
  answer: MoreTimeAnswer,
  via: "parent" | "phone" = "parent",
  /** The answer was given from a notification: tell this parent when the phone has applied it. */
  fromNotification = false,
): Promise<{ request: Row; won: boolean }> {
  const out = await ctx.db.transaction(async (tx) => {
    const [fresh] = await tx.select().from(phones).where(eq(phones.id, phone.id)).for("update");
    if (!fresh) throw new MoreTimeError(404, "phone not found");
    const [row] = await tx
      .select()
      .from(moreTimeRequests)
      .where(and(eq(moreTimeRequests.id, requestId), eq(moreTimeRequests.phoneId, phone.id)))
      .for("update");
    if (!row) throw new MoreTimeError(404, "request not found");
    if (row.status !== "pending") return { request: row, won: false };
    const now = ctx.now();
    if (row.day < localDate(fresh.timezone, now)) {
      const [expired] = await tx.update(moreTimeRequests).set({ status: "expired" }).where(eq(moreTimeRequests.id, row.id)).returning();
      return { request: expired!, won: false };
    }
    const minutes = minutesFor(answer, fresh.timezone, now);
    if (minutes !== null) {
      // Nothing to grant any more: close the request instead of leaving it open all day.
      // A phone that is no longer a child's has to go through the Self key, not through here.
      if (fresh.profile !== "child" || !(await hasLimit(tx, phone.id, row.packageName))) {
        const [expired] = await tx.update(moreTimeRequests).set({ status: "expired" }).where(eq(moreTimeRequests.id, row.id)).returning();
        return { request: expired!, won: false };
      }
      // The day is the one asked about, so the bonus never spills into tomorrow.
      await applyOp(ctx, tx, fresh, { type: "timeLimit.bonus", packageName: row.packageName, date: row.day, minutes }, row.day);
    }
    const [decided] = await tx
      .update(moreTimeRequests)
      .set({
        status: minutes === null ? "declined" : "approved",
        answer,
        grantedMinutes: minutes,
        decidedBy: userId,
        decidedVia: via,
        decidedAt: now,
        // Only a bonus changes the rules, so only a bonus has something for the phone to confirm, and only with receipts on.
        ...(fromNotification && userId && minutes !== null && fresh.changeReceiptsEnabled && fresh.pairedAt ? { receiptUserId: userId } : {}),
      })
      .where(eq(moreTimeRequests.id, row.id))
      .returning();
    return { request: decided!, won: true };
  });
  // The phone shows the answer and applies the bonus: let it sync now.
  if (out.won) await wakePhone(ctx, phone.id, "rules");
  return out;
}

/** A receipt is only worth telling about for a few hours; later it would be stale news. */
const RECEIPT_WINDOW_MS = 6 * 3_600_000;

/**
 * Called after a status report from the phone. When the phone has now confirmed the rules the server
 * holds (the same proof as the dashboard's receipt), tells the parent who answered from a notification:
 * "Active on the phone at 14:05", under the same tag so it replaces what they saw. Once per request.
 * Never fails the report.
 */
export async function sendMoreTimeReceipts(ctx: Ctx, phoneId: string): Promise<void> {
  try {
    const now = ctx.now();
    const waiting = await ctx.db
      .select()
      .from(moreTimeRequests)
      .where(
        and(
          eq(moreTimeRequests.phoneId, phoneId),
          isNotNull(moreTimeRequests.receiptUserId),
          isNull(moreTimeRequests.receiptSentAt),
          gte(moreTimeRequests.decidedAt, new Date(now.getTime() - RECEIPT_WINDOW_MS)),
        ),
      );
    if (waiting.length === 0) return;
    const [phone] = await ctx.db.select().from(phones).where(eq(phones.id, phoneId));
    const status = phone?.deviceStatus;
    if (!phone || !phone.changeReceiptsEnabled || !phone.pairedAt || (phone.rulesAwaitDns && phone.dnsDirty)) return;
    if (!status?.rulesReceiptConfirmed || !status.rulesEtag || !status.rulesAppliedAt) return;
    if ((await respondWithRules(ctx, phone, [])).etag !== status.rulesEtag) return;
    const received = new Date(status.rulesReceiptReceivedAt ?? phone.statusReportedAt ?? now);
    const applied = new Date(status.rulesAppliedAt);
    const clockAhead = applied > received;
    const members = await phoneAlertRecipients(ctx.db, phone.id, phone.householdId);
    for (const r of waiting) {
      // The receipt must come after the answer, or it is about older rules.
      if (!r.decidedAt || received < r.decidedAt || !r.receiptUserId) continue;
      // Claim it first, so two reports at once send one.
      const [claimed] = await ctx.db
        .update(moreTimeRequests)
        .set({ receiptSentAt: now })
        .where(and(eq(moreTimeRequests.id, r.id), isNull(moreTimeRequests.receiptSentAt)))
        .returning({ id: moreTimeRequests.id });
      if (!claimed || r.answer === null || r.answer === "no") continue;
      // Members who muted the phone are left out, as for every other message about it.
      await notifyAlertRecipients(ctx, members.filter((m) => m.id === r.receiptUserId), {
        type: "moreTimeReceipt",
        requestId: r.id,
        phoneId: phone.id,
        phoneName: phone.name,
        answer: r.answer,
        at: clockAhead ? received : applied,
        clockAhead,
        timezone: phone.timezone,
      });
    }
  } catch (err) {
    console.error(`more-time receipt failed: ${(err as Error).message}`);
  }
}

/** What a parent next to the child approves on the phone with the PIN: a quarter of an hour. More can be given from the dashboard or the parent app. */
export const PHONE_APPROVAL_ANSWER: MoreTimeAnswer = "15";

/**
 * A parent next to the child approved the request on the phone with the parent PIN. The phone
 * checked the PIN and is the authority for what it did, so this is a report: the first answer wins
 * and a repeat changes nothing. Null when there is no such request.
 */
export async function approveMoreTimeOnPhone(ctx: Ctx, phone: Phone, requestId: string): Promise<{ request: Row; won: boolean } | null> {
  if (phone.profile !== "child") throw new MoreTimeError(409, "approval on the phone is only for child phones");
  let out;
  try {
    out = await answerMoreTimeRequest(ctx, phone, requestId, null, PHONE_APPROVAL_ANSWER, "phone");
  } catch (err) {
    if (err instanceof MoreTimeError && err.status === 404) return null;
    throw err;
  }
  if (out.won && out.request.status === "approved") {
    const what = await targetLabel(ctx, phone.id, out.request.packageName);
    await notifyHousehold(ctx, phone.id, { type: "request-on-phone", phoneId: phone.id, phoneName: phone.name, kind: "more-time", what });
  }
  return out;
}

/** What the phone sees: today's and yesterday's requests, newest first. */
export async function phoneMoreTimeList(ctx: Ctx, phone: Phone) {
  await expireStale(ctx, phone);
  const since = new Date(ctx.now().getTime() - MORE_TIME_RECENT_HOURS * 3_600_000);
  const rows = await ctx.db
    .select()
    .from(moreTimeRequests)
    .where(and(eq(moreTimeRequests.phoneId, phone.id), gte(moreTimeRequests.createdAt, since)))
    .orderBy(desc(moreTimeRequests.createdAt));
  return rows.map(moreTimeJson);
}

/** What a parent sees: the open requests and what was decided lately, with the app's name. */
export async function parentMoreTimeList(ctx: Ctx, phone: Phone, userId: string) {
  await expireStale(ctx, phone);
  const since = new Date(ctx.now().getTime() - MORE_TIME_RECENT_HOURS * 3_600_000);
  const rows = await ctx.db
    .select({ r: moreTimeRequests, appLabel: phoneApps.label })
    .from(moreTimeRequests)
    .leftJoin(phoneApps, and(eq(phoneApps.phoneId, moreTimeRequests.phoneId), eq(phoneApps.packageName, moreTimeRequests.packageName)))
    .where(
      and(
        eq(moreTimeRequests.phoneId, phone.id),
        or(eq(moreTimeRequests.status, "pending"), gte(moreTimeRequests.createdAt, since)),
      ),
    )
    .orderBy(desc(moreTimeRequests.createdAt));
  return rows.map(({ r, appLabel }) => ({
    ...moreTimeJson(r),
    phoneId: r.phoneId,
    /** Null for the daily cap. */
    appLabel: r.packageName === TOTAL ? null : (appLabel ?? r.packageName),
    answeredByYou: r.decidedBy === null ? null : r.decidedBy === userId,
  }));
}

/** Open "more time" requests for several phones, for the parent app's start screen. */
export async function openMoreTimeCounts(ctx: Ctx, phoneIds: string[]) {
  if (phoneIds.length === 0) return new Map<string, number>();
  const rows = await ctx.db
    .select({ phoneId: moreTimeRequests.phoneId, n: sql<number>`count(*)::int` })
    .from(moreTimeRequests)
    .where(and(inArray(moreTimeRequests.phoneId, phoneIds), eq(moreTimeRequests.status, "pending")))
    .groupBy(moreTimeRequests.phoneId);
  return new Map(rows.map((r) => [r.phoneId, r.n]));
}

/** Sweeper: expires what was not answered by the phone's midnight and deletes old rows. */
export async function sweepMoreTime(ctx: Ctx): Promise<number> {
  const now = ctx.now().toISOString();
  const expired = await ctx.db.execute(sql`
    update more_time_requests r set status = 'expired'
    from phones p
    where r.phone_id = p.id and r.status = 'pending'
      and r.day < ((${now}::timestamptz at time zone p.timezone)::date)`);
  await ctx.db
    .delete(moreTimeRequests)
    .where(lt(moreTimeRequests.createdAt, new Date(ctx.now().getTime() - MORE_TIME_HISTORY_DAYS * 86_400_000)));
  return expired.count;
}
