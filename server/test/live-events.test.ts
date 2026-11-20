// SPDX-License-Identifier: Apache-2.0
// Live updates over server-sent events (docs/live-updates.md). The harness clock is fixed.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db/client.js";
import { householdMembers, sosEvents } from "../src/db/schema.js";
import { type LiveEvent, parseLiveEvent, PostgresEventBus } from "../src/services/live-events.js";
import { LiveHub, type LiveHubOptions } from "../src/services/live-hub.js";
import { alertOfflinePhones } from "../src/services/notifications.js";
import { statusVisiblyChanged } from "../src/services/live-status.js";
import { createTestDatabase } from "./db.js";
import { type Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

interface Sse {
  event: string;
  id?: string;
  data: any;
}

/** A reader over one open stream. Each read waits at most `ms`. */
class Stream {
  private buffer = "";
  private pending?: Promise<ReadableStreamReadResult<Uint8Array>>;
  private readonly decoder = new TextDecoder();
  ended = false;
  constructor(readonly res: Response, private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  private async more(ms: number): Promise<boolean> {
    this.pending ??= this.reader.read();
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms));
    const r = await Promise.race([this.pending, timeout]);
    if (r === "timeout") return false;
    this.pending = undefined;
    if (r.done) {
      this.ended = true;
      return false;
    }
    this.buffer += this.decoder.decode(r.value, { stream: true });
    return true;
  }

  private take(): Sse | null {
    for (;;) {
      const end = this.buffer.indexOf("\n\n");
      if (end < 0) return null;
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const e: Partial<Sse> & { data?: string } = {};
      for (const line of block.split("\n")) {
        const at = line.indexOf(": ");
        const [field, value] = at < 0 ? [line.replace(/:$/, ""), ""] : [line.slice(0, at), line.slice(at + 2)];
        if (field === "event") e.event = value;
        else if (field === "id") e.id = value;
        else if (field === "data") e.data = value;
      }
      if (e.event) return { event: e.event, id: e.id, data: e.data ? JSON.parse(e.data) : null };
    }
  }

  /** The next event, skipping pings unless asked for. */
  async next(ms = 2000, opts: { pings?: boolean } = {}): Promise<Sse | null> {
    const deadline = Date.now() + ms;
    for (;;) {
      const e = this.take();
      if (e && (opts.pings || e.event !== "ping")) return e;
      if (e) continue;
      const left = deadline - Date.now();
      if (left <= 0 || this.ended) return null;
      await this.more(left);
    }
  }

  async until(event: string, ms = 2000): Promise<Sse> {
    for (;;) {
      const e = await this.next(ms, { pings: event === "ping" });
      if (!e) throw new Error(`no ${event} event`);
      if (e.event === event) return e;
    }
  }

  /** Every event (but pings) that arrives within `ms`. */
  async drain(ms = 150): Promise<Sse[]> {
    const out: Sse[] = [];
    for (;;) {
      const e = await this.next(ms);
      if (!e) return out;
      out.push(e);
    }
  }

  async close() {
    await this.reader.cancel().catch(() => {});
  }
}

const streams: Stream[] = [];
afterEach(async () => {
  await Promise.all(streams.splice(0).map((s) => s.close()));
  // An SOS is delivered in the background: let it finish before the next test empties the tables.
  await vi.waitFor(async () => {
    const open = (await h.ctx.db.select().from(sosEvents)).filter((e) => !e.notificationClaimedAt);
    expect(open).toEqual([]);
  });
});

async function open(client: Client | null, headers: Record<string, string> = {}, path = "/api/events") {
  const res = await h.app.request(path, {
    headers: { ...(client?.token ? { authorization: `Bearer ${client.token}` } : {}), ...headers },
  });
  if (!res.body || res.status !== 200) return { res, stream: null };
  const stream = new Stream(res, res.body.getReader());
  streams.push(stream);
  return { res, stream };
}

async function connect(client: Client, headers: Record<string, string> = {}) {
  const { res, stream } = await open(client, headers);
  expect(res.status).toBe(200);
  await stream!.until("ready");
  return stream!;
}

/** A hub the test controls: heartbeats and access checks only when the test calls tick(). */
function useHub(opts: Partial<LiveHubOptions> = {}) {
  const hub = new LiveHub(h.ctx, h.ctx.events!, { heartbeatMs: 3_600_000, ...opts });
  h.app = createApp(h.ctx, { live: hub });
  return hub;
}

async function household(email: string) {
  const parent = await signIn(h, email);
  const paired = await pairPhone(h, parent, { name: "Sam" });
  return { parent, ...paired };
}

const sos = (device: Client, id = randomUUID()) => device.post("/api/device/sos", { id, kind: "urgent" });

describe("GET /api/events", () => {
  it("needs a session and refuses device tokens", async () => {
    expect((await open(null)).res.status).toBe(401);
    const { device } = await household("a@example.org");
    expect((await open(device)).res.status).toBe(403);
  });

  it("streams with headers that keep proxies from buffering, and says ready", async () => {
    const { parent } = await household("a@example.org");
    const { res, stream } = await open(parent);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(res.headers.get("cache-control")).toContain("no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const ready = await stream!.until("ready");
    expect(ready.data).toEqual({ resumed: false });
    expect(ready.id).toMatch(/^[0-9a-f]{8}\.\d+$/);
  });

  it("works with the session cookie, as EventSource sends it", async () => {
    const { parent } = await household("a@example.org");
    const { res, stream } = await open(null, { cookie: `pp_session=${parent.token}` });
    expect(res.status).toBe(200);
    await stream!.until("ready");
  });
});

describe("household isolation", () => {
  it("never sends a parent another household's events", async () => {
    const a = await household("a@example.org");
    const b = await household("b@example.org");
    const streamA = await connect(a.parent);
    const streamB = await connect(b.parent);

    const id = randomUUID();
    expect((await sos(b.device, id)).status).toBe(200);

    const got = await streamB.until("sos.created");
    expect(got.data).toEqual({ type: "sos.created", phoneId: b.phoneId, id });
    expect(await streamA.drain()).toEqual([]);
  });

  it("reaches every member of the household, and stops when one is removed", async () => {
    const hub = useHub({ accessCheckMs: 0 });
    const { phoneId, device } = await household("a@example.org");
    // Add a second parent to the household directly; invites are tested elsewhere.
    const [own] = await h.ctx.db.select().from(householdMembers);
    const second = await signIn(h, "second@example.org");
    const { user } = (await second.get("/api/me")).json;
    await h.ctx.db.insert(householdMembers).values({ householdId: own!.householdId, userId: user.id, role: "parent" });

    const stream = await connect(second);
    await sos(device);
    expect((await stream.until("sos.created")).data.phoneId).toBe(phoneId);

    await h.ctx.db.delete(householdMembers).where(eq(householdMembers.userId, user.id));
    await hub.tick();
    await sos(device);
    expect((await stream.drain()).map((e) => e.event)).not.toContain("sos.created");
  });
});

describe("resume with Last-Event-ID", () => {
  it("replays what was missed, only the household's own", async () => {
    const a = await household("a@example.org");
    const b = await household("b@example.org");
    const first = await connect(a.parent);
    await sos(a.device);
    const seen = await first.until("sos.created");
    await first.close();

    const missed = randomUUID();
    await sos(a.device, missed);
    await sos(b.device);

    const { stream } = await open(a.parent, { "last-event-id": seen.id! });
    const replay = await stream!.until("sos.created");
    expect(replay.data.id).toBe(missed);
    const after = await stream!.next();
    expect(after).toMatchObject({ event: "ready", data: { resumed: true } });
  });

  it("takes the id from the query for clients that cannot set the header", async () => {
    const { parent, device } = await household("a@example.org");
    const first = await connect(parent);
    await sos(device);
    const seen = await first.until("sos.created");
    await first.close();
    const missed = randomUUID();
    await sos(device, missed);
    const { stream } = await open(parent, {}, `/api/events?lastEventId=${encodeURIComponent(seen.id!)}`);
    expect((await stream!.until("sos.created")).data.id).toBe(missed);
  });

  it("asks for a refetch after a restart or when the gap has left the buffer", async () => {
    useHub({ ringSize: 2 });
    const { parent, device } = await household("a@example.org");

    const { stream: restarted } = await open(parent, { "last-event-id": "00000000.5" });
    expect(await restarted!.next()).toMatchObject({ event: "refetch", data: { reason: "restart" } });

    const first = await connect(parent);
    await sos(device);
    const seen = await first.until("sos.created");
    await first.close();
    for (let i = 0; i < 3; i++) await sos(device);
    const { stream: gap } = await open(parent, { "last-event-id": seen.id! });
    expect(await gap!.next()).toMatchObject({ event: "refetch", data: { reason: "gap" } });
  });
});

describe("heartbeat and access", () => {
  it("pings every open connection", async () => {
    const hub = useHub();
    const { parent } = await household("a@example.org");
    const stream = await connect(parent);
    await hub.tick();
    expect((await stream.until("ping")).data).toEqual({});
  });

  it("pings on its own timer", async () => {
    useHub({ heartbeatMs: 30 });
    const { parent } = await household("a@example.org");
    const stream = await connect(parent);
    await stream.until("ping", 1000);
  });

  it("ends the stream when the parent signs out", async () => {
    const hub = useHub({ accessCheckMs: 0 });
    const { parent } = await household("a@example.org");
    const stream = await connect(parent);
    expect((await parent.post("/api/auth/logout")).status).toBe(204);
    await hub.tick();
    expect(await stream.until("bye")).toMatchObject({ data: { reason: "signed-out" } });
    expect(await stream.next(500)).toBeNull();
    expect(stream.ended).toBe(true);
    expect(hub.connectionCount).toBe(0);
  });
});

describe("connection limits", () => {
  it("allows a few connections per parent and frees a slot when one closes", async () => {
    const hub = useHub({ maxPerUser: 2 });
    const { parent } = await household("a@example.org");
    const one = await connect(parent);
    await connect(parent);
    const third = await open(parent);
    expect(third.res.status).toBe(429);
    expect(third.res.headers.get("retry-after")).toBe("30");

    // Someone else is not affected.
    const other = await household("b@example.org");
    await connect(other.parent);

    await one.close();
    expect(hub.connectionCount).toBe(2);
    await connect(parent);
  });

  it("caps the whole server", async () => {
    useHub({ maxTotal: 1 });
    const a = await household("a@example.org");
    const b = await household("b@example.org");
    await connect(a.parent);
    expect((await open(b.parent)).res.status).toBe(503);
  });
});

describe("events from the places that push", () => {
  it("SOS: created, then updated when a parent has seen it", async () => {
    const { parent, phoneId, device } = await household("a@example.org");
    const stream = await connect(parent);
    const id = randomUUID();
    await sos(device, id);
    expect((await stream.until("sos.created")).data).toEqual({ type: "sos.created", phoneId, id });
    // A repeat of the same report is not news.
    await sos(device, id);
    expect((await parent.post(`/api/phones/${phoneId}/sos/${id}/seen`)).status).toBe(200);
    const events = await stream.drain();
    expect(events.map((e) => e.event)).toEqual(["sos.updated"]);
  });

  it("requests: created on the phone, answered by a parent", async () => {
    const { parent, phoneId, device } = await household("a@example.org");
    const stream = await connect(parent);
    const r = await device.post("/api/device/requests", { kind: "contact", name: "Gran", number: "+45 12 34 56 78" });
    expect(r.status).toBe(201);
    expect((await stream.until("request.created")).data).toEqual({ type: "request.created", phoneId, id: r.json.id, kind: "contact" });
    expect((await parent.post(`/api/phones/${phoneId}/requests/${r.json.id}/reject`)).status).toBeLessThan(300);
    expect((await stream.until("request.answered")).data).toMatchObject({ id: r.json.id });
  });

  it("location: a stored position, not a refused one", async () => {
    const { parent, phoneId, device } = await household("a@example.org");
    const stream = await connect(parent);
    const fix = { lat: 55.6, lon: 12.5, accuracyM: 20, recordedAt: h.clock.now.toISOString(), purpose: "always" };
    expect((await device.put("/api/device/location", fix)).status).toBe(409);
    await parent.put(`/api/phones/${phoneId}/location/mode`, { mode: "always", alwaysFor: "hour" });
    expect((await device.put("/api/device/location", fix)).status).toBe(204);
    const events = await stream.drain();
    expect(events.filter((e) => e.event === "location.updated")).toHaveLength(1);
    expect(events.find((e) => e.event === "location.updated")!.data).toEqual({ type: "location.updated", phoneId });
  });

  it("inbox: the child's message and a parent's reply", async () => {
    const { parent, phoneId, device } = await household("a@example.org");
    await parent.put(`/api/phones/${phoneId}/sos`, { familyInbox: true, quickMessagesEnabled: true });
    const stream = await connect(parent);
    const id = randomUUID();
    await device.post("/api/device/quick-messages/send", { id, text: "Pick me up", inbox: true });
    expect((await stream.until("inbox.message")).data).toEqual({ type: "inbox.message", phoneId, id });
    const reply = await parent.post(`/api/phones/${phoneId}/inbox`, { text: "On my way" });
    expect(reply.status).toBe(201);
    const events = await stream.drain();
    expect(events.map((e) => e.data.id)).toContain(reply.json.id);
  });

  it("phone status: a visible change, not a repeat of the same report", async () => {
    const { parent, phoneId, device } = await household("a@example.org");
    const rules = await device.get("/api/device/rules");
    const stream = await connect(parent);
    const status = {
      appVersion: "0.1.12", batteryPct: 80, charging: false, deviceOwner: true, lockIntact: true, maintenance: false,
      failedPolicies: [], rulesEtag: rules.headers.get("etag"), rulesAppliedAt: h.clock.now.toISOString(), rulesReceiptConfirmed: true, dnsHost: null,
    };
    await device.put("/api/device/status", status);
    expect((await stream.until("phone.status")).data).toEqual({ type: "phone.status", phoneId });
    await device.put("/api/device/status", { ...status, batteryPct: 85, timeUsed: { "*": 5 } });
    expect(await stream.drain()).toEqual([]);
    await device.put("/api/device/status", { ...status, lockIntact: false });
    expect((await stream.drain()).map((e) => e.event)).toContain("phone.status");
  });

  it("phone status: the first sync after pairing", async () => {
    const parent = await signIn(h, "a@example.org");
    const stream = await connect(parent);
    const { device } = await pairPhone(h, parent);
    await device.get("/api/device/rules");
    expect((await stream.drain()).map((e) => e.event)).toContain("phone.status");
  });

  it("phone status: gone quiet, and back again", async () => {
    const { parent, phoneId, device } = await household("a@example.org");
    await device.get("/api/device/rules");
    h.clock.advance(13 * 3_600_000);
    const stream = await connect(parent);
    expect(await alertOfflinePhones(h.ctx)).toBe(1);
    expect((await stream.until("phone.status")).data).toEqual({ type: "phone.status", phoneId });
    await device.get("/api/device/rules");
    expect((await stream.until("phone.status")).data).toEqual({ type: "phone.status", phoneId });
  });
});

describe("status fingerprint", () => {
  const base = { appVersion: "1", batteryPct: 55, charging: false, deviceOwner: true, lockIntact: true, maintenance: false,
    failedPolicies: [], rulesEtag: "a", rulesAppliedAt: null, dnsHost: null };
  it("ignores small battery steps and check times, sees the lock and the rules", () => {
    expect(statusVisiblyChanged(base, { ...base, batteryPct: 51 })).toBe(false);
    expect(statusVisiblyChanged(base, { ...base, batteryPct: 49 })).toBe(true);
    expect(statusVisiblyChanged(base, { ...base, rulesEtag: "b" })).toBe(true);
    expect(statusVisiblyChanged(base, { ...base, lockIntact: false })).toBe(true);
    expect(statusVisiblyChanged(null, base)).toBe(true);
  });
});

describe("event bus", () => {
  it("accepts only well-formed events from outside the process", () => {
    const ok = { type: "sos.created", householdId: randomUUID(), phoneId: randomUUID(), id: randomUUID() };
    expect(parseLiveEvent(ok)).toEqual(ok);
    expect(parseLiveEvent({ ...ok, name: "Sam" })).toEqual(ok);
    expect(parseLiveEvent({ ...ok, type: "nope" })).toBeNull();
    expect(parseLiveEvent({ ...ok, householdId: "x" })).toBeNull();
    expect(parseLiveEvent({ ...ok, id: "<script>" })).toBeNull();
    expect(parseLiveEvent("text")).toBeNull();
  });

  it("carries events between server processes through Postgres LISTEN/NOTIFY", async () => {
    const db = await createTestDatabase();
    const one = createDb(db.url);
    const two = createDb(db.url);
    const busOne = new PostgresEventBus(one.sql, "plainphone_live_test");
    const busTwo = new PostgresEventBus(two.sql, "plainphone_live_test");
    try {
      await busOne.start();
      await busTwo.start();
      const got: LiveEvent[] = [];
      const own: LiveEvent[] = [];
      busTwo.subscribe((e) => got.push(e));
      busOne.subscribe((e) => own.push(e));
      const e: LiveEvent = { type: "phone.status", householdId: randomUUID(), phoneId: randomUUID() };
      busOne.publish(e);
      await expect.poll(() => got, { timeout: 5000 }).toEqual([e]);
      // The publishing process hears it back too: one path for all clients.
      await expect.poll(() => own, { timeout: 5000 }).toEqual([e]);
    } finally {
      await busOne.close();
      await busTwo.close();
      await one.sql.end();
      await two.sql.end();
      await db.drop();
    }
  });
});
