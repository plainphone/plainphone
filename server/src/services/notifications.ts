// SPDX-License-Identifier: Apache-2.0
//
// Notifications to parents (spec 9): protection removed, a phone offline for long, a
// request waiting for a trusted person, and something the phone asks for. Each event is
// sent once, when it happens, never on every poll. A failed push never fails the request
// that caused it.

import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { householdMembers, notificationMutes, phones, pushSubscriptions, users } from "../db/schema.js";
import { type Locale, phoneAlertMail, toLocale } from "../lib/mail-templates.js";
import type { PushMessage } from "../providers/parent-push.js";
import type { Ctx } from "./context.js";

/** After this many failed sends in a row (not 404/410), a subscription is dropped. */
const MAX_FAILURES = 20;

export type NotifyEvent =
  | { type: "protection"; phoneId: string; phoneName: string; reason: "lock" | "owner" }
  | { type: "offline"; phoneId: string; phoneName: string; hours: number; lastSeenAt: Date; timezone: string }
  | { type: "approval"; phoneName: string }
  | { type: "request"; phoneId: string; phoneName: string; what: string; kind: "app" | "contact" }
  | { type: "test" };

/** "Tue 08:10" in the phone's own time zone. */
function lastSeen(e: { lastSeenAt: Date; timezone: string }, locale: Locale): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat(locale === "da" ? "da-DK" : "en-GB", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    }).format(e.lastSeenAt);
  try {
    return fmt(e.timezone);
  } catch {
    return fmt("UTC");
  }
}

const text: Record<Locale, (e: NotifyEvent) => Pick<PushMessage, "title" | "body">> = {
  en: (e) => {
    switch (e.type) {
      case "protection":
        return {
          title: `Protection removed on ${e.phoneName}`,
          body:
            e.reason === "owner"
              ? "Plainphone no longer controls this phone. Open the app to see what happened."
              : "The lock on this phone is not intact. Open the app to see what happened.",
        };
      case "offline":
        return {
          title: `${e.phoneName} has not been in touch for ${e.hours} hours`,
          body: `Last contact ${lastSeen(e, "en")}. It may be switched off, out of battery or reset.`,
        };
      case "approval":
        return { title: "A request is waiting for you", body: `Someone asks to loosen a rule on "${e.phoneName}".` };
      case "request":
        return {
          title: `${e.phoneName} asks for ${e.kind === "app" ? "an app" : "a contact"}`,
          body: `${e.what}. Open the app to approve or decline.`,
        };
      case "test":
        return { title: "Notifications work", body: "This device will get Plainphone notifications." };
    }
  },
  da: (e) => {
    switch (e.type) {
      case "protection":
        return {
          title: `Beskyttelsen er fjernet på ${e.phoneName}`,
          body:
            e.reason === "owner"
              ? "Plainphone styrer ikke længere telefonen. Åbn appen for at se, hvad der er sket."
              : "Låsen på telefonen er ikke intakt. Åbn appen for at se, hvad der er sket.",
        };
      case "offline":
        return {
          title: `${e.phoneName} har ikke været i kontakt i ${e.hours} timer`,
          body: `Sidst i kontakt ${lastSeen(e, "da")}. Den kan være slukket, løbet tør for strøm eller nulstillet.`,
        };
      case "approval":
        return { title: "En anmodning venter på dig", body: `Nogen beder om at løsne en regel på "${e.phoneName}".` };
      case "request":
        return {
          title: `${e.phoneName} beder om ${e.kind === "app" ? "en app" : "en kontakt"}`,
          body: `${e.what}. Åbn appen for at godkende eller afvise.`,
        };
      case "test":
        return { title: "Notifikationer virker", body: "Denne enhed får notifikationer fra Plainphone." };
    }
  },
};

export function pushMessage(e: NotifyEvent, locale: Locale): PushMessage {
  const t = text[locale](e);
  switch (e.type) {
    case "protection":
      return { ...t, url: `/phones/${e.phoneId}`, tag: `lock-${e.phoneId}` };
    case "offline":
      return { ...t, url: `/phones/${e.phoneId}`, tag: `offline-${e.phoneId}` };
    case "approval":
      return { ...t, url: "/approvals", tag: "approvals" };
    case "request":
      return { ...t, url: `/phones/${e.phoneId}`, tag: `request-${e.phoneId}` };
    case "test":
      return { ...t, url: "/settings", tag: "test" };
  }
}

/** Sends one event to every subscription of the given users. Returns how many were sent. */
export async function notifyUsers(
  ctx: Ctx,
  userIds: string[],
  e: NotifyEvent,
  opts: { subscriptionId?: string } = {},
): Promise<number> {
  if (userIds.length === 0 || !ctx.parentPush.webPublicKey) return 0;
  try {
    const subs = await ctx.db
      .select({ sub: pushSubscriptions, locale: users.locale })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(
        and(
          inArray(pushSubscriptions.userId, userIds),
          opts.subscriptionId ? eq(pushSubscriptions.id, opts.subscriptionId) : undefined,
        ),
      );
    const urgent = e.type === "protection";
    const results = await Promise.all(
      subs.map(async ({ sub, locale }) => {
        let outcome: Awaited<ReturnType<Ctx["parentPush"]["send"]>>;
        try {
          outcome = await ctx.parentPush.send(sub, pushMessage(e, toLocale(locale)), { urgent });
        } catch (err) {
          console.error(`push send failed: ${(err as Error).message}`);
          outcome = "failed";
        }
        if (outcome === "sent") {
          await ctx.db
            .update(pushSubscriptions)
            .set({ lastSuccessAt: ctx.now(), failures: 0 })
            .where(eq(pushSubscriptions.id, sub.id));
          return 1;
        }
        if (outcome === "gone" || (outcome === "failed" && sub.failures + 1 >= MAX_FAILURES)) {
          await ctx.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        } else if (outcome === "failed") {
          await ctx.db
            .update(pushSubscriptions)
            .set({ failures: sql`${pushSubscriptions.failures} + 1` })
            .where(eq(pushSubscriptions.id, sub.id));
        }
        return 0;
      }),
    );
    return results.reduce<number>((a, b) => a + b, 0);
  } catch (err) {
    console.error(`notification failed: ${(err as Error).message}`);
    return 0;
  }
}

/** Sends an event about a phone to the parents of its household who have not muted it. */
export async function notifyHousehold(ctx: Ctx, phoneId: string, e: NotifyEvent): Promise<number> {
  const [phone] = await ctx.db.select({ householdId: phones.householdId }).from(phones).where(eq(phones.id, phoneId));
  if (!phone) return 0;
  const muted = ctx.db
    .select({ id: notificationMutes.userId })
    .from(notificationMutes)
    .where(eq(notificationMutes.phoneId, phoneId));
  const members = await ctx.db
    .select({ id: householdMembers.userId, email: users.email, locale: users.locale })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(and(eq(householdMembers.householdId, phone.householdId), notInArray(householdMembers.userId, muted)));
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
              ? { kind: "protection", phoneId: e.phoneId, phoneName: e.phoneName, reason: e.reason }
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
      hours: p.hours ?? ctx.cfg.OFFLINE_ALERT_HOURS,
      lastSeenAt: p.lastSeenAt!,
      timezone: p.timezone,
    });
  }
  return claimed.length;
}
