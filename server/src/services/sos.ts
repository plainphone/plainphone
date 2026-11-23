// SPDX-License-Identifier: Apache-2.0
import { and, eq, gt, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { householdMembers, phones, sosDeliveries, sosEvents, users } from "../db/schema.js";
import { withTimeout } from "../lib/http.js";
import { toLocale } from "../lib/locale.js";
import { sosMail } from "../lib/mail-templates.js";
import type { Ctx } from "./context.js";
import { publishLive } from "./live-events.js";
import { notifyUsers, pushMessage } from "./notifications.js";

const DAY = 86_400_000;
export const sosCutoff = (now: Date) => new Date(now.getTime() - 30 * DAY);

export function sosJson(row: typeof sosEvents.$inferSelect) {
  return {
    id: row.id, kind: row.kind, createdAt: row.createdAt, seenAt: row.seenAt, seenByName: row.seenByName,
    deliveredVia: row.deliveredVia, deliveryFailedAt: row.deliveryFailedAt, battery: row.battery,
    location: row.lat === null || row.lon === null ? null : { lat: row.lat, lon: row.lon },
    trigger: row.trigger, message: row.message,
  };
}

/** Longest a single provider call may take, so one slow server cannot outlive the lease. */
export const SOS_SEND_TIMEOUT_MS = 20_000;
/** The lease is far longer than the send timeout: a live worker always finishes first. */
const LEASE_MS = 120_000;
const RETRY_MS = 60_000;
/** After this long the incident is closed as undelivered and shown as such in the dashboard. */
export const SOS_GIVE_UP_MS = 6 * 3_600_000;

/** One SOS mail to one parent: the send still with the mail server, and when it was accepted. */
interface MailSend { pending?: Promise<Date>; sentAt?: Date; recorded?: boolean; settled: boolean }
/** Per process: SOS mails still with the mail server or not yet recorded, by phone, event and parent. */
const mailsInFlight = new WeakMap<Ctx, Map<string, MailSend>>();

/**
 * Runs one SOS mail per parent at a time. A send cannot be called back once it is with the mail
 * server, so a send that outlives the attempt's timeout is not abandoned: it goes on, records
 * `mailedAt` itself if it gets through, and a retry meanwhile waits for it instead of sending a
 * second mail. If it fails, the next retry sends again, so an SOS mail is never lost. A mail the
 * mail server accepted is remembered until `mailedAt` is recorded: a retry after a failed record
 * only records it again and never sends it twice. Other processes are kept out by holdLease.
 * SOS mail is at-least-once on purpose: with several server processes and a database outage that
 * outlasts the lease, a parent can get the same SOS mail twice. A lost SOS is never acceptable.
 */
function mailOnce(
  ctx: Ctx, key: string, send: () => Promise<void>, record: (at: Date) => Promise<unknown>,
): { entry: MailSend; done: Promise<Date> } {
  let inFlight = mailsInFlight.get(ctx);
  if (!inFlight) mailsInFlight.set(ctx, (inFlight = new Map()));
  const known = inFlight.get(key);
  if (known?.pending) return { entry: known, done: known.pending };
  const entry: MailSend = known ?? { settled: false };
  inFlight.set(key, entry);
  entry.settled = false;
  const done = (async () => {
    try {
      if (!entry.sentAt) {
        await send();
        entry.sentAt = ctx.now();
      }
      await record(entry.sentAt);
      entry.recorded = true;
      return entry.sentAt;
    } finally {
      entry.settled = true;
    }
  })();
  entry.pending = done;
  done.then(() => inFlight.delete(key), () => {
    if (entry.sentAt) entry.pending = undefined;
    else inFlight.delete(key);
  });
  return { entry, done };
}

/**
 * Keeps an incident's lease, from `lease` on, while SOS mails that outlived their attempt are still
 * with the mail server, so no other process starts a second send of the same mail, however long the
 * mail server's own timeouts are. Renewed only while the lease is still the one written here (a new
 * attempt or a close ends the hold); once the mails settle it is released, so the next sweep records
 * or retries them at once. A process that dies stops renewing, and the lease runs out.
 */
function holdLease(ctx: Ctx, key: SQL | undefined, lease: Date, sending: unknown[]) {
  let held = lease;
  // Renewals run one after another, and the release waits for the last, so it sees the lease written.
  let renewing: Promise<void> = Promise.resolve();
  const own = () => and(key, eq(sosEvents.notificationLeaseUntil, held), isNull(sosEvents.notificationClaimedAt));
  const renew = setInterval(() => {
    renewing = renewing.then(async () => {
      const next = new Date(ctx.now().getTime() + LEASE_MS);
      const rows = await ctx.db.update(sosEvents).set({ notificationLeaseUntil: next }).where(own()).returning({ id: sosEvents.id });
      if (rows.length) held = next; else clearInterval(renew);
    }).catch(() => console.error("SOS lease could not be renewed"));
  }, LEASE_MS / 3);
  renew.unref();
  void Promise.allSettled(sending).then(async () => {
    clearInterval(renew);
    await renewing;
    await ctx.db.update(sosEvents).set({ notificationLeaseUntil: ctx.now() }).where(own());
  }).catch(() => console.error("SOS lease could not be released"));
}

function readyForDelivery(now: Date) {
  return and(isNull(sosEvents.notificationClaimedAt),
    or(isNull(sosEvents.notificationLeaseUntil), lte(sosEvents.notificationLeaseUntil, now)));
}

export async function deliverSos(ctx: Ctx, id: string, phoneId: string, opts: { sendTimeoutMs?: number } = {}) {
  const sendTimeout = opts.sendTimeoutMs ?? SOS_SEND_TIMEOUT_MS;
  const key = and(eq(sosEvents.phoneId, phoneId), eq(sosEvents.id, id));
  const now = ctx.now();
  // Keep the database connection free while external providers are working.
  const lease = new Date(now.getTime() + LEASE_MS);
  const [row] = await ctx.db.update(sosEvents).set({ notificationLeaseUntil: lease })
    .where(and(key, readyForDelivery(now))).returning();
  if (!row) return;
  const claim = and(key, eq(sosEvents.notificationLeaseUntil, lease));
  const close = (extra: Partial<typeof sosEvents.$inferInsert> = {}) =>
    ctx.db.update(sosEvents).set({ notificationClaimedAt: ctx.now(), notificationLeaseUntil: null, ...extra }).where(claim);
  // One round trip for everything the fan-out needs, instead of three in a row.
  const [[phone], members, sent] = await Promise.all([
    ctx.db.select().from(phones).where(eq(phones.id, phoneId)),
    ctx.db.select({ id: users.id, locale: users.locale, email: users.email })
      .from(householdMembers).innerJoin(users, eq(users.id, householdMembers.userId))
      .innerJoin(phones, eq(phones.householdId, householdMembers.householdId))
      .where(eq(phones.id, phoneId)),
    ctx.db.select().from(sosDeliveries)
      .where(and(eq(sosDeliveries.phoneId, phoneId), eq(sosDeliveries.eventId, id))),
  ]);
  if (!phone || phone.releaseRequestedAt || row.seenAt) {
    await close();
    return;
  }
  const state = new Map(sent.map((delivery) => [delivery.userId, delivery]));
  const event = { type: "sos", id, phoneId, phoneName: phone.name, kind: row.kind, trigger: row.trigger, message: row.message } as const;
  let pushedNow = 0;
  // Every SOS mail of this attempt, and those that outlived its timeout.
  const mails: MailSend[] = [];
  const stillSending: MailSend[] = [];
  // Each parent is tracked on their own: a retry only repeats what failed for them.
  const finished = await Promise.all(members.map(async (member) => {
    const before = state.get(member.id);
    if (before?.doneAt) return true;
    let pushedAt = before?.pushedAt ?? null;
    let mailedAt = before?.mailedAt ?? null;
    let failed = false;
    // Record each channel the moment it succeeds, so a worker taking over never repeats it.
    const record = (set: { pushedAt?: Date; mailedAt?: Date }) => ctx.db.insert(sosDeliveries)
      .values({ phoneId, eventId: id, userId: member.id, ...set })
      .onConflictDoUpdate({ target: [sosDeliveries.phoneId, sosDeliveries.eventId, sosDeliveries.userId], set });
    await Promise.all([
      pushedAt ? undefined : (async () => {
        const sentCount = await withTimeout(notifyUsers(ctx, [member.id], event, {
          keepOnTransientFailure: true, onFailure: () => { failed = true; }, originAt: row.receivedAt,
        }), sendTimeout).catch(() => { failed = true; return 0; });
        if (sentCount > 0) { pushedAt = ctx.now(); pushedNow += sentCount; await record({ pushedAt }); }
      })(),
      mailedAt || !ctx.mail.canSend ? undefined : (async () => {
        const locale = toLocale(member.locale);
        const message = pushMessage(event, locale);
        try {
          // Urgent: sent at once, also at the mail cap (services/mail-cap.ts).
          const { entry, done } = mailOnce(ctx, `${phoneId}:${id}:${member.id}`,
            () => ctx.mail.send(sosMail(member.email, locale, ctx.cfg.PUBLIC_URL, phoneId, message.title, message.body), { urgent: true }),
            (at) => record({ mailedAt: at }));
          mails.push(entry);
          try {
            mailedAt = await withTimeout(done, sendTimeout);
          } finally {
            if (!entry.settled) stillSending.push(entry);
          }
        } catch {
          failed = true;
        }
      })(),
    ]);
    // Reached by any channel, or nothing could reach them (no registration, no mail): stop retrying.
    const done = Boolean(pushedAt || mailedAt) || !failed;
    if (done) {
      await ctx.db.insert(sosDeliveries).values({ phoneId, eventId: id, userId: member.id, pushedAt, mailedAt, doneAt: ctx.now() })
        .onConflictDoUpdate({
          target: [sosDeliveries.phoneId, sosDeliveries.eventId, sosDeliveries.userId], set: { doneAt: ctx.now() },
        });
    }
    return done;
  }));
  const sending = stillSending.filter((entry) => !entry.settled);
  let allDone = finished.every(Boolean);
  if (!allDone && stillSending.length && !sending.length) {
    // A mail that outlived its timeout may have got through and been recorded while another parent
    // was still being waited for, so decide from what is recorded, not from this attempt's results.
    // Skipped while a mail is still sending: it cannot give up then, and a failed lookup here would
    // end the attempt before holdLease keeps other processes from sending that mail again.
    const recorded = await ctx.db.select().from(sosDeliveries)
      .where(and(eq(sosDeliveries.phoneId, phoneId), eq(sosDeliveries.eventId, id)));
    const reached = new Set(recorded.filter((d) => d.doneAt || d.pushedAt || d.mailedAt).map((d) => d.userId));
    allDone = members.every((member, i) => finished[i] || reached.has(member.id));
  }
  // Never given up while a mail may still reach the parent, or reached them and only its record
  // failed: it is waited for, or recorded by the next attempt, first.
  const unrecorded = mails.some((entry) => entry.settled && entry.sentAt && !entry.recorded);
  const gaveUp = !allDone && !sending.length && !unrecorded && ctx.now().getTime() - row.receivedAt.getTime() >= SOS_GIVE_UP_MS;
  // While retrying, the lease doubles as the earliest time of the next attempt; while a mail is
  // still with the mail server, it is held until that mail settles (holdLease).
  const next = new Date(ctx.now().getTime() + (sending.length ? LEASE_MS : RETRY_MS));
  await ctx.db.update(sosEvents).set({
    notificationClaimedAt: allDone || gaveUp ? ctx.now() : null,
    notificationLeaseUntil: allDone || gaveUp ? null : next,
    deliveryFailedAt: gaveUp ? ctx.now() : undefined,
    deliveredVia: pushedNow > 0 ? sql`coalesce(${sosEvents.deliveredVia}, 'push')` : undefined,
  }).where(claim);
  if (!allDone && !gaveUp && sending.length) holdLease(ctx, key, next, sending.map((entry) => entry.pending));
  // The dashboard shows how the SOS went out, and when it could not be delivered.
  if (gaveUp || (pushedNow > 0 && row.deliveredVia === null)) {
    publishLive(ctx, { type: "sos.updated", householdId: phone.householdId, phoneId, id });
  }
}

export async function sweepSos(ctx: Ctx) {
  const now = ctx.now();
  const cutoff = sosCutoff(now);
  await ctx.db.delete(sosEvents).where(lt(sosEvents.createdAt, cutoff));
  const pending = await ctx.db.select({ id: sosEvents.id, phoneId: sosEvents.phoneId }).from(sosEvents)
    .where(and(readyForDelivery(now), gt(sosEvents.createdAt, cutoff))).limit(100);
  for (const { id, phoneId } of pending) {
    await deliverSos(ctx, id, phoneId).catch(() => console.error("SOS notification dispatch failed"));
  }
}
