// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import EmbeddedPostgres from "embedded-postgres";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb, runMigrations } from "../src/db/client.js";
import { sha256 } from "../src/lib/crypto.js";
import { MockDnsProvider } from "../src/providers/dns.js";
import { NoMailProvider } from "../src/providers/mail.js";
import { NoParentPushProvider } from "../src/providers/parent-push.js";
import { NoPushProvider } from "../src/providers/push.js";

const requests = Number(process.argv[2] ?? 4000);
const concurrency = Number(process.argv[3] ?? 8);
if (![requests, concurrency].every((n) => Number.isSafeInteger(n) && n > 0)) {
  throw new Error("Usage: scripts/bench-server.sh [requests] [concurrency]");
}

const dir = await mkdtemp(join(tmpdir(), "plainphone-bench-"));
const port = 20_000 + Math.floor(Math.random() * 20_000);
const pg = new EmbeddedPostgres({
  databaseDir: join(dir, "pg"), port, user: "plainphone", password: "plainphone",
  persistent: false, onLog: () => {},
});
try {
  await pg.initialise();
  await pg.start();
  const url = `postgres://plainphone:plainphone@127.0.0.1:${port}/postgres`;
  const { db, sql: client } = createDb(url);
  try {
    await runMigrations(db);
    const token = "pp_d_benchmark";
    const [phone] = await db.execute<{ id: string }>(sql`
      with home as (insert into households (name) values ('Benchmark') returning id)
      insert into phones (household_id, name, profile, dns_client_id, device_token_hash, location_enabled)
      select id, 'Benchmark', 'child', 'bench', ${sha256(token)}, false from home returning id
    `);
    await db.execute(sql`insert into phone_apps (phone_id, package_name, label, installed, allowed)
      select ${phone!.id}, 'example.app' || i, 'Benchmark', true, i % 2 = 0 from generate_series(1, 100) i`);
    const app = createApp({
      db, cfg: loadConfig({ DATABASE_URL: url, PUBLIC_URL: "http://localhost", NODE_ENV: "test" }),
      dns: new MockDnsProvider(), mail: new NoMailProvider(), push: new NoPushProvider(),
      parentPush: new NoParentPushProvider(), now: () => new Date(),
    });
    const address = await Promise.withResolvers<number>();
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => address.resolve(info.port));
    try {
      const endpoint = `http://127.0.0.1:${await address.promise}/api/device/rules`;
      const headers = { authorization: `Bearer ${token}`, "if-none-match": "" };
      const initial = await fetch(endpoint, { headers });
      await initial.arrayBuffer();
      if (initial.status !== 200 || !initial.headers.has("etag")) throw new Error("Missing initial rules");
      headers["if-none-match"] = initial.headers.get("etag")!;
      async function poll() {
        const res = await fetch(endpoint, { headers });
        if (res.status !== 304) throw new Error(`Expected 304, got ${res.status}`);
      }

      for (let i = 0; i < 50; i++) await poll();
      const startRss = process.memoryUsage.rss();
      const start = performance.now();
      const startCpu = process.cpuUsage();
      let next = 0;
      let peakRss = startRss;
      const workers = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
        while (next++ < requests) {
          await poll();
          peakRss = Math.max(peakRss, process.memoryUsage.rss());
        }
      }));
      for (const worker of workers) if (worker.status === "rejected") throw worker.reason;
      const seconds = (performance.now() - start) / 1000;
      const cpu = process.cpuUsage(startCpu);
      const cpuMs = ((cpu.user + cpu.system) / 1000 / requests).toFixed(3);
      const mib = (n: number) => (n / 1024 ** 2).toFixed(1);
      console.log(`${requests} HTTP 304 responses, ${concurrency} clients, ${Math.round(requests / seconds)} req/s, ${cpuMs} Node CPU ms/req, RSS ${mib(startRss)} → ${mib(peakRss)} MiB (warm → peak)`);
    } finally {
      server.close();
      if ("closeAllConnections" in server) server.closeAllConnections();
    }
  } finally {
    await client.end();
  }
} finally {
  await pg.stop();
  await rm(dir, { recursive: true, force: true });
}
