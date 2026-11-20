// SPDX-License-Identifier: Apache-2.0
//
// Notifications to parents (spec 9): protection removed, a phone offline for long, a
// request waiting for a trusted person, and something the phone asks for. Each event is
// sent once, when it happens, never on every poll. A failed push never fails the request
// that caused it.

import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { householdMembers, notificationMutes, phones, pushSubscriptions, users } from "../db/schema.js";
import { type Locale, toLocale } from "../lib/locale.js";
import { phoneAlertMail } from "../lib/mail-templates.js";
import { clockTime, followUpWords, moreTimeWords } from "../lib/more-time-words.js";
import { lastSeen, moreTimeActions, pushWords, type SafetyNews } from "../lib/push-text.js";
import { summaryWords } from "../lib/summary-text.js";
import type { PushMessage } from "../providers/parent-push.js";
import { deliverablePushSubscription, discardGonePushSubscription, samePushRegistration } from "./push-subscriptions.js";
import { batchedIntoSummary } from "./alert-policy.js";
import type { Ctx } from "./context.js";
import { recordSummaryEvent } from "./summary-record.js";

/** After this many failed sends in a row (not 404/410), a subscription is dropped. */
const MAX_FAILURES = 20;

export type NotifyEvent =
  | { type: "protection"; phoneId: string; phoneName: string; reason: "lock" | "owner" | "setup-undo"; reportedLate?: boolean; trusted?: boolean }
  | { type: "offline"; phoneId: string; phoneName: string; hours: number; lastSeenAt: Date; timezone: string }
  | { type: "approval"; phoneName: string }
  | { type: "request"; phoneId: string; phoneName: string; what: string; kind: "app" | "contact" }
  | { type: "request-on-phone"; phoneId: string; phoneName: string; what: string | null; kind: "app" | "contact" | "more-time" }
  | { type: "safety"; phoneId: string; phoneName: string; what: SafetyNews }
  /** The phone asks for more time. `what` is the app's name, or null for the daily limit. */
  | { type: "moreTime"; requestId: string; phoneId: string; phoneName: string; what: string | null; reason: string | null; receipts?: boolean }
  /** The phone applied an answer the parent gave from a notification: updates that notification. `at` is in the phone's time zone. */
  | { type: "moreTimeReceipt"; requestId: string; phoneId: string; phoneName: string; answer: "15" | "60" | "day"; at: Date; clockAhead: boolean; timezone: string }
  | { type: "sos"; id: string; phoneId: string; phoneName: string; kind: "urgent" | "help"; trigger?: "power" | "clock" | "code" | null; message?: string | null }
  /** An ordinary quick message from the child's phone, or the child's suggestion for a new one (docs/sos.md). */
  | { type: "quickMessage"; id: string; phoneId: string; phoneName: string; text: string }
  | { type: "quickSuggestion"; phoneId: string; phoneName: string; text: string }
  /** "I'm home" from the family inbox (docs/family-inbox.md). */
  | { type: "checkIn"; id: string; phoneId: string; phoneName: string }
  | { type: "test" }
  /** The weekly summary is ready (docs/weekly-summary.md). */
  | { type: "summary"; summaryId: string };

type TextEvent = Exclude<NotifyEvent, { type: "summary" | "moreTimeReceipt" }>;

/** The notification's tag for one request: the buttons, the follow-up and the receipt all share it. */
export const moreTimeTag = (requestId: string) => `moretime-${requestId.replaceAll("-", "")}`;

export type { SafetyNews };

/** The title and body of an event, from the tables in lib/push-text.ts. */
function words(e: TextEvent, locale: Locale): Pick<PushMessage, "title" | "body"> {
  switch (e.type) {
    case "protection": return pushWords.protection(e, locale);
    case "offline": return pushWords.offline(e, locale);
    case "approval": return pushWords.approval(e, locale);
    case "request": return pushWords.request(e, locale);
    case "request-on-phone": return pushWords.requestOnPhone(e, locale);
    case "moreTime": return pushWords.moreTime(e, locale);
    case "safety": return pushWords.safety(e, locale);
    case "sos": return pushWords.sos(e, locale);
    case "quickMessage": return pushWords.quickMessage(e, locale);
    case "quickSuggestion": return pushWords.quickSuggestion(e, locale);
    case "checkIn": return pushWords.checkIn(e, locale);
    case "test": return pushWords.test(locale);
  }
}

export function pushMessage(e: NotifyEvent, locale: Locale): PushMessage {
  if (e.type === "summary") {
    const w = summaryWords(locale);
    return { title: w.pushTitle, body: w.pushBody, url: `/summary?week=${e.summaryId}`, tag: "weekly-summary", data: { type: "summary" } };
  }
  if (e.type === "moreTimeReceipt") {
    const w = moreTimeWords(locale);
    const time = clockTime(e.at, e.timezone, locale);
    // Same tag as the notification with the buttons, so this replaces it (or the follow-up that took its place).
    return {
      title: e.phoneName,
      body: `${w.done[e.answer]}. ${e.clockAhead ? w.clockAhead(time) : w.active(time)}`,
      url: `/phones/${e.phoneId}`,
      tag: moreTimeTag(e.requestId),
      silent: true,
      data: { type: "more-time-receipt", phoneId: e.phoneId, requestId: e.requestId },
    };
  }
  const t = words(e, locale);
  switch (e.type) {
    case "protection":
      return { ...t, url: e.trusted ? "/approvals" : e.reason === "setup-undo" ? "/" : `/phones/${e.phoneId}`, tag: `lock-${e.phoneId}` };
    case "offline":
      return { ...t, url: `/phones/${e.phoneId}`, tag: `offline-${e.phoneId}` };
    case "approval":
      return { ...t, url: "/approvals", tag: "approvals" };
    case "request":
      return { ...t, url: `/phones/${e.phoneId}`, tag: `request-${e.phoneId}` };
    case "request-on-phone":
      return { ...t, url: `/phones/${e.phoneId}`, tag: `request-${e.phoneId}` };
    case "moreTime":
      return { ...t, url: `/phones/${e.phoneId}`, tag: moreTimeTag(e.requestId),
        // The lines for what a tap on a button leads to, so the service worker can say it in the parent's language.
        data: { type: "more-time", phoneId: e.phoneId, requestId: e.requestId, phoneName: e.phoneName, receipts: e.receipts !== false, words: followUpWords(locale, e.receipts !== false) },
        actions: moreTimeActions(locale) };
    case "safety":
      return { ...t, url: `/phones/${e.phoneId}/location`, tag: `safety-${e.phoneId}-${e.what === "here" ? "ring" : "checkin"}` };
    case "sos":
      return { ...t, url: `/phones/${e.phoneId}`, tag: e.id.replaceAll("-", ""),
        data: { type: e.kind === "urgent" ? "sos-urgent" : "sos-help", phoneId: e.phoneId } };
    case "quickMessage":
      return { ...t, url: `/phones/${e.phoneId}`, tag: `quick-${e.id.replaceAll("-", "")}`, data: { type: "quick-message", phoneId: e.phoneId } };
    case "checkIn":
      return { ...t, url: `/phones/${e.phoneId}`, tag: `checkin-${e.id.replaceAll("-", "")}`, data: { type: "check-in", phoneId: e.phoneId } };
    case "quickSuggestion":
      return { ...t, url: `/phones/${e.phoneId}`, tag: `quick-suggestion-${e.phoneId}`, data: { type: "quick-suggestion", phoneId: e.phoneId } };
    case "test":
      return { ...t, url: "/settings", tag: "test" };
  }
}

/** Sends one event to every subscription of the given users. Returns how many were sent. */
export async function notifyUsers(
  ctx: Ctx,
  userIds: string[],
  e: NotifyEvent,
  opts: { subscriptionId?: string; urgent?: boolean; respectMuteFor?: string; onFailure?: () => void; keepOnTransientFailure?: boolean } = {},
): Promise<number> {
  if (userIds.length === 0) return 0;
  try {
    const subs = await ctx.db
      .select({ sub: pushSubscriptions, locale: users.locale })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(
        and(
          inArray(pushSubscriptions.userId, userIds),
          deliverablePushSubscription(),
          opts.subscriptionId ? eq(pushSubscriptions.id, opts.subscriptionId) : undefined,
          opts.respectMuteFor ? notInArray(pushSubscriptions.userId, ctx.db.select({ id: notificationMutes.userId })
            .from(notificationMutes).where(eq(notificationMutes.phoneId, opts.respectMuteFor))) : undefined,
        ),
      );
    const urgent = opts.urgent ?? (e.type === "protection" || (e.type === "sos" && e.kind === "urgent"));
    const results = await Promise.all(
      subs.map(async ({ sub, locale }) => {
        const sameRegistration = samePushRegistration(sub);
        let outcome: Awaited<ReturnType<Ctx["parentPush"]["send"]>>;
        try {
          const language = toLocale(locale);
          const message = pushMessage(e, language);
          outcome = await ctx.parentPush.send(sub, message, { urgent });
        } catch (err) {
          console.error(`push send failed: ${(err as Error).message}`);
          outcome = "failed";
        }
        if (outcome === "sent") {
          await ctx.db
            .update(pushSubscriptions)
            .set({ lastSuccessAt: ctx.now(), failures: 0 })
            .where(sameRegistration);
          return 1;
        }
        if (outcome === "failed") opts.onFailure?.();
        // A retried alert must not use up a subscription's allowance: only a permanent error deletes it.
        if (outcome === "failed" && opts.keepOnTransientFailure) return 0;
        if (outcome === "gone" || (outcome === "failed" && sub.platform === "web" && sub.failures + 1 >= MAX_FAILURES)) {
          await discardGonePushSubscription(ctx, sub);
        } else if (outcome === "failed") {
          await ctx.db
            .update(pushSubscriptions)
            .set({ failures: sql`${pushSubscriptions.failures} + 1` })
            .where(sameRegistration);
        }
        return 0;
      }),
    );
    return results.reduce<number>((a, b) => a + b, 0);
  } catch (err) {
    opts.onFailure?.();
    console.error(`notification failed: ${(err as Error).message}`);
    return 0;
  }
}

/** Sends an event about a phone to the parents of its household who have not muted it. */
export async function notifyHousehold(ctx: Ctx, phoneId: string, e: NotifyEvent, opts: { urgent?: boolean } = {}): Promise<number> {
  const [phone] = await ctx.db.select({ householdId: phones.householdId, summaryOn: phones.weeklySummaryEnabled }).from(phones).where(eq(phones.id, phoneId));
  if (!phone) return 0;
  if (phone.summaryOn) await noteForSummary(ctx, phoneId, e);
  // "Can wait" news is in the summary instead (docs/weekly-summary.md); everything else goes now.
  if (await batchedIntoSummary(ctx, phone.householdId, e)) return 0;
  return notifyAlertRecipients(ctx, await phoneAlertRecipients(ctx.db, phoneId, phone.householdId), e, opts);
}

/** Notes protection, offline and check-in news for the weekly summary, whether or not it is also pushed. */
async function noteForSummary(ctx: Ctx, phoneId: string, e: NotifyEvent): Promise<void> {
  const kind = e.type === "protection" ? "protection" : e.type === "offline" ? "offline"
    : e.type === "safety" && (e.what === "here" || e.what === "ok") ? "checkin" : null;
  if (kind) await recordSummaryEvent(ctx.db, phoneId, kind, ctx.now());
}

type RecipientDb = Ctx["db"] | Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

export async function phoneAlertRecipients(db: RecipientDb, phoneId: string, householdId: string) {
  const muted = db
    .select({ id: notificationMutes.userId })
    .from(notificationMutes)
    .where(eq(notificationMutes.phoneId, phoneId));
  return db
    .select({ id: householdMembers.userId, email: users.email, locale: users.locale })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(and(eq(householdMembers.householdId, householdId), notInArray(householdMembers.userId, muted)));
}

export async function notifyAlertRecipients(
  ctx: Ctx,
  members: Awaited<ReturnType<typeof phoneAlertRecipients>>,
  e: NotifyEvent,
  opts: { urgent?: boolean } = {},
): Promise<number> {
  // A phone that went silent or lost its lock also gets a mail (issue #22), so parents
  // without push hear about it too. Requests are push only: they are frequent and not urgent.
  if ((e.type === "protection" || e.type === "offline") && ctx.mail.canSend) {
    for (const m of members) {
      const locale = toLocale(m.locale);
      try {
        await ctx.mail.send(
          phoneAlertMail(
            m.email,
            locale,
            ctx.cfg.PUBLIC_URL,
            e.type === "protection"
              ? { kind: "protection", phoneId: e.phoneId, phoneName: e.phoneName, reason: e.reason, trusted: e.trusted }
              : { kind: "offline", phoneId: e.phoneId, phoneName: e.phoneName, hours: e.hours, lastSeen: lastSeen(e, locale) },
          ),
        );
      } catch (err) {
        console.error(`alert mail failed: ${(err as Error).message}`);
      }
    }
  }
  return notifyUsers(
    ctx,
    members.map((m) => m.id),
    e,
    opts,
  );
}

interface StatusLike {
  lockIntact: boolean;
  deviceOwner: boolean;
  maintenance: boolean;
}

/**
 * Whether a new status report means protection was just removed. Only a change from
 * protected to unprotected counts, so a phone that keeps reporting a broken lock is not
 * reported again. A maintenance unlock (the parent's PIN) is not a removal.
 */
export function protectionLost(prev: StatusLike | null, next: StatusLike): "lock" | "owner" | null {
  // The first report after pairing counts too: a phone that starts out unprotected is news.
  if (!prev) return next.deviceOwner && !next.lockIntact && !next.maintenance ? "lock" : null;
  if (prev.deviceOwner && !next.deviceOwner) return "owner";
  const wasProtected = prev.lockIntact || prev.maintenance;
  if (wasProtected && !next.lockIntact && !next.maintenance) return "lock";
  return null;
}

/** Finds phones that went quiet and tells their parents once. Called by the sweeper. */
export async function alertOfflinePhones(ctx: Ctx): Promise<number> {
  // The parents' choice for the phone, else the server default; 0 means never.
  const hours = sql`coalesce(${phones.offlineAlertHours}, ${ctx.cfg.OFFLINE_ALERT_HOURS}::int)`;
  // Claim the alert first, so two sweeps (or two servers) cannot both send it.
  const claimed = await ctx.db
    .update(phones)
    .set({ offlineAlertedAt: ctx.now() })
    .where(
      and(
        isNotNull(phones.lastSeenAt),
        isNull(phones.offlineAlertedAt),
        sql`${hours} > 0`,
        sql`${phones.lastSeenAt} < ${ctx.now().toISOString()}::timestamptz - make_interval(hours => ${hours})`,
      ),
    )
    .returning({
      id: phones.id,
      name: phones.name,
      lastSeenAt: phones.lastSeenAt,
      timezone: phones.timezone,
      hours: phones.offlineAlertHours,
    });
  for (const p of claimed) {
    await notifyHousehold(ctx, p.id, {
      type: "offline",
      phoneId: p.id,
      phoneName: p.name,
      // The real silence, not the threshold: after a server pause it can be much longer.
      hours: Math.max(
        p.hours ?? ctx.cfg.OFFLINE_ALERT_HOURS,
        Math.floor((ctx.now().getTime() - p.lastSeenAt!.getTime()) / 3_600_000),
      ),
      lastSeenAt: p.lastSeenAt!,
      timezone: p.timezone,
    });
  }
  return claimed.length;
}
