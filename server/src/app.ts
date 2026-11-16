// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "@hono/node-server/serve-static";
import { ValidationError } from "./lib/http.js";
import { deviceRoutes } from "./routes/device.js";
import { parentRoutes } from "./routes/parent.js";
import type { Ctx } from "./services/context.js";

export function createApp(ctx: Ctx) {
  const app = new Hono();

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
      referrerPolicy: "no-referrer",
      permissionsPolicy: { camera: ["self"], geolocation: [], microphone: [] },
    }),
  );

  app.onError((err, c) => {
    if (err instanceof ValidationError) {
      return c.json(
        { error: "invalid input", issues: err.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        400,
      );
    }
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  // The login page also calls /api/health, so the DNS check is cached briefly: a slow or
  // down DNS service then costs one 3-second wait per 30 seconds, not one per request.
  let dnsCheck: { at: number; ok: Promise<boolean> } | undefined;
  const dnsHealthy = () => {
    const now = Date.now();
    if (!dnsCheck || now - dnsCheck.at > 30_000) dnsCheck = { at: now, ok: ctx.dns.healthy().catch(() => false) };
    return dnsCheck.ok;
  };

  app.get("/api/health", async (c) => {
    try {
      await ctx.db.execute(sql`select 1`);
      // "mock" means no DNS service is configured; otherwise "ok" or "down" from its /healthz.
      const dns = ctx.cfg.DNS_PROVIDER === "mock" ? "mock" : (await dnsHealthy()) ? "ok" : "down";
      return c.json({ ok: true, db: "ok", mail: ctx.mail.name, dns });
    } catch {
      return c.json({ ok: false, db: "down" }, 503);
    }
  });

  app.route("/api/device", deviceRoutes(ctx));
  app.route("/api", parentRoutes(ctx));
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  // The parent PWA. Unknown paths get index.html so client-side routes work.
  const dist = ctx.cfg.WEB_DIST;
  if (dist && existsSync(join(dist, "index.html"))) {
    const root = normalize(dist);
    app.use("/assets/*", async (c, next) => {
      await next();
      if (c.res.status === 200) c.header("Cache-Control", "public, max-age=31536000, immutable");
    });
    app.use("/*", serveStatic({ root }));
    app.get("*", async (c) => {
      // Read per request (it is small), so a rebuilt web/dist is picked up without a restart.
      const indexHtml = await readFile(join(root, "index.html"), "utf8");
      c.header("Cache-Control", "no-cache");
      return c.html(indexHtml);
    });
  }

  return app;
}
