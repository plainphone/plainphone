// SPDX-License-Identifier: Apache-2.0
//
// Public, sign-in free: how fast alerts and wake-ups travel (docs/latency.md). The stats hold no
// personal data, and a receipt is a random id with nothing behind it but a duration.

import { Hono } from "hono";
import { z } from "zod";
import { body, clientIp, RateLimiter } from "../lib/http.js";
import type { Ctx } from "../services/context.js";
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

  // Unknown ids answer the same as known ones, so the endpoint reveals nothing.
  app.post("/push-receipt", async (c) => {
    if (!receiptLimit.take(clientIp(c, ctx.cfg.TRUST_PROXY))) return c.body(null, 429);
    const input = await body(c, receipt);
    await recordReceipt(ctx, input.receipt, input.event).catch(() => undefined);
    return c.body(null, 204);
  });

  return app;
}
