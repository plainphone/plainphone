// SPDX-License-Identifier: Apache-2.0
//
// Starts the real server over HTTP for the phone sync contract test in android/
// (PhoneSyncContractTest, run by scripts/e2e-phone-sync.sh). It signs in one parent
// through the real magic-link flow and writes the URL and the parent's session token
// to the file given as the first argument. Uses DATABASE_URL if set, otherwise an
// embedded PostgreSQL 18 in a temporary directory. Stops on SIGTERM/SIGINT.

import { once } from "node:events";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createDb, runMigrations } from "../../src/db/client.js";
import { phones } from "../../src/db/schema.js";
import { HttpDnsProvider } from "../../src/providers/dns.js";
import { MemoryMailProvider } from "../../src/providers/mail.js";
import { MemoryParentPushProvider } from "../../src/providers/parent-push.js";
import { NoPushProvider } from "../../src/providers/push.js";
import type { Ctx } from "../../src/services/context.js";

const out = process.argv[2];
if (!out) throw new Error("usage: phone-sync-server.ts <fixture.json>");
const port = Number(process.env.PORT ?? 18_080);

let databaseUrl = process.env.DATABASE_URL;
let stopPg = async () => {};
if (!databaseUrl) {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const dir = await mkdtemp(join(tmpdir(), "plainphone-e2e-pg-"));
  const pgPort = 20_000 + Math.floor(Math.random() * 20_000);
  const pg = new EmbeddedPostgres({ databaseDir: dir, port: pgPort, user: "plainphone", password: "plainphone", persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("plainphone_e2e");
  databaseUrl = `postgres://plainphone:plainphone@127.0.0.1:${pgPort}/plainphone_e2e`;
  stopPg = async () => {
    await pg.stop();
    await rm(dir, { recursive: true, force: true });
  };
}

const { db, sql } = createDb(databaseUrl);
await runMigrations(db);
const mail = new MemoryMailProvider();
const publicUrl = `http://127.0.0.1:${port}`;
const emulator = process.env.PLAINPHONE_EMULATOR_E2E === "1";
// Confirm HTTP provisioning without requiring a DNS resolver in CI.
const dnsToken = "e2e-dns-token";
const dnsClients = new Set<string>();
// A Device Owner emulator forces private DNS to the rules' host once the DNS service has
// accepted its ClientID. No DNS-over-TLS server knows these ClientIDs in CI: the production
// resolver refused them, Android marked the network unvalidated and WorkManager stopped every
// sync (run 45006624811). So the stub refuses strong-mode phones, which keeps them on the
// QR code's provisioning host, as a real phone stays until its ClientID is accepted.
async function refusesDnsClient(clientId: string) {
  if (!emulator) return false;
  const [phone] = await db.select({ mode: phones.mode }).from(phones).where(eq(phones.dnsClientId, clientId));
  return phone?.mode === "strong";
}
const dnsServer = serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    if (request.headers.get("authorization") !== `Bearer ${dnsToken}`) {
      return new Response(null, { status: 401 });
    }
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/v1/clients") {
      const { client_id } = await request.json() as { client_id?: string };
      if (!client_id) return new Response(null, { status: 400 });
      if (await refusesDnsClient(client_id)) return new Response(null, { status: 503 });
      dnsClients.add(client_id);
      return new Response(null, { status: 201 });
    }
    const clientId = path.match(/^\/v1\/clients\/([^/]+)$/)?.[1];
    if (!clientId || !dnsClients.has(clientId)) return new Response(null, { status: 404 });
    if (request.method === "PATCH") return new Response(null, { status: 204 });
    if (request.method === "DELETE") {
      dnsClients.delete(clientId);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  },
});
await once(dnsServer, "listening");
const dnsAddress = dnsServer.address();
if (!dnsAddress || typeof dnsAddress === "string") throw new Error("DNS stub has no TCP address");
const dnsUrl = `http://127.0.0.1:${dnsAddress.port}`;
const ctx: Ctx = {
  db,
  cfg: loadConfig({
    DATABASE_URL: databaseUrl,
    PUBLIC_URL: publicUrl,
    NODE_ENV: "test",
    PUSH_PROVIDER: "none",
    DNS_PROVIDER: "http",
    DNS_API_URL: dnsUrl,
    DNS_API_TOKEN: dnsToken,
    // A reserved name (RFC 6761): no emulator may reach the production resolver.
    ...(emulator ? { DNS_HOST_SUFFIX: "dns.e2e.invalid" } : {}),
  }),
  mail,
  dns: new HttpDnsProvider(dnsUrl, dnsToken),
  push: new NoPushProvider(),
  parentPush: new MemoryParentPushProvider(),
  now: () => new Date(),
};
const app = createApp(ctx);

// Sign in a parent through the real flow, as a native client (Bearer session token).
const email = `parent-${Date.now()}@example.test`;
const req = await app.request("/api/auth/request", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, locale: "en" }),
});
if (req.status !== 202) throw new Error(`login request failed: ${req.status}`);
const token = decodeURIComponent(/#token=([^\s"&<]+)/.exec(mail.outbox.at(-1)!.text)![1]!);
const verify = await app.request("/api/auth/verify", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token, locale: "en", client: "native" }),
});
if (verify.status !== 200) throw new Error(`verify failed: ${verify.status}`);
const { sessionToken } = (await verify.json()) as { sessionToken: string };

// Opt-in gateway fault for the emulator. The real quick-message endpoint can
// return a successful, quiet rate-limit response, which must not fall back.
const injectQuickMessage429 = emulator;
let quickMessageRequests = 0;

// Emulator console commands (`adb emu ...`) the device asks the host harness to run, so an SMS
// or a call from another number reaches the phone through the emulated modem, as it would from
// a real network. The harness polls /e2e/console/next and posts the console's output back.
// Only an SMS or an incoming call from a number is accepted, never another console command.
type ConsoleCommand = { id: number; args: string[]; finish: (output: string | null) => void };
const consoleQueue: ConsoleCommand[] = [];
const consoleRunning = new Map<number, ConsoleCommand>();
let consoleIds = 0;
const consoleNumber = /^\+?[0-9]{3,15}$/;
function consoleArgs(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((a) => typeof a === "string")) return null;
  const [group, action, number, ...rest] = value as string[];
  if (!number || !consoleNumber.test(number)) return null;
  if (group === "sms" && action === "send" && rest.length === 1 && /^[A-Za-z0-9 .,!?-]{1,140}$/.test(rest[0]!)) return value;
  if (group === "gsm" && action === "call" && rest.length === 0) return value;
  return null;
}
function runOnConsole(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const command: ConsoleCommand = { id: ++consoleIds, args, finish: resolve };
    consoleQueue.push(command);
    // Shorter than the device's 10-second read timeout, so the test sees a clear 504.
    setTimeout(() => {
      const queued = consoleQueue.indexOf(command);
      if (queued >= 0) consoleQueue.splice(queued, 1);
      consoleRunning.delete(command.id);
      resolve(null);
    }, 8_000);
  });
}

const server = serve({
  hostname: "127.0.0.1",
  port,
  fetch: async (request) => {
    if (emulator) {
      const path = new URL(request.url).pathname;
      if (injectQuickMessage429 && request.method === "POST" && path === "/api/device/quick-messages/send") {
        quickMessageRequests++;
        return new Response(null, { status: 429 });
      }
      if (request.headers.get("authorization") === `Bearer ${sessionToken}`) {
        if (path === "/e2e/quick-message-requests" && request.method === "GET") {
          return Response.json({ count: quickMessageRequests });
        }
        if (path === "/e2e/console" && request.method === "POST") {
          const input = (await request.json().catch(() => null)) as { args?: unknown } | null;
          const args = consoleArgs(input?.args);
          if (!args) return new Response(null, { status: 400 });
          const output = await runOnConsole(args);
          return output === null ? new Response(null, { status: 504 }) : Response.json({ output });
        }
        if (path === "/e2e/console/next" && request.method === "GET") {
          const command = consoleQueue.shift();
          if (!command) return new Response(null, { status: 204 });
          consoleRunning.set(command.id, command);
          return Response.json({ id: command.id, args: command.args });
        }
        const finished = /^\/e2e\/console\/([0-9]+)$/.exec(path);
        if (finished && request.method === "POST") {
          const command = consoleRunning.get(Number(finished[1]));
          if (!command) return new Response(null, { status: 404 });
          consoleRunning.delete(command.id);
          const { output } = (await request.json()) as { output?: unknown };
          command.finish(String(output));
          return new Response(null, { status: 204 });
        }
      }
    }
    return app.fetch(request);
  },
});
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("test server has no TCP address");
const pendingFixture = `${out}.tmp`;
await writeFile(pendingFixture, JSON.stringify({ url: `http://127.0.0.1:${address.port}`, parentToken: sessionToken }), { mode: 0o600 });
await rename(pendingFixture, out);
console.log(`phone sync e2e server on port ${address.port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(async () => {
      dnsServer.close();
      await sql.end();
      await stopPg();
      process.exit(0);
    });
  });
}
