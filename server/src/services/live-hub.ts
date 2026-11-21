// SPDX-License-Identifier: Apache-2.0
//
// The open live connections (GET /api/events, docs/live-updates.md). Each connection belongs to
// one signed-in parent and only gets events of the households they are a member of. Recent events
// sit in a short ring buffer, so a client that reconnects with Last-Event-ID gets what it missed;
// when the gap is too old (or the server restarted) it gets "refetch" and reloads everything.

import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { householdMembers, sessions } from "../db/schema.js";
import { errorSummary } from "../lib/log.js";
import type { Ctx } from "./context.js";
import type { EventBus, LiveEvent } from "./live-events.js";

export interface LiveHubOptions {
  /** A comment line on every open connection, so proxies and clients see it is alive. */
  heartbeatMs: number;
  /** How often a connection re-checks its session and household membership. */
  accessCheckMs: number;
  /** Events kept for Last-Event-ID resume, by count and by age. */
  ringSize: number;
  ringMaxAgeMs: number;
  /** Open connections per parent (tabs, the app, a second device) and on the whole server. */
  maxPerUser: number;
  maxTotal: number;
  /** A client that stops reading is dropped once this much is queued for it. */
  maxQueuedBytes: number;
  /** The reconnect delay suggested to EventSource clients. */
  retryMs: number;
}

export const DEFAULT_LIVE_OPTIONS: LiveHubOptions = {
  heartbeatMs: 25_000,
  accessCheckMs: 60_000,
  ringSize: 1000,
  ringMaxAgeMs: 10 * 60_000,
  maxPerUser: 10,
  maxTotal: 5000,
  maxQueuedBytes: 256 * 1024,
  retryMs: 5_000,
};

interface Connection {
  userId: string;
  sessionId: string;
  households: Set<string>;
  controller: ReadableStreamDefaultController<Uint8Array>;
  checkedAt: number;
  closed: boolean;
}

export type OpenResult =
  | { ok: true; stream: ReadableStream<Uint8Array> }
  | { ok: false; status: 429 | 503; error: string };

const encoder = new TextEncoder();

function frame(id: string | null, event: string, data: unknown): string {
  return `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** What a client sees: no household id (it knows its own), only what is needed to refetch. */
function publicEvent(e: LiveEvent) {
  return { type: e.type, phoneId: e.phoneId, ...(e.id ? { id: e.id } : {}), ...(e.kind ? { kind: e.kind } : {}) };
}

export class LiveHub {
  /** Changes with every start, so an id from before a restart is recognised as unknown. */
  readonly bootId = randomBytes(4).toString("hex");
  readonly opts: LiveHubOptions;
  private seq = 0;
  private ring: { seq: number; at: number; event: LiveEvent }[] = [];
  private readonly byUser = new Map<string, Set<Connection>>();
  private total = 0;
  private timer?: NodeJS.Timeout;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly ctx: Pick<Ctx, "db" | "now">,
    bus: EventBus,
    opts: Partial<LiveHubOptions> = {},
  ) {
    this.opts = { ...DEFAULT_LIVE_OPTIONS, ...opts };
    this.unsubscribe = bus.subscribe((e) => this.dispatch(e));
    this.timer = setInterval(() => void this.tick(), this.opts.heartbeatMs);
    this.timer.unref?.();
  }

  get connectionCount() {
    return this.total;
  }

  /** Opens a stream for a signed-in parent. `lastEventId` comes from the header or the query. */
  async open(userId: string, sessionId: string, lastEventId: string | undefined): Promise<OpenResult> {
    if (this.total >= this.opts.maxTotal) return { ok: false, status: 503, error: "too many live connections; try again later" };
    if ((this.byUser.get(userId)?.size ?? 0) >= this.opts.maxPerUser) {
      return { ok: false, status: 429, error: "too many live connections for this account" };
    }
    const households = await this.memberships(userId);
    // The limits are checked again after the await, so parallel opens cannot pass them together.
    if (this.total >= this.opts.maxTotal) return { ok: false, status: 503, error: "too many live connections; try again later" };
    if ((this.byUser.get(userId)?.size ?? 0) >= this.opts.maxPerUser) {
      return { ok: false, status: 429, error: "too many live connections for this account" };
    }
    let conn!: Connection;
    const stream = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          conn = { userId, sessionId, households, controller, checkedAt: Date.now(), closed: false };
          let set = this.byUser.get(userId);
          if (!set) this.byUser.set(userId, (set = new Set()));
          set.add(conn);
          this.total++;
          this.write(conn, `retry: ${this.opts.retryMs}\n\n`);
          this.resume(conn, lastEventId);
        },
        cancel: () => this.close(conn),
      },
      { highWaterMark: this.opts.maxQueuedBytes, size: (chunk) => chunk.byteLength },
    );
    return { ok: true, stream };
  }

  /** Closes every connection: on shutdown, so the server can stop without waiting for them. */
  closeAll() {
    for (const set of this.byUser.values()) for (const conn of set) this.close(conn, true);
  }

  stop() {
    clearInterval(this.timer);
    this.unsubscribe();
    this.closeAll();
  }

  /** The last event id, for tests and the ready message. */
  get lastId() {
    return `${this.bootId}.${this.seq}`;
  }

  private resume(conn: Connection, lastEventId: string | undefined) {
    const now = Date.now();
    this.trim(now);
    if (lastEventId === undefined || lastEventId === "") {
      this.write(conn, frame(this.lastId, "ready", { resumed: false }));
      return;
    }
    const [boot, n] = lastEventId.split(".");
    const last = Number(n);
    const oldest = this.ring[0]?.seq ?? this.seq + 1;
    // Known only if it is from this start and nothing after it has dropped out of the ring.
    const known = boot === this.bootId && Number.isInteger(last) && last >= 0 && last <= this.seq && last >= oldest - 1;
    if (!known) {
      this.write(conn, frame(this.lastId, "refetch", { reason: boot === this.bootId ? "gap" : "restart" }));
      return;
    }
    for (const entry of this.ring) {
      if (entry.seq > last && conn.households.has(entry.event.householdId)) {
        this.write(conn, frame(`${this.bootId}.${entry.seq}`, entry.event.type, publicEvent(entry.event)));
      }
    }
    this.write(conn, frame(this.lastId, "ready", { resumed: true }));
  }

  private dispatch(e: LiveEvent) {
    const seq = ++this.seq;
    const now = Date.now();
    this.ring.push({ seq, at: now, event: e });
    this.trim(now);
    const text = frame(`${this.bootId}.${seq}`, e.type, publicEvent(e));
    for (const set of this.byUser.values()) {
      for (const conn of set) if (conn.households.has(e.householdId)) this.write(conn, text);
    }
  }

  private trim(now: number) {
    const tooOld = now - this.opts.ringMaxAgeMs;
    let drop = Math.max(0, this.ring.length - this.opts.ringSize);
    while (drop < this.ring.length && this.ring[drop]!.at < tooOld) drop++;
    if (drop) this.ring = this.ring.slice(drop);
  }

  private write(conn: Connection, text: string) {
    if (conn.closed) return;
    try {
      // A client that stopped reading (desiredSize far below zero) is dropped, not buffered forever.
      if ((conn.controller.desiredSize ?? 0) < 0) {
        this.close(conn, true);
        return;
      }
      conn.controller.enqueue(encoder.encode(text));
    } catch {
      this.close(conn);
    }
  }

  private close(conn: Connection | undefined, endStream = false) {
    if (!conn || conn.closed) return;
    conn.closed = true;
    const set = this.byUser.get(conn.userId);
    if (set?.delete(conn)) this.total--;
    if (set && set.size === 0) this.byUser.delete(conn.userId);
    if (endStream) {
      try {
        conn.controller.close();
      } catch {
        // Already closed by the client.
      }
    }
  }

  private async memberships(userId: string): Promise<Set<string>> {
    const rows = await this.ctx.db.select({ id: householdMembers.householdId }).from(householdMembers)
      .where(eq(householdMembers.userId, userId));
    return new Set(rows.map((r) => r.id));
  }

  /** Heartbeat for all, and the periodic access check: a signed-out or removed parent stops getting events. */
  async tick() {
    const now = Date.now();
    const ping = `event: ping\ndata: {}\n\n`;
    const due: Connection[] = [];
    for (const set of this.byUser.values()) {
      for (const conn of set) {
        this.write(conn, ping);
        if (now - conn.checkedAt >= this.opts.accessCheckMs) due.push(conn);
      }
    }
    for (const conn of due) await this.recheck(conn, now);
  }

  private async recheck(conn: Connection, now: number) {
    conn.checkedAt = now;
    try {
      const [session] = await this.ctx.db.select({ id: sessions.id }).from(sessions)
        .where(and(eq(sessions.id, conn.sessionId), gt(sessions.expiresAt, this.ctx.now())));
      if (!session) {
        this.write(conn, frame(null, "bye", { reason: "signed-out" }));
        this.close(conn, true);
        return;
      }
      conn.households = await this.memberships(conn.userId);
    } catch (err) {
      console.error(`live access check failed: ${errorSummary(err)}`);
    }
  }
}
