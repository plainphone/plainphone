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
import { publicCatalogRoutes } from "./routes/catalog.js";
import { deviceRoutes } from "./routes/device.js";
import { downloadRoutes } from "./routes/download.js";
import { parentRoutes } from "./routes/parent.js";
import type { Config } from "./config.js";
import type { Ctx } from "./services/context.js";
import { UpdateWake } from "./services/update-wake.js";

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

  // Universal links (iOS) and app links (Android): login, pairing and invite links open
  // the native parent app when it is installed. /auth/callback stays with the PWA.
  app.get("/.well-known/apple-app-site-association", (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.json(appleAppSiteAssociation(ctx.cfg));
  });
  app.get("/.well-known/assetlinks.json", (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.json(assetLinks(ctx.cfg));
  });

  const updateWake = new UpdateWake();
  app.route("/api/device", deviceRoutes(ctx, updateWake));
  // Public, so it is mounted before the parent API and its session check.
  app.route("/api/catalog", publicCatalogRoutes());
  app.route("/api", parentRoutes(ctx, updateWake));
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));
  // Stable APK address for provisioning QR codes (redirects to the newest release).
  app.route("/download", downloadRoutes(ctx));

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

/** Paths the native parent app opens. Keep in sync with parent-app/app.config.ts. */
export const APP_LINK_PATHS = ["/auth/app", "/pair", "/invite"];

function list(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function appleAppSiteAssociation(cfg: Pick<Config, "APPLE_APP_IDS">) {
  const appIDs = list(cfg.APPLE_APP_IDS);
  return {
    applinks: {
      details: appIDs.length ? [{ appIDs, components: APP_LINK_PATHS.map((p) => ({ "/": p })) }] : [],
    },
  };
}

export function assetLinks(cfg: Pick<Config, "ANDROID_APP_PACKAGE" | "ANDROID_APP_CERT_SHA256">) {
  const fingerprints = list(cfg.ANDROID_APP_CERT_SHA256).map((f) => f.toUpperCase());
  if (!cfg.ANDROID_APP_PACKAGE || !fingerprints.length) return [];
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: cfg.ANDROID_APP_PACKAGE, sha256_cert_fingerprints: fingerprints },
    },
  ];
}
