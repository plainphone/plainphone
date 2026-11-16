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
        imgSrc: ["'self'", "data:", "https://tile.openstreetmap.org"],
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

  app.get("/api/health", async (c) => {
    try {
      await ctx.db.execute(sql`select 1`);
      return c.json({ ok: true, db: "ok", mail: ctx.mail.name, dns: ctx.cfg.DNS_PROVIDER });
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
