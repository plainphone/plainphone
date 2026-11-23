// SPDX-License-Identifier: Apache-2.0
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb, runMigrations } from "./db/client.js";
import { errorSummary } from "./lib/log.js";
import { HttpDnsProvider, MockDnsProvider } from "./providers/dns.js";
import { buildOptionalProviders } from "./services/providers.js";
import type { Ctx } from "./services/context.js";
import { markUnconfirmedDnsDirty } from "./services/dns.js";
import { PostgresEventBus } from "./services/live-events.js";
import { LiveHub } from "./services/live-hub.js";
import { startSweeper } from "./services/sweeper.js";

const cfg = loadConfig();
const { db, sql } = createDb(cfg.DATABASE_URL, cfg.DB_POOL_MAX);
if (cfg.MIGRATE_ON_START) await runMigrations(db);

// Live updates go through Postgres LISTEN/NOTIFY, so every server process on the same database
// (also the old and new container during a deploy) streams them (docs/live-updates.md).
const events = new PostgresEventBus(sql);
await events.start().catch((err) => console.error(`live updates stay in this process: ${errorSummary(err)}`));

const ctx: Ctx = {
  db,
  cfg,
  ...buildOptionalProviders(cfg),
  dns: cfg.DNS_PROVIDER === "http" ? new HttpDnsProvider(cfg.DNS_API_URL!, cfg.DNS_API_TOKEN!) : new MockDnsProvider(),
  now: () => new Date(),
  events,
};

await markUnconfirmedDnsDirty(ctx);
const live = new LiveHub(ctx, events);
const app = createApp(ctx, { live });
const stopSweeper = startSweeper(ctx);
const server = serve({ fetch: app.fetch, port: cfg.PORT, hostname: cfg.HOST },(info) => {
  console.log(`plainphone server on :${info.port} (mail=${ctx.mail.name}, dns=${cfg.DNS_PROVIDER}, parentPush=${ctx.parentPush.name}, live=${events.name})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopSweeper();
    // Open event streams never end by themselves: close them so the server can stop. Clients reconnect.
    live.stop();
    server.close(() => void events.close().then(() => sql.end()).then(() => process.exit(0)));
  });
}
