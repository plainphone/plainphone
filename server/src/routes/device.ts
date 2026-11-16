// SPDX-License-Identifier: Apache-2.0
//
// The API the phone talks to. Contract: server/openapi.yaml, tag "device".

import { and, eq, isNull, lt, lte, notInArray, or } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { locations, pairings, phoneApps, phones } from "../db/schema.js";
import { pairingCode, randomToken, safeEqualHex, sha256 } from "../lib/crypto.js";
import { body, clientIp, RateLimiter } from "../lib/http.js";
import { packageName } from "../lib/validation.js";
import { applyDueChanges } from "../services/changes.js";
import type { Ctx } from "../services/context.js";
import { rulesDocument, STARTER_PACKS } from "../services/phones.js";

export const PAIRING_MINUTES = 15;
export const DEVICE_PREFIX = "pp_d_";

type Phone = typeof phones.$inferSelect;
type Env = { Variables: { phone: Phone } };

const deviceInfo = z.record(z.string().max(40), z.string().max(200)).refine((r) => Object.keys(r).length <= 20);

function starterPack(timezone: string): Set<string> {
  // Good enough until the parent picks a country: Danish time zone means Danish pack.
  return new Set(timezone === "Europe/Copenhagen" ? STARTER_PACKS.dk : []);
}

export function deviceRoutes(ctx: Ctx) {
  const app = new Hono<Env>();
  const pairStartLimit = new RateLimiter(10, 60 * 60_000);
  const pairPollLimit = new RateLimiter(120, 60 * 60_000);

  // --- Pairing (no device token yet) -------------------------------------------

  app.post("/pairings", async (c) => {
    if (!pairStartLimit.take(clientIp(c, ctx.cfg.TRUST_PROXY))) throw new HTTPException(429, { message: "too many pairings" });
    const input = await body(
      c,
      z.object({ mode: z.enum(["strong", "light"]).default("strong"), deviceInfo: deviceInfo.optional() }),
    );
    const code = pairingCode();
    const pollSecret = randomToken();
    const expiresAt = new Date(ctx.now().getTime() + PAIRING_MINUTES * 60_000);
    const [p] = await ctx.db
      .insert(pairings)
      .values({
        codeHash: sha256(code),
        pollSecretHash: sha256(pollSecret),
        mode: input.mode,
        deviceInfo: input.deviceInfo ?? null,
        expiresAt,
      })
      .returning();
    return c.json(
      {
        pairingId: p!.id,
        code,
        pollSecret,
        expiresAt: expiresAt.toISOString(),
        // What the phone renders as a QR code: the parent's camera opens the PWA with the code filled in.
        qrUrl: `${ctx.cfg.PUBLIC_URL}/pair?code=${encodeURIComponent(code)}`,
      },
      201,
    );
  });

  app.get("/pairings/:id", async (c) => {
    const id = c.req.param("id");
    const secret = c.req.header("x-poll-secret") ?? "";
    if (!pairPollLimit.take(`${clientIp(c, ctx.cfg.TRUST_PROXY)}:${id}`)) throw new HTTPException(429, { message: "slow down" });
    if (!z.uuid().safeParse(id).success) throw new HTTPException(404, { message: "not found" });
    const result = await ctx.db.transaction(async (tx) => {
      const [p] = await tx.select().from(pairings).where(eq(pairings.id, id)).for("update");
      if (!p || !safeEqualHex(p.pollSecretHash, sha256(secret))) return { status: 404 as const };
      if (!p.claimedAt) {
        if (p.expiresAt <= ctx.now()) return { status: 410 as const };
        return { status: 202 as const };
      }
      if (!p.pendingDeviceToken) return { status: 410 as const }; // already delivered once
      await tx
        .update(pairings)
        .set({ pendingDeviceToken: null, deliveredAt: ctx.now() })
        .where(eq(pairings.id, p.id));
      return { status: 200 as const, phoneId: p.phoneId!, deviceToken: p.pendingDeviceToken };
    });
    if (result.status === 404) throw new HTTPException(404, { message: "not found" });
    if (result.status === 410) return c.json({ error: "expired" }, 410);
    if (result.status === 202) return c.json({ status: "waiting" }, 202);
    return c.json({ status: "paired", phoneId: result.phoneId, deviceToken: result.deviceToken }, 200);
  });

  // --- Everything below needs the device token ------------------------------

  app.use("/*", async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token.startsWith(DEVICE_PREFIX)) throw new HTTPException(401, { message: "device token required" });
    const [phone] = await ctx.db.select().from(phones).where(eq(phones.deviceTokenHash, sha256(token)));
    if (!phone) throw new HTTPException(401, { message: "unknown device; pair again" });
    c.set("phone", phone);
    await next();
  });

  app.get("/rules", async (c) => {
    let phone = c.get("phone");
    if (await applyDueChanges(ctx, phone.id)) {
      const [fresh] = await ctx.db.select().from(phones).where(eq(phones.id, phone.id));
      // A delayed removal just took effect: the phone is gone.
      if (!fresh) throw new HTTPException(401, { message: "unknown device; pair again" });
      phone = fresh;
    }
    // Throttle last-seen writes to one a minute.
    await ctx.db
      .update(phones)
      .set({ lastSeenAt: ctx.now() })
      .where(
        and(
          eq(phones.id, phone.id),
          or(isNull(phones.lastSeenAt), lt(phones.lastSeenAt, new Date(ctx.now().getTime() - 60_000))),
        ),
      );
    const { doc, etag } = await rulesDocument(ctx, phone);
    c.header("ETag", etag);
    c.header("Cache-Control", "no-cache");
    const inm = c.req.header("if-none-match");
    if (inm && inm.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) {
      return c.body(null, 304);
    }
    return c.json(doc);
  });

  app.put("/apps", async (c) => {
    const phone = c.get("phone");
    const input = await body(
      c,
      z.object({
        apps: z
          .array(
            z.object({
              packageName,
              label: z.string().trim().min(1).max(100),
              core: z.boolean().default(false),
            }),
          )
          .max(1000),
      }),
    );
    const pack = starterPack(phone.timezone);
    await ctx.db.transaction(async (tx) => {
      for (const a of input.apps) {
        await tx
          .insert(phoneApps)
          .values({
            phoneId: phone.id,
            packageName: a.packageName,
            label: a.label,
            core: a.core,
            // New apps are hidden unless the phone says they are core or they are in the starter pack.
            allowed: a.core || pack.has(a.packageName),
            installed: true,
            reportedAt: ctx.now(),
          })
          .onConflictDoUpdate({
            target: [phoneApps.phoneId, phoneApps.packageName],
            set: { label: a.label, core: a.core, installed: true, reportedAt: ctx.now() },
          });
      }
      const names = input.apps.map((a) => a.packageName);
      await tx
        .update(phoneApps)
        .set({ installed: false })
        .where(
          and(eq(phoneApps.phoneId, phone.id), names.length ? notInArray(phoneApps.packageName, names) : undefined),
        );
    });
    return c.body(null, 204);
  });

  app.put("/location", async (c) => {
    const phone = c.get("phone");
    const input = await body(
      c,
      z.object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        accuracyM: z.number().min(0).max(100_000).optional(),
        recordedAt: z.iso.datetime({ offset: true }),
      }),
    );
    if (!phone.locationEnabled) return c.json({ error: "location is off for this phone" }, 409);
    const recordedAt = new Date(input.recordedAt);
    if (recordedAt.getTime() > ctx.now().getTime() + 5 * 60_000) {
      return c.json({ error: "recordedAt is in the future" }, 400);
    }
    const values = { lat: input.lat, lon: input.lon, accuracyM: input.accuracyM ?? null, recordedAt, receivedAt: ctx.now() };
    // One row per phone (D7). An older fix never overwrites a newer one.
    await ctx.db
      .insert(locations)
      .values({ phoneId: phone.id, ...values })
      .onConflictDoUpdate({
        target: locations.phoneId,
        set: values,
        setWhere: lte(locations.recordedAt, recordedAt),
      });
    if (phone.locateRequestedAt) {
      await ctx.db
        .update(phones)
        .set({ locateRequestedAt: null })
        .where(and(eq(phones.id, phone.id), lte(phones.locateRequestedAt, recordedAt)));
    }
    return c.body(null, 204);
  });

  app.put("/push-token", async (c) => {
    const input = await body(c, z.object({ fcmToken: z.string().min(1).max(4096).nullable() }));
    await ctx.db.update(phones).set({ fcmToken: input.fcmToken }).where(eq(phones.id, c.get("phone").id));
    return c.body(null, 204);
  });

  return app;
}
