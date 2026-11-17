// SPDX-License-Identifier: Apache-2.0
//
// Starts the real server over HTTP for the phone sync contract test in android/
// (PhoneSyncContractTest, run by scripts/e2e-phone-sync.sh). It signs in one parent
// through the real magic-link flow and writes the URL and the parent's session token
// to the file given as the first argument. Uses DATABASE_URL if set, otherwise an
// embedded PostgreSQL 18 in a temporary directory. Stops on SIGTERM/SIGINT.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createDb, runMigrations } from "../../src/db/client.js";
import { MockDnsProvider } from "../../src/providers/dns.js";
import { MemoryMailProvider } from "../../src/providers/mail.js";
import { MemoryParentPushProvider } from "../../src/providers/parent-push.js";
import { RecordingPushProvider } from "../../src/providers/push.js";
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
const ctx: Ctx = {
  db,
  cfg: loadConfig({ DATABASE_URL: databaseUrl, PUBLIC_URL: publicUrl, NODE_ENV: "test" }),
  mail,
  dns: new MockDnsProvider(),
  push: new RecordingPushProvider(),
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

const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, async () => {
  await writeFile(out, JSON.stringify({ url: publicUrl, parentToken: sessionToken }), { mode: 0o600 });
  console.log(`phone sync e2e server on ${publicUrl}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(async () => {
      await sql.end();
      await stopPg();
      process.exit(0);
    });
  });
}
