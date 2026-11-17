// SPDX-License-Identifier: Apache-2.0
//
// "Ring the phone" and "Are you okay?" (docs/location.md). Only the latest request of each kind
// per phone exists; the phone learns about it through the rules document.

import { and, eq, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { localDate } from "./limits.js";
import { type LocationMode, locations, phones, safetyRequests } from "../db/schema.js";
import type { Ctx } from "./context.js";
import { notifyHousehold, type SafetyNews } from "./notifications.js";

type Phone = typeof phones.$inferSelect;
export type SafetyRequest = typeof safetyRequests.$inferSelect;

/** The sound stops by itself after this, whatever happens. */
export const RING_MINUTES = 5;
/** Reply times a parent can pick for "Are you okay?". */
export const CHECKIN_MIN_MINUTES = 1;
export const CHECKIN_MAX_MINUTES = 120;
/** After an unanswered deadline the phone has this long to send its one position. */
export const CHECKIN_LOCATE_WINDOW_MS = 30 * 60_000;
/** A Find the phone has not answered in this long is over (the phone gives up after the same time). */
export const FIND_WINDOW_MS = 30 * 60_000;
/** The phone polls this often while a ring or a check-in is open, so stops and replies travel fast. */
export const FAST_POLL_SECONDS = 10;
/** Finished requests are deleted after this (sweeper). */
export const SAFETY_KEEP_MS = 24 * 60 * 60_000;
/** The phone's clock may be a little ahead: accept the check-in position this early. */
const CLOCK_SLACK_MS = 2 * 60_000;
/** A reply arriving within a second of the deadline or upload can still win. */
const CHECKIN_REPLY_GRACE_MS = 1_000;

/** How long a parent can turn "always" on for. It always ends by itself (docs/location.md). */
export const ALWAYS_FOR = ["hour", "today", "week"] as const;
export type AlwaysFor = (typeof ALWAYS_FOR)[number];
/** The mode "always" falls back to when its time is up. */
export const ALWAYS_FALLBACK: LocationMode = "checkin";

/** The end of "always" chosen at `now`: in an hour, at the phone's local midnight, or in 7 days. */
export function alwaysUntil(choice: AlwaysFor, timezone: string, now: Date): Date {
  if (choice === "hour") return new Date(now.getTime() + 60 * 60_000);
  if (choice === "week") return new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  // First moment that is no longer today in the phone's time zone (handles DST days).
  const today = localDate(timezone, now);
  let lo = now.getTime();
  let hi = lo + 26 * 60 * 60_000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDate(timezone, new Date(mid)) === today) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

/** Sweeper: "always" whose time is up falls back to Find + "Are you okay?". Returns the phones changed. */
export async function expireAlwaysLocation(ctx: Ctx): Promise<string[]> {
  const rows = await ctx.db
    .update(phones)
    .set({ locationMode: ALWAYS_FALLBACK, locationAlwaysUntil: null })
    // No end at all counts as ended: "always" is never open-ended.
    .where(
      and(
        eq(phones.locationMode, "always"),
        or(isNull(phones.locationAlwaysUntil), lte(phones.locationAlwaysUntil, ctx.now())),
      ),
    )
    .returning({ id: phones.id });
  return rows.map((r) => r.id);
}

/** Modes in which an unanswered "Are you okay?" sends a position. */
export function checkinSendsLocation(mode: LocationMode): boolean {
  return mode === "checkin" || mode === "always";
}

export function ringActive(r: SafetyRequest | undefined, now: Date): r is SafetyRequest {
  return Boolean(r && !r.stoppedAt && now < r.endsAt && !(r.answeredAt && r.stopOnAnswer));
}

export type CheckinStatus = "waiting" | "answered" | "cancelled" | "noReply";

export function checkinStatus(r: SafetyRequest, now: Date): CheckinStatus {
  if (r.answeredAt) return "answered";
  if (r.stoppedAt) return "cancelled";
  return now < r.endsAt ? "waiting" : "noReply";
}

/** True while the phone should (still) send its one position for an unanswered check-in. */
export function checkinLocationDue(r: SafetyRequest | undefined, mode: LocationMode, now: Date, slackMs = 0): boolean {
  if (!r || r.answeredAt || r.stoppedAt || r.locatedAt || r.pendingLocation || !checkinSendsLocation(mode)) return false;
  const t = now.getTime();
  return t >= r.endsAt.getTime() - slackMs && t < r.endsAt.getTime() + CHECKIN_LOCATE_WINDOW_MS;
}

/** Older phones omit a purpose and can reach the deadline ahead of the server. */
export function legacyCheckinLocationDue(r: SafetyRequest, mode: LocationMode, now: Date, recordedAt: Date): boolean {
  return checkinLocationDue(r, mode, now, CLOCK_SLACK_MS) &&
    recordedAt.getTime() >= r.endsAt.getTime() - CLOCK_SLACK_MS;
}

export async function loadSafety(ctx: Ctx, phoneId: string) {
  const rows = await ctx.db.select().from(safetyRequests).where(eq(safetyRequests.phoneId, phoneId));
  return { ring: rows.find((r) => r.kind === "ring"), checkin: rows.find((r) => r.kind === "checkin") };
}

/** What the phone needs to know, as part of the rules document. */
export function safetyForPhone(phone: Phone, s: Awaited<ReturnType<typeof loadSafety>>, now: Date) {
  const ring = ringActive(s.ring, now)
    ? { id: s.ring.id, endsAt: s.ring.endsAt.toISOString(), stopOnAnswer: s.ring.stopOnAnswer, answered: s.ring.answeredAt !== null }
    : null;
  const c = s.checkin;
  const locationDue = checkinLocationDue(c, phone.locationMode, now);
  const open = c && (checkinStatus(c, now) === "waiting" || locationDue);
  const checkIn = open
    ? {
        id: c.id,
        deadline: c.endsAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
        locationDue,
        callNumber: c.callNumber,
        sendLocation: checkinSendsLocation(phone.locationMode),
      }
    : null;
  const waiting = c !== undefined && checkinStatus(c, now) === "waiting";
  return { ring, checkIn, fast: ring !== null || waiting };
}

/** What the parent sees. */
export function ringJson(r: SafetyRequest | undefined, now: Date) {
  if (!r) return null;
  return {
    id: r.id,
    active: ringActive(r, now),
    stopOnAnswer: r.stopOnAnswer,
    createdAt: r.createdAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    shownAt: r.shownAt?.toISOString() ?? null,
    answeredAt: r.answeredAt?.toISOString() ?? null,
    stoppedAt: r.stoppedAt?.toISOString() ?? null,
  };
}

export function checkinJson(r: SafetyRequest | undefined, mode: LocationMode, now: Date) {
  if (!r) return null;
  return {
    id: r.id,
    status: checkinStatus(r, now),
    createdAt: r.createdAt.toISOString(),
    deadline: r.endsAt.toISOString(),
    callNumber: r.callNumber,
    sendsLocation: checkinSendsLocation(mode),
    shownAt: r.shownAt?.toISOString() ?? null,
    answeredAt: r.answeredAt?.toISOString() ?? null,
    answer: r.answer,
    stoppedAt: r.stoppedAt?.toISOString() ?? null,
    locatedAt: r.locatedAt?.toISOString() ?? null,
  };
}

/** A new request replaces the phone's previous one of the same kind. */
export async function startRequest(
  ctx: Ctx,
  phoneId: string,
  userId: string,
  input: { kind: "ring"; stopOnAnswer: boolean } | { kind: "checkin"; minutes: number; callNumber: string | null },
): Promise<SafetyRequest> {
  const now = ctx.now();
  const values = {
    phoneId,
    kind: input.kind,
    createdBy: userId,
    endsAt: new Date(now.getTime() + (input.kind === "ring" ? RING_MINUTES : input.minutes) * 60_000),
    stopOnAnswer: input.kind === "ring" ? input.stopOnAnswer : true,
    callNumber: input.kind === "checkin" ? input.callNumber : null,
    shownAt: null,
    answeredAt: null,
    answer: null,
    stoppedAt: null,
    locatedAt: null,
    noReplyNotifiedAt: null,
    createdAt: now,
  };
  return ctx.db.transaction(async (tx) => {
    await tx
      .delete(safetyRequests)
      .where(and(eq(safetyRequests.phoneId, phoneId), eq(safetyRequests.kind, input.kind)));
    const [row] = await tx.insert(safetyRequests).values(values).returning();
    return row!;
  });
}

/** Deletes finished requests older than a day (data minimisation). */
export async function deleteOldSafetyRequests(ctx: Ctx): Promise<number> {
  const cutoff = new Date(ctx.now().getTime() - SAFETY_KEEP_MS);
  const rows = await ctx.db
    .delete(safetyRequests)
    .where(
      or(
        lt(safetyRequests.endsAt, new Date(cutoff.getTime() - CHECKIN_LOCATE_WINDOW_MS)),
        and(isNotNull(safetyRequests.stoppedAt), lt(safetyRequests.stoppedAt, cutoff)),
      ),
    );
  return rows.count;
}

/** Tells the household what happened. Push only; never fails the caller. */
export async function notifySafety(ctx: Ctx, phone: Pick<Phone, "id" | "name">, what: SafetyNews) {
  try {
    await notifyHousehold(ctx, phone.id, { type: "safety", phoneId: phone.id, phoneName: phone.name, what });
  } catch (err) {
    console.error(`safety notification failed: ${(err as Error).message}`);
  }
}

type Transaction = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
type LocationValues = Omit<typeof locations.$inferInsert, "phoneId">;

/** Only the latest position is kept. An older fix never overwrites a newer one. */
export async function storeLatestLocation(tx: Transaction, phoneId: string, values: LocationValues) {
  await tx.insert(locations).values({ phoneId, ...values }).onConflictDoUpdate({
    target: locations.phoneId,
    set: values,
    setWhere: lte(locations.recordedAt, values.recordedAt),
  });
}

/** Publish staged fixes only after replies and cancellations have had time to arrive. */
async function publishCheckinLocations(ctx: Ctx, cutoff: Date): Promise<number> {
  const pending = await ctx.db
    .select({ id: safetyRequests.id, phoneId: safetyRequests.phoneId })
    .from(safetyRequests)
    .where(and(lte(safetyRequests.endsAt, cutoff), isNotNull(safetyRequests.pendingLocation)));
  let sent = 0;
  for (const { id, phoneId } of pending) {
    const phone = await ctx.db.transaction(async (tx) => {
      const [phone] = await tx.select().from(phones).where(eq(phones.id, phoneId)).for("no key update");
      if (!phone) return null;
      const [req] = await tx.select().from(safetyRequests).where(and(
        eq(safetyRequests.id, id),
        isNull(safetyRequests.answeredAt),
        isNull(safetyRequests.stoppedAt),
        isNotNull(safetyRequests.pendingLocation),
      )).for("update");
      const fix = req?.pendingLocation;
      if (!fix || new Date(fix.receivedAt) > cutoff) return null;

      if (!checkinSendsLocation(phone.locationMode)) {
        await tx.update(safetyRequests).set({ pendingLocation: null }).where(eq(safetyRequests.id, id));
        return null;
      }
      const receivedAt = new Date(fix.receivedAt);
      await storeLatestLocation(tx, phone.id, { ...fix, recordedAt: new Date(fix.recordedAt), receivedAt });
      await tx.update(safetyRequests)
        .set({ locatedAt: receivedAt, pendingLocation: null, noReplyNotifiedAt: ctx.now() })
        .where(eq(safetyRequests.id, id));
      return phone;
    });
    if (phone) {
      await notifySafety(ctx, phone, "located");
      sent++;
    }
  }
  return sent;
}

/**
 * Sweeper: tells the parents once when an "Are you okay?" passed its deadline unanswered.
 * A position, if ready, takes the place of the initial no-reply notification.
 */
export async function alertUnansweredCheckins(ctx: Ctx): Promise<number> {
  const now = ctx.now();
  const cutoff = new Date(now.getTime() - CHECKIN_REPLY_GRACE_MS);
  let sent = await publishCheckinLocations(ctx, cutoff);
  const rows = await ctx.db
    .select({ req: safetyRequests, phone: phones })
    .from(safetyRequests)
    .innerJoin(phones, eq(phones.id, safetyRequests.phoneId))
    .where(
      and(
        eq(safetyRequests.kind, "checkin"),
        lte(safetyRequests.endsAt, cutoff),
        isNull(safetyRequests.pendingLocation),
        isNull(safetyRequests.answeredAt),
        isNull(safetyRequests.stoppedAt),
        isNull(safetyRequests.noReplyNotifiedAt),
      ),
    );
  for (const { req, phone } of rows) {
    // Claim it first, so two sweeps never notify twice.
    const claimed = await ctx.db
      .update(safetyRequests)
      .set({ noReplyNotifiedAt: now })
      .where(and(
        eq(safetyRequests.id, req.id),
        isNull(safetyRequests.noReplyNotifiedAt),
        isNull(safetyRequests.pendingLocation),
        isNull(safetyRequests.answeredAt),
        isNull(safetyRequests.stoppedAt),
      ))
      .returning({ id: safetyRequests.id, locatedAt: safetyRequests.locatedAt });
    if (!claimed.length) continue;
    // Already located (the phone was quicker than the sweeper): that push said it all.
    const { locatedAt } = claimed[0]!;
    if (locatedAt && locatedAt >= req.endsAt) continue;
    if (locatedAt) {
      // A legacy upload was accepted early because the phone clock was ahead.
      await notifySafety(ctx, phone, "located");
      sent++;
      continue;
    }
    await notifySafety(ctx, phone, checkinSendsLocation(phone.locationMode) ? "noReplyLocating" : "noReplyNoLocation");
    sent++;
  }
  return sent;
}
