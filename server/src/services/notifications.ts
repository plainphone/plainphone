// SPDX-License-Identifier: Apache-2.0
//
// Notifications to parents (spec 9): protection removed, a phone offline for long, a
// request waiting for a trusted person, and something the phone asks for. Each event is
// sent once, when it happens, never on every poll. A failed push never fails the request
// that caused it.

import { and, eq, inArray, isNotNull, isNull, lt, notInArray, sql } from "drizzle-orm";
import { householdMembers, notificationMutes, phones, pushSubscriptions, users } from "../db/schema.js";
import { type Locale, toLocale } from "../lib/mail-templates.js";
import type { PushMessage } from "../providers/parent-push.js";
import type { Ctx } from "./context.js";

/** After this many failed sends in a row (not 404/410), a subscription is dropped. */
const MAX_FAILURES = 20;

export type NotifyEvent =
  | { type: "protection"; phoneId: string; phoneName: string; reason: "lock" | "owner" }
  | { type: "offline"; phoneId: string; phoneName: string; hours: number }
  | { type: "approval"; phoneName: string }
  | { type: "request"; phoneId: string; phoneName: string; what: string; kind: "app" | "contact" }
  | { type: "test" };

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
          title: `${e.phoneName} has been offline for ${e.hours} hours`,
          body: "It may be switched off or without a network. The rules still apply on the phone.",
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
          title: `${e.phoneName} har været offline i ${e.hours} timer`,
          body: "Den kan være slukket eller uden net. Reglerne gælder stadig på telefonen.",
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
      return { ...t, url: `/phones/${e.phoneId}`, tag: `lock-${e.phoneId}`, channel: "alerts" };
    case "offline":
      return { ...t, url: `/phones/${e.phoneId}`, tag: `offline-${e.phoneId}`, channel: "alerts" };
    case "approval":
      return { ...t, url: "/approvals", tag: "approvals", channel: "approval" };
    case "request":
      return { ...t, url: `/phones/${e.phoneId}`, tag: `request-${e.phoneId}`, channel: "approval" };
    case "test":
      return { ...t, url: "/settings", tag: "test", channel: "alerts" };
  }
}

/** Sends one event to every subscription of the given users. Returns how many were sent. */
export async function notifyUsers(
  ctx: Ctx,
  userIds: string[],
  e: NotifyEvent,
  opts: { subscriptionId?: string } = {},
): Promise<number> {
  if (userIds.length === 0 || ctx.parentPush.platforms.size === 0) return 0;
  try {
    const subs = await ctx.db
      .select({ sub: pushSubscriptions, locale: users.locale })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(
        and(
          inArray(pushSubscriptions.userId, userIds),
          inArray(pushSubscriptions.platform, [...ctx.parentPush.platforms]),
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
  if (ctx.parentPush.platforms.size === 0) return 0;
  const [phone] = await ctx.db.select({ householdId: phones.householdId }).from(phones).where(eq(phones.id, phoneId));
  if (!phone) return 0;
  const muted = ctx.db
    .select({ id: notificationMutes.userId })
    .from(notificationMutes)
    .where(eq(notificationMutes.phoneId, phoneId));
  const members = await ctx.db
    .select({ id: householdMembers.userId })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, phone.householdId), notInArray(householdMembers.userId, muted)));
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
  if (!prev) return null;
  if (prev.deviceOwner && !next.deviceOwner) return "owner";
  const wasProtected = prev.lockIntact || prev.maintenance;
  if (wasProtected && !next.lockIntact && !next.maintenance) return "lock";
  return null;
}

/** Finds phones that went quiet and tells their parents once. Called by the sweeper. */
export async function alertOfflinePhones(ctx: Ctx): Promise<number> {
  const hours = ctx.cfg.OFFLINE_ALERT_HOURS;
  if (hours <= 0) return 0;
  const cutoff = new Date(ctx.now().getTime() - hours * 3_600_000);
  // Claim the alert first, so two sweeps (or two servers) cannot both send it.
  const claimed = await ctx.db
    .update(phones)
    .set({ offlineAlertedAt: ctx.now() })
    .where(and(isNotNull(phones.lastSeenAt), lt(phones.lastSeenAt, cutoff), isNull(phones.offlineAlertedAt)))
    .returning({ id: phones.id, name: phones.name });
  for (const p of claimed) {
    await notifyHousehold(ctx, p.id, { type: "offline", phoneId: p.id, phoneName: p.name, hours });
  }
  return claimed.length;
}
