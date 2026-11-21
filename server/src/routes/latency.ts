// SPDX-License-Identifier: Apache-2.0
//
// Public, sign-in free: how fast alerts and wake-ups travel (docs/latency.md). The stats hold no
// personal data, and a receipt is a random id with nothing behind it but a duration.

import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { body, clientIp, RateLimiter } from "../lib/http.js";
import type { Ctx } from "../services/context.js";
import { metricsText } from "../services/latency-metrics.js";
import { LATENCY_WINDOW_DAYS, latencyOn, latencyStats, MIN_SAMPLES, recordReceipt } from "../services/latency.js";

const receipt = z.strictObject({
  receipt: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  event: z.enum(["delivered", "opened"]).default("delivered"),
});

/** How long the stats are reused: they cover a week, a minute changes nothing. */
const CACHE_MS = 60_000;

export function latencyRoutes(ctx: Ctx) {
  const app = new Hono();
  const receiptLimit = new RateLimiter(120, 60_000);
  let cached: { at: number; body: Promise<unknown> } | undefined;

  app.get("/latency", async (c) => {
    const now = Date.now();
    if (!cached || now - cached.at > CACHE_MS) {
      const body = latencyStats(ctx).then((paths) => ({
        enabled: latencyOn(ctx), windowDays: LATENCY_WINDOW_DAYS, minSamples: MIN_SAMPLES, paths,
      }));
      cached = { at: now, body };
      body.catch(() => { cached = undefined; });
    }
    c.header("Cache-Control", "public, max-age=60");
    return c.json(await cached.body);
  });

  // Operator only (docs/latency.md): answers 404, as if it did not exist, until METRICS_TOKEN is set.
  const metricsLimit = new RateLimiter(10, 60_000);
  app.get("/metrics", async (c) => {
    const expected = ctx.cfg.METRICS_TOKEN;
    if (!expected) return c.json({ error: "not found" }, 404);
    const given = Buffer.from(/^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "")?.[1] ?? "");
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      // Only wrong guesses count, so the scraper itself never runs into the limit.
      if (!metricsLimit.take(clientIp(c, ctx.cfg.TRUST_PROXY))) return c.body(null, 429);
      c.header("WWW-Authenticate", "Bearer");
      return c.json({ error: "unauthorized" }, 401);
    }
    // Not cached: only the token holder gets here, and a scrape is two small aggregate queries.
    return c.body(await metricsText(ctx), 200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" });
  });

  // Unknown ids answer the same as known ones, so the endpoint reveals nothing.
  app.post("/push-receipt", async (c) => {
    if (!receiptLimit.take(clientIp(c, ctx.cfg.TRUST_PROXY))) return c.body(null, 429);
    const input = await body(c, receipt);
    await recordReceipt(ctx, input.receipt, input.event).catch(() => undefined);
    return c.body(null, 204);
  });

  return app;
}
