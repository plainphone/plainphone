// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { etag } from "hono/etag";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { parentPushEnabled } from "./providers/parent-push.js";
import { serveStatic } from "@hono/node-server/serve-static";
import { ValidationError } from "./lib/http.js";
import { errorFrames, errorSummary } from "./lib/log.js";
import { attestationRoutes } from "./routes/attestation.js";
import { publicCatalogRoutes } from "./routes/catalog.js";
import { deviceRoutes } from "./routes/device.js";
import { downloadRoutes } from "./routes/download.js";
import { liveEventRoutes } from "./routes/events.js";
import { parentRoutes } from "./routes/parent.js";
import { resetProtectionRoutes } from "./routes/reset-protection.js";
import type { Config } from "./config.js";
import type { Ctx } from "./services/context.js";
import { UpdateWake } from "./services/update-wake.js";
import { latencyRoutes } from "./routes/latency.js";
import { LocalEventBus } from "./services/live-events.js";
import { LiveHub, type LiveHubOptions } from "./services/live-hub.js";

/** The largest request body the API reads, unless a route sets its own limit. */
export const DEFAULT_BODY_LIMIT = 1024 * 1024;

/** Routes that accept more than DEFAULT_BODY_LIMIT and set their own bodyLimit. */
const LARGE_BODY_ROUTES = [
  /^\/api\/device\/contact-suggestions$/,
  /^\/api\/phones\/[^/]+\/contact-suggestions$/,
  /^\/api\/households\/[^/]+\/server-move\/import$/,
];

/** Where the PWA's map loads its tiles (web/src/lib/maps.ts). */
export const MAP_TILE_ORIGIN = "https://tiles.openfreemap.org";

function encodingQualities(header: string | undefined): Map<string, number> {
  const quality = new Map<string, number>();
  for (const entry of header?.split(",") ?? []) {
    const [coding, ...params] = entry.toLowerCase().split(";");
    const weight = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
    const q = weight === undefined ? 1 : Number(weight.slice(2));
    quality.set(coding!.trim(), q >= 0 && q <= 1 ? q : 0);
  }
  return quality;
}

function acceptedAssetEncodings(quality: Map<string, number>, path: string): string {
  const wildcard = quality.get("*") ?? 0;
  const br = quality.get("br") ?? wildcard;
  const gzip = quality.get("gzip") ?? wildcard;
  const identity = quality.get("identity") ?? 0;

  // serveStatic checks Brotli first. Suppress it when the client prefers an
  // available gzip variant, using the path already validated by serveStatic.
  if (br > 0 && gzip > br && gzip >= identity && existsSync(path + ".gz")) return "gzip";
  return [br > 0 && br >= identity && "br", gzip > 0 && gzip >= identity && "gzip"].filter(Boolean).join(", ");
}

function allowsIdentity(quality: Map<string, number>): boolean {
  return (quality.get("identity") ?? quality.get("*")) !== 0;
}

function encodingNotAcceptable(): Response {
  return new Response(null, { status: 406, headers: { Vary: "Accept-Encoding", "Cache-Control": "no-cache" } });
}

export function createApp(ctx: Ctx, opts: { live?: LiveHub; liveOptions?: Partial<LiveHubOptions> } = {}) {
  const app = new Hono();
  ctx.events ??= new LocalEventBus();
  const live = opts.live ?? new LiveHub(ctx, ctx.events, opts.liveOptions);

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        // The location page's map: vector tiles, fonts and sprites from OpenFreeMap (docs/privacy.md).
        imgSrc: ["'self'", "data:", "blob:", MAP_TILE_ORIGIN],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
        connectSrc: ["'self'", MAP_TILE_ORIGIN],
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
    console.error(`${errorSummary(err)}\n${errorFrames(err)}`);
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
      return c.json({ ok: true, compatibility: 1, db: "ok", mail: ctx.mail.name, dns, push: {
        web: parentPushEnabled(ctx.parentPush, "web"),
        fcm: parentPushEnabled(ctx.parentPush, "fcm"),
        apns: parentPushEnabled(ctx.parentPush, "apns"),
        unifiedpush: Boolean(ctx.push.unifiedPushAvailable),
        errors: ctx.degraded?.push ?? [],
      }, errors: ctx.degraded?.other ?? [] });
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

  // Without a cap, body() reads whatever arrives, also on the routes that need no sign-in.
  const defaultBodyLimit = bodyLimit({
    maxSize: DEFAULT_BODY_LIMIT,
    onError: (c) => c.json({ error: "request body too large" }, 413),
  });
  app.use("/api/*", (c, next) =>
    LARGE_BODY_ROUTES.some((route) => route.test(c.req.path)) ? next() : defaultBodyLimit(c, next),
  );

  const updateWake = new UpdateWake();
  // Public, so it is mounted before the parent API and its session check.
  app.route("/api/catalog", publicCatalogRoutes());
  app.route("/api", latencyRoutes(ctx));
  app.route("/api/device", deviceRoutes(ctx, updateWake, attestationRoutes(ctx)));
  const resetProtection = resetProtectionRoutes(ctx);
  app.route("/api/reset-protection", resetProtection.callback);
  app.route("/api", parentRoutes(ctx, updateWake, (parent) => {
    resetProtection.parent(parent);
    liveEventRoutes(parent, live);
  }));
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));
  // Stable APK address for provisioning QR codes (redirects to the newest release).
  app.route("/download", downloadRoutes(ctx));

  // The parent PWA. Unknown paths get index.html so client-side routes work.
  const dist = ctx.cfg.WEB_DIST;
  if (dist && existsSync(join(dist, "index.html"))) {
    const root = normalize(dist);
    const compressed = serveStatic({
      root,
      precompressed: true,
      rewriteRequestPath: (filename, c) => {
        const original = c.req.raw;
        const accepted = c.req.header("accept-encoding");
        const encodings = acceptedAssetEncodings(encodingQualities(accepted), join(root, filename));
        if (accepted !== undefined && encodings !== accepted) {
          const headers = new Headers(original.headers);
          headers.set("accept-encoding", encodings);
          c.req.raw = new Request(original, { headers });
        }
        return filename;
      },
    });
    const identity = serveStatic({ root });
    const validate = etag();
    for (const path of ["/", "/index.html", "/sw.js"]) {
      app.use(path, (c, next) =>
        c.req.method === "GET" && !c.req.header("range") ? validate(c, next) : next(),
      );
    }
    app.use("/*", async (c, next) => {
      const asset = c.req.path.startsWith("/assets/");
      const identityForbidden = !allowsIdentity(encodingQualities(c.req.header("accept-encoding")));
      const handler = asset && (!c.req.header("range") || identityForbidden) ? compressed : identity;
      const original = c.req.raw;
      const res = await handler(c, async () => {
        c.req.raw = original;
        await next();
      }).finally(() => {
        c.req.raw = original;
      });
      if (res) {
        if (identityForbidden && !res.headers.has("Content-Encoding")) {
          await res.body?.cancel();
          return encodingNotAcceptable();
        }
        res.headers.set("Vary", "Accept-Encoding");
        const hashed = /^\/assets\/[^/]+-[\w-]{8,}\.[\w]+$/.test(c.req.path);
        res.headers.set("Cache-Control", hashed ? "public, max-age=31536000, immutable" : "no-cache");
      }
      return res;
    });
    app.get("*", async (c) => {
      if (!allowsIdentity(encodingQualities(c.req.header("accept-encoding")))) return encodingNotAcceptable();
      // Read per request (it is small), so a rebuilt web/dist is picked up without a restart.
      const indexHtml = await readFile(join(root, "index.html"), "utf8");
      c.header("Cache-Control", "no-cache");
      c.header("Vary", "Accept-Encoding");
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
