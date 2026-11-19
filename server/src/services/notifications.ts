// SPDX-License-Identifier: Apache-2.0
//
// Notifications to parents (spec 9): protection removed, a phone offline for long, a
// request waiting for a trusted person, and something the phone asks for. Each event is
// sent once, when it happens, never on every poll. A failed push never fails the request
// that caused it.

import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { householdMembers, notificationMutes, phones, pushSubscriptions, users } from "../db/schema.js";
import { type Locale, phoneAlertMail, type PushLocale, toLocale, toPushLocale } from "../lib/mail-templates.js";
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
  | { type: "request-on-phone"; phoneId: string; phoneName: string; what: string; kind: "app" | "contact" | "more-time" }
  | { type: "safety"; phoneId: string; phoneName: string; what: SafetyNews }
  /** The phone asks for more time. `what` is the app's name, or null for the daily limit. */
  | { type: "moreTime"; requestId: string; phoneId: string; phoneName: string; what: string | null; reason: string | null }
  | { type: "sos"; id: string; phoneId: string; phoneName: string; kind: "urgent" | "help" }
  | { type: "test" }
  /** The weekly summary is ready (docs/weekly-summary.md). */
  | { type: "summary"; summaryId: string };

type TextEvent = Exclude<NotifyEvent, { type: "summary" }>;

/** What a parent hears about a ring or an "Are you okay?" (docs/location.md). */
export type SafetyNews = "here" | "ok" | "call" | "noReplyLocating" | "noReplyNoLocation" | "located";

/** "Tue 08:10" in the phone's own time zone. */
function lastSeen(e: { lastSeenAt: Date; timezone: string }, locale: Locale): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat(locale === "da" ? "da-DK" : "en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
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

/** How long a phone has been quiet: hours, or whole days from two days on. */
function silence(hours: number, locale: Locale): string {
  if (hours >= 48) {
    const d = Math.floor(hours / 24);
    return locale === "da" ? `${d} dage` : `${d} days`;
  }
  if (locale === "da") return hours === 1 ? "1 time" : `${hours} timer`;
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

const text: Record<Locale, (e: TextEvent) => Pick<PushMessage, "title" | "body">> = {
  en: (e) => {
    switch (e.type) {
      case "protection":
        return {
          title: `Protection removed on ${e.phoneName}`,
          body:
            e.reason === "setup-undo"
              ? (e.reportedLate ? "Set-up was undone on the phone. The report arrived late." : "Set-up was undone on the phone.")
              : e.reason === "owner"
                ? "Plainphone no longer controls this phone. Open the app to see what happened."
                : "The lock on this phone is not intact. Open the app to see what happened.",
        };
      case "offline":
        return {
          title: `${e.phoneName} has not been in touch for ${silence(e.hours, "en")}`,
          body: `Last contact ${lastSeen(e, "en")}. It may be switched off, out of battery or reset.`,
        };
      case "approval":
        return { title: "A request is waiting for you", body: `Someone asks to loosen a rule on "${e.phoneName}".` };
      case "request":
        return {
          title: `${e.phoneName} asks for ${e.kind === "app" ? "an app" : "a contact"}`,
          body: `${e.what}. Open the app to approve or decline.`,
        };
      case "request-on-phone":
        return {
          title: `Approved on ${e.phoneName}`,
          body: `${e.what}. A parent approved it on the phone with the PIN. Nothing more to do.`,
        };
      case "moreTime":
        return {
          title: `${e.phoneName} asks for more time`,
          body: `${e.what ?? "The daily limit"} is used up.${e.reason ? ` "${e.reason}"` : ""} Answer here or open the app.`,
        };
      case "safety":
        return {
          here: { title: `${e.phoneName}: "I'm here"`, body: "The button on the phone was pressed." },
          ok: { title: `${e.phoneName}: "Yes, I'm okay"`, body: "No position was sent." },
          call: { title: `${e.phoneName}: "Call me"`, body: "The phone is calling you now." },
          noReplyLocating: { title: `No answer from ${e.phoneName}`, body: "The phone is sending its position." },
          noReplyNoLocation: { title: `No answer from ${e.phoneName}`, body: "\"Are you okay?\" was not answered in time." },
          located: { title: `Position of ${e.phoneName}`, body: "\"Are you okay?\" was not answered. Open the app to see where the phone is." },
        }[e.what];
      case "sos":
        return { title: `${e.kind === "urgent" ? "Urgent SOS" : "SOS"} from ${e.phoneName}`,
          body: e.kind === "urgent" ? "I need help now." : "I need help." };
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
            e.reason === "setup-undo"
              ? (e.reportedLate ? "Opsætningen blev fortrudt på telefonen. Beskeden kom forsinket." : "Opsætningen blev fortrudt på telefonen.")
              : e.reason === "owner"
                ? "Plainphone styrer ikke længere telefonen. Åbn appen for at se, hvad der er sket."
                : "Låsen på telefonen er ikke intakt. Åbn appen for at se, hvad der er sket.",
        };
      case "offline":
        return {
          title: `${e.phoneName} har ikke været i kontakt i ${silence(e.hours, "da")}`,
          body: `Sidst i kontakt ${lastSeen(e, "da")}. Den kan være slukket, løbet tør for strøm eller nulstillet.`,
        };
      case "approval":
        return { title: "En anmodning venter på dig", body: `Nogen beder om at løsne en regel på "${e.phoneName}".` };
      case "request":
        return {
          title: `${e.phoneName} beder om ${e.kind === "app" ? "en app" : "en kontakt"}`,
          body: `${e.what}. Åbn appen for at godkende eller afvise.`,
        };
      case "request-on-phone":
        return {
          title: `Godkendt på ${e.phoneName}`,
          body: `${e.what}. En forælder godkendte det på telefonen med pinkoden. Du skal ikke gøre mere.`,
        };
      case "moreTime":
        return {
          title: `${e.phoneName} beder om mere tid`,
          body: `${e.what ?? "Den daglige grænse"} er brugt op.${e.reason ? ` ”${e.reason}”` : ""} Svar her eller åbn appen.`,
        };
      case "safety":
        return {
          here: { title: `${e.phoneName}: ”Jeg er her”`, body: "Der blev trykket på knappen på telefonen." },
          ok: { title: `${e.phoneName}: ”Ja, jeg er okay”`, body: "Der blev ikke sendt nogen placering." },
          call: { title: `${e.phoneName}: ”Ring til mig”`, body: "Telefonen ringer til dig nu." },
          noReplyLocating: { title: `Intet svar fra ${e.phoneName}`, body: "Telefonen sender sin placering." },
          noReplyNoLocation: { title: `Intet svar fra ${e.phoneName}`, body: "”Er du okay?” blev ikke besvaret i tide." },
          located: { title: `Placering af ${e.phoneName}`, body: "”Er du okay?” blev ikke besvaret. Åbn appen for at se, hvor telefonen er." },
        }[e.what];
      case "sos":
        return { title: `${e.kind === "urgent" ? "Akut SOS" : "SOS"} fra ${e.phoneName}`,
          body: e.kind === "urgent" ? "Jeg har brug for hjælp nu." : "Jeg har brug for hjælp." };
      case "test":
        return { title: "Notifikationer virker", body: "Denne enhed får notifikationer fra Plainphone." };
    }
  },
};

/** The buttons on a "more time" notification. The ids are the answers the API takes. */
const MORE_TIME_ACTIONS: Record<Locale, { id: string; title: string }[]> = {
  en: [{ id: "15", title: "15 min" }, { id: "60", title: "1 hour" }, { id: "day", title: "Rest of the day" }, { id: "no", title: "No" }],
  da: [{ id: "15", title: "15 min" }, { id: "60", title: "1 time" }, { id: "day", title: "Resten af dagen" }, { id: "no", title: "Nej" }],
};

/** "More time" in the languages the other push strings are not translated into yet; they fall back to English. */
const MORE_TIME_TEXT: Record<
  Exclude<PushLocale, Locale>,
  {
    title: (phone: string) => string;
    total: string;
    app: (app: string) => string;
    quote: (reason: string) => string;
    tail: string;
    actions: { id: string; title: string }[];
  }
> = {
  sv: {
    title: (phone) => `${phone} ber om mer tid`,
    total: "Den dagliga gränsen är slut.",
    app: (app) => `Tiden för ${app} är slut.`,
    quote: (reason) => `”${reason}”`,
    tail: "Svara här eller öppna appen.",
    actions: [{ id: "15", title: "15 min" }, { id: "60", title: "1 timme" }, { id: "day", title: "Resten av dagen" }, { id: "no", title: "Nej" }],
  },
  nb: {
    title: (phone) => `${phone} ber om mer tid`,
    total: "Den daglige grensen er brukt opp.",
    app: (app) => `Tiden for ${app} er brukt opp.`,
    quote: (reason) => `«${reason}»`,
    tail: "Svar her eller åpne appen.",
    actions: [{ id: "15", title: "15 min" }, { id: "60", title: "1 time" }, { id: "day", title: "Resten av dagen" }, { id: "no", title: "Nei" }],
  },
  de: {
    title: (phone) => `${phone} bittet um mehr Zeit`,
    total: "Das Tageslimit ist aufgebraucht.",
    app: (app) => `Die Zeit für ${app} ist aufgebraucht.`,
    quote: (reason) => `„${reason}“`,
    tail: "Antworten Sie hier oder öffnen Sie die App.",
    actions: [{ id: "15", title: "15 Min." }, { id: "60", title: "1 Stunde" }, { id: "day", title: "Rest des Tages" }, { id: "no", title: "Nein" }],
  },
};

export function pushMessage(e: NotifyEvent, locale: PushLocale): PushMessage {
  if (e.type === "summary") {
    const w = summaryWords(locale);
    return { title: w.pushTitle, body: w.pushBody, url: `/summary?week=${e.summaryId}`, tag: "weekly-summary", data: { type: "summary" } };
  }
  const more = locale === "sv" || locale === "nb" || locale === "de" ? MORE_TIME_TEXT[locale] : null;
  const t =
    more && e.type === "moreTime"
      ? {
          title: more.title(e.phoneName),
          body: `${e.what === null ? more.total : more.app(e.what)}${e.reason ? ` ${more.quote(e.reason)}` : ""} ${more.tail}`,
        }
      : text[locale === "da" ? "da" : "en"](e);
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
      return { ...t, url: `/phones/${e.phoneId}`, tag: `moretime-${e.requestId.replaceAll("-", "")}`,
        data: { type: "more-time", phoneId: e.phoneId, requestId: e.requestId }, actions: more?.actions ?? MORE_TIME_ACTIONS[locale as Locale] };
    case "safety":
      return { ...t, url: `/phones/${e.phoneId}/location`, tag: `safety-${e.phoneId}-${e.what === "here" ? "ring" : "checkin"}` };
    case "sos":
      return { ...t, url: `/phones/${e.phoneId}`, tag: e.id.replaceAll("-", ""),
        data: { type: e.kind === "urgent" ? "sos-urgent" : "sos-help", phoneId: e.phoneId } };
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
          const language = toPushLocale(locale);
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
