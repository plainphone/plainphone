// SPDX-License-Identifier: Apache-2.0
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb, runMigrations } from "./db/client.js";
import { HttpDnsProvider, MockDnsProvider } from "./providers/dns.js";
import { LogMailProvider, NoMailProvider, SmtpMailProvider } from "./providers/mail.js";
import { NoParentPushProvider, WebPushProvider } from "./providers/parent-push.js";
import { NoPushProvider } from "./providers/push.js";
import { validVapidKeys } from "./lib/webpush.js";
import type { Ctx } from "./services/context.js";
import { markUnconfirmedDnsDirty } from "./services/dns.js";
import { startSweeper } from "./services/sweeper.js";

const cfg = loadConfig();
const { db, sql } = createDb(cfg.DATABASE_URL);
if (cfg.MIGRATE_ON_START) await runMigrations(db);

const vapid =
  cfg.VAPID_PUBLIC_KEY && cfg.VAPID_PRIVATE_KEY
    ? { publicKey: cfg.VAPID_PUBLIC_KEY, privateKey: cfg.VAPID_PRIVATE_KEY }
    : null;
if (vapid && !validVapidKeys(vapid)) throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not a valid pair");

const ctx: Ctx = {
  db,
  cfg,
  mail:
    cfg.MAIL_PROVIDER === "smtp"
      ? new SmtpMailProvider(cfg.SMTP_URL!, cfg.MAIL_FROM)
      : cfg.MAIL_PROVIDER === "log"
        ? new LogMailProvider()
        : new NoMailProvider(),
  dns: cfg.DNS_PROVIDER === "http" ? new HttpDnsProvider(cfg.DNS_API_URL!, cfg.DNS_API_TOKEN!) : new MockDnsProvider(),
  push: new NoPushProvider(),
  parentPush: vapid ? new WebPushProvider(vapid, cfg.VAPID_SUBJECT) : new NoParentPushProvider(),
  now: () => new Date(),
};

await markUnconfirmedDnsDirty(ctx);
const app = createApp(ctx);
const stopSweeper = startSweeper(ctx);
const server = serve({ fetch: app.fetch, port: cfg.PORT }, (info) => {
  console.log(`plainphone server on :${info.port} (mail=${ctx.mail.name}, dns=${cfg.DNS_PROVIDER}, parentPush=${ctx.parentPush.name})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopSweeper();
    server.close(() => void sql.end().then(() => process.exit(0)));
  });
}
