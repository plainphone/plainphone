// SPDX-License-Identifier: Apache-2.0
//
// Live updates for the dashboard and the parent app (docs/live-updates.md). Places that change
// something a parent looks at publish a small event here; the hub (live-hub.ts) streams it to the
// household's open dashboards over server-sent events. Events carry ids only, never names, texts
// or positions: the client refetches through the normal API, with the normal access checks.
// Publishing never fails the request that caused it.

import { eq } from "drizzle-orm";
import type postgres from "postgres";
import { phones } from "../db/schema.js";
import { errorSummary } from "../lib/log.js";
import type { Ctx } from "./context.js";

export const LIVE_EVENT_TYPES = [
  /** A child's phone sent an SOS (also one only reported after an SMS). */
  "sos.created",
  /** An SOS was seen by a parent, delivered by SMS later, or given up as undelivered. */
  "sos.updated",
  /** A request for an app, a contact or more time. */
  "request.created",
  /** A request was answered: by a parent, by a parent on the phone, or it expired. */
  "request.answered",
  /** A new latest position (Find, "always" or after an unanswered "Are you okay?"). */
  "location.updated",
  /** A ring or an "Are you okay?" was shown, answered or went unanswered. */
  "safety.updated",
  /** The family inbox or quick messages: a message, a reply, a delivery or a device receipt. */
  "inbox.message",
  /** The phone's status changed: lock, battery, rules confirmed, online again, paired, gone quiet. */
  "phone.status",
] as const;

export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

export interface LiveEvent {
  type: LiveEventType;
  householdId: string;
  phoneId: string;
  /** The SOS, request or message the event is about, when there is one. */
  id?: string;
  /** For requests: which list to refetch. */
  kind?: "app" | "contact" | "more-time";
}

export interface EventBus {
  readonly name: string;
  publish(e: LiveEvent): void;
  /** Returns the unsubscribe function. */
  subscribe(listener: (e: LiveEvent) => void): () => void;
  close?(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(["app", "contact", "more-time"]);

/** Checks an event from outside the process (Postgres NOTIFY): only the known fields go on. */
export function parseLiveEvent(raw: unknown): LiveEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.type !== "string" || !(LIVE_EVENT_TYPES as readonly string[]).includes(r.type)) return null;
  if (typeof r.householdId !== "string" || !UUID.test(r.householdId)) return null;
  if (typeof r.phoneId !== "string" || !UUID.test(r.phoneId)) return null;
  if (r.id !== undefined && (typeof r.id !== "string" || !UUID.test(r.id))) return null;
  if (r.kind !== undefined && (typeof r.kind !== "string" || !KINDS.has(r.kind))) return null;
  return {
    type: r.type as LiveEventType, householdId: r.householdId, phoneId: r.phoneId,
    ...(r.id !== undefined ? { id: r.id as string } : {}),
    ...(r.kind !== undefined ? { kind: r.kind as LiveEvent["kind"] } : {}),
  };
}

/** One server process: events go straight to the listeners. */
export class LocalEventBus implements EventBus {
  readonly name: string = "local";
  private readonly listeners = new Set<(e: LiveEvent) => void>();

  publish(e: LiveEvent) {
    this.deliver(e);
  }

  subscribe(listener: (e: LiveEvent) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  protected deliver(e: LiveEvent) {
    for (const listener of this.listeners) {
      try {
        listener(e);
      } catch (err) {
        console.error(`live event listener failed: ${errorSummary(err)}`);
      }
    }
  }
}

export const LIVE_CHANNEL = "plainphone_live";

/**
 * Every server process that uses the same database: an event goes out with NOTIFY and comes back
 * to each process (this one too) through LISTEN. Postgres delivers it only after the publishing
 * transaction commits, so a client's refetch always sees the change. While the listening
 * connection is down, events published here still reach this process's own clients.
 */
export class PostgresEventBus extends LocalEventBus {
  override readonly name = "postgres";
  private listening = false;
  private unlisten?: () => Promise<void>;

  constructor(private readonly sql: postgres.Sql, private readonly channel = LIVE_CHANNEL) {
    super();
  }

  async start(): Promise<void> {
    const sub = await this.sql.listen(
      this.channel,
      (payload) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          return;
        }
        const e = parseLiveEvent(parsed);
        if (e) this.deliver(e);
      },
      // Called again after postgres.js reconnects the listening connection.
      () => { this.listening = true; },
    );
    this.listening = true;
    this.unlisten = sub.unlisten;
  }

  override publish(e: LiveEvent) {
    if (!this.listening) {
      this.deliver(e);
      return;
    }
    this.sql.notify(this.channel, JSON.stringify(e)).catch((err) => {
      console.error(`live event notify failed: ${errorSummary(err)}`);
      this.deliver(e);
    });
  }

  async close() {
    this.listening = false;
    await this.unlisten?.().catch(() => {});
  }
}

/** Publishes an event. Never throws: a live update is a nicety, the push and the API are the record. */
export function publishLive(ctx: Pick<Ctx, "events">, e: LiveEvent): void {
  try {
    ctx.events?.publish(e);
  } catch (err) {
    console.error(`live event failed: ${errorSummary(err)}`);
  }
}

/** Publishes an event about a phone when only its id is at hand. */
export async function publishForPhone(
  ctx: Pick<Ctx, "events" | "db">, phoneId: string, type: LiveEventType, extra: Pick<LiveEvent, "id" | "kind"> = {},
): Promise<void> {
  if (!ctx.events) return;
  try {
    const [phone] = await ctx.db.select({ householdId: phones.householdId }).from(phones).where(eq(phones.id, phoneId));
    if (phone) publishLive(ctx, { type, householdId: phone.householdId, phoneId, ...extra });
  } catch (err) {
    console.error(`live event failed: ${errorSummary(err)}`);
  }
}
