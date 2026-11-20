// SPDX-License-Identifier: Apache-2.0
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { createTestDatabase } from "./db.js";
import { sosEvents } from "../src/db/schema.js";
import { MockDnsProvider } from "../src/providers/dns.js";
import { MemoryMailProvider } from "../src/providers/mail.js";
import { MemoryParentPushProvider } from "../src/providers/parent-push.js";
import { RecordingPushProvider } from "../src/providers/push.js";
import type { Ctx } from "../src/services/context.js";

export const PUBLIC_URL = "https://app.example.test";

export interface Harness {
  ctx: Ctx;
  app: ReturnType<typeof createApp>;
  mail: MemoryMailProvider;
  dns: MockDnsProvider;
  push: RecordingPushProvider;
  parentPush: MemoryParentPushProvider;
  clock: { now: Date; advance(ms: number): void };
}

/** A fresh app over a clean database for every test. */
export function useHarness(): Harness {
  const h = {} as Harness;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const copy = await createTestDatabase();
    const { db, sql: client } = createDb(copy.url);
    close = async () => {
      await client.end();
      await copy.drop();
    };
    h.ctx = { db } as Ctx;
  });

  beforeEach(async () => {
    const tables = await h.ctx.db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    const names = tables.map((t) => `"${t.tablename}"`).join(", ");
    if (names) await h.ctx.db.execute(sql.raw(`truncate ${names} cascade`));

    h.mail = new MemoryMailProvider();
    h.dns = new MockDnsProvider();
    h.push = new RecordingPushProvider();
    h.parentPush = new MemoryParentPushProvider();
    const clock = {
      now: new Date("2026-11-16T12:00:00Z"),
      advance(ms: number) {
        clock.now = new Date(clock.now.getTime() + ms);
      },
    };
    h.clock = clock;
    h.ctx = {
      db: h.ctx.db,
      cfg: loadConfig({ DATABASE_URL: "unused", PUBLIC_URL, NODE_ENV: "test" }),
      mail: h.mail,
      dns: h.dns,
      push: h.push,
      parentPush: h.parentPush,
      now: () => clock.now,
    };
    h.app = createApp(h.ctx);
  });

  afterAll(async () => {
    await close?.();
  });

  return h;
}

/** A small client that keeps the session token like the native apps do. */
export class Client {
  token?: string;
  constructor(private readonly h: Harness) {}

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.h.app.request(path, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  }

  get = (p: string, headers?: Record<string, string>) => this.call("GET", p, undefined, headers);
  post = (p: string, b?: unknown) => this.call("POST", p, b ?? {});
  put = (p: string, b: unknown) => this.call("PUT", p, b);
  patch = (p: string, b: unknown) => this.call("PATCH", p, b);
  del = (p: string) => this.call("DELETE", p);
}

/** Signs in through the real magic-link flow and returns a client. */
export async function signIn(h: Harness, email: string, locale: "en" | "da" = "en"): Promise<Client> {
  const c = new Client(h);
  const r = await c.post("/api/auth/request", { email, locale });
  if (r.status !== 202) throw new Error(`login request failed: ${r.status}`);
  const mail = h.mail.outbox.at(-1)!;
  const token = decodeURIComponent(/#token=([^\s"&<]+)/.exec(mail.text)![1]!);
  const v = await c.post("/api/auth/verify", { token, locale, client: "native" });
  if (v.status !== 200) throw new Error(`verify failed: ${v.status} ${JSON.stringify(v.json)}`);
  c.token = v.json.sessionToken;
  return c;
}

/** Pairs a phone: the phone starts, the parent claims the code, the phone collects its token. */
export async function pairPhone(
  h: Harness,
  parent: Client,
  opts: { name?: string; profile?: "child" | "self"; mode?: "strong" | "light" } = {},
) {
  const device = new Client(h);
  const start = await device.post("/api/device/pairings", { mode: opts.mode ?? "strong", deviceInfo: { model: "Test" } });
  const claim = await parent.post("/api/phones/claim", {
    code: start.json.code,
    name: opts.name ?? "Alma",
    profile: opts.profile ?? "child",
  });
  if (claim.status !== 201) throw new Error(`claim failed: ${claim.status} ${JSON.stringify(claim.json)}`);
  const poll = await device.get(`/api/device/pairings/${start.json.pairingId}`, {
    "x-poll-secret": start.json.pollSecret,
  });
  device.token = poll.json.deviceToken;
  return { phoneId: claim.json.id as string, device };
}

/**
 * Waits until the request's own background dispatch of an SOS has finished its pass and is
 * waiting out the retry backoff. The lease is already set when the pass starts (two minutes), so
 * "has a lease" is not enough: only the one-minute retry lease on the injected clock means the pass is over.
 * Advance the clock or sweep only after this, or the sweeper races the first pass.
 */
export async function waitForSosRetryBackoff(h: Harness, id: string): Promise<void> {
  await vi.waitFor(async () => {
    const [open] = await h.ctx.db.select().from(sosEvents).where(eq(sosEvents.id, id));
    expect(open!.notificationLeaseUntil?.getTime()).toBe(h.clock.now.getTime() + 60_000);
  });
}
