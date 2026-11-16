// SPDX-License-Identifier: Apache-2.0
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, inject } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb, runMigrations } from "../src/db/client.js";
import { MockDnsProvider } from "../src/providers/dns.js";
import { MemoryMailProvider } from "../src/providers/mail.js";
import { RecordingPushProvider } from "../src/providers/push.js";
import type { Ctx } from "../src/services/context.js";

export const PUBLIC_URL = "https://app.example.test";

export interface Harness {
  ctx: Ctx;
  app: ReturnType<typeof createApp>;
  mail: MemoryMailProvider;
  dns: MockDnsProvider;
  push: RecordingPushProvider;
  clock: { now: Date; advance(ms: number): void };
}

/** A fresh app over a clean database for every test. */
export function useHarness(): Harness {
  const h = {} as Harness;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const { db, sql: client } = createDb(inject("databaseUrl"));
    await runMigrations(db);
    close = () => client.end();
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
  opts: { name?: string; profile?: "child" | "self" } = {},
) {
  const device = new Client(h);
  const start = await device.post("/api/device/pairings", { mode: "strong", deviceInfo: { model: "Test" } });
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
