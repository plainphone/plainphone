// SPDX-License-Identifier: Apache-2.0
//
// The API the phone talks to. Contract: server/openapi.yaml, tag "device".

import { and, eq, isNull, lt, lte, notInArray, or } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { locations, pairings, phoneApps, phones, PROTECTIONS, safetyRequests } from "../db/schema.js";
import { pairingCode, randomToken, safeEqualHex, sha256 } from "../lib/crypto.js";
import { body, clientIp, RateLimiter } from "../lib/http.js";
import { packageName } from "../lib/validation.js";
import { applyDueChanges } from "../services/changes.js";
import { ENROLLMENT_PREFIX, redeemEnrollment } from "../services/enrollment.js";
import type { Ctx } from "../services/context.js";
import { phoneCountry, STARTER_PACKS } from "../services/catalog.js";
import { limitTarget } from "../services/limits.js";
import { rulesDocument } from "../services/phones.js";
import { checkinLocationDue, loadSafety } from "../services/safety.js";

export const PAIRING_MINUTES = 15;
export const DEVICE_PREFIX = "pp_d_";

type Phone = typeof phones.$inferSelect;
type Env = { Variables: { phone: Phone } };

const deviceInfo = z.record(z.string().max(40), z.string().max(200)).refine((r) => Object.keys(r).length <= 20);

function starterPack(timezone: string): Set<string> {
  // Good enough until the parent picks a country: Danish time zone means Danish pack.
  const country = phoneCountry(timezone);
  return new Set(country ? STARTER_PACKS[country] : []);
}

/** Light mode cannot be intact without these (docs/sync-api.md). */
const LIGHT_LOCK = ["deviceAdmin", "accessibility", "usageAccess", "vpn", "phoneRole", "smsRole"] as const;

const protections = z.strictObject(Object.fromEntries(PROTECTIONS.map((k) => [k, z.boolean().optional()]))) as z.ZodType<
  Partial<Record<(typeof PROTECTIONS)[number], boolean>>
>;

export function deviceRoutes(ctx: Ctx) {
  const app = new Hono<Env>();
  const pairStartLimit = new RateLimiter(10, 60 * 60_000);
  const pairPollLimit = new RateLimiter(120, 60 * 60_000);
  const enrollLimit = new RateLimiter(20, 60 * 60_000);

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

  // Pairing by the one-time token from a dashboard-made provisioning QR code (no code to type).
  app.post("/enroll", async (c) => {
    if (!enrollLimit.take(clientIp(c, ctx.cfg.TRUST_PROXY))) throw new HTTPException(429, { message: "too many attempts" });
    const input = await body(
      c,
      z.object({
        token: z.string().startsWith(ENROLLMENT_PREFIX).max(100),
        installId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
        deviceInfo: deviceInfo.optional(),
      }),
    );
    const r = await redeemEnrollment(ctx, { ...input, deviceInfo: input.deviceInfo ?? null }, DEVICE_PREFIX);
    if (r.status !== 200) return c.json({ error: r.error }, r.status);
    return c.json({ status: "paired", phoneId: r.phoneId, deviceToken: r.deviceToken }, 200);
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
    if (phone.locationMode === "off") return c.json({ error: "location is off for this phone" }, 409);
    // Outside "always" the phone sends a position only when asked: a Find, or an unanswered
    // "Are you okay?". The server holds it to that.
    const { checkin } = await loadSafety(ctx, phone.id);
    const forCheckin = checkinLocationDue(checkin, phone.locationMode, ctx.now());
    if (phone.locationMode !== "always" && !phone.locateRequestedAt && !forCheckin) {
      return c.json({ error: "no position was asked for" }, 409);
    }
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
    if (forCheckin) {
      await ctx.db
        .update(safetyRequests)
        .set({ locatedAt: ctx.now() })
        .where(and(eq(safetyRequests.id, checkin!.id), isNull(safetyRequests.locatedAt)));
    }
    return c.body(null, 204);
  });

  // The phone reports what happened to a ring or an "Are you okay?" (docs/location.md).
  app.post("/safety/:rid", async (c) => {
    const phone = c.get("phone");
    const { event } = await body(c, z.object({ event: z.enum(["shown", "here", "ok", "call"]) }));
    const rid = z.uuid().safeParse(c.req.param("rid"));
    if (!rid.success) return c.json({ error: "not found" }, 404);
    const [req] = await ctx.db
      .select()
      .from(safetyRequests)
      .where(and(eq(safetyRequests.id, rid.data), eq(safetyRequests.phoneId, phone.id)));
    if (!req) return c.json({ error: "not found" }, 404);
    if (event !== "shown" && (event === "here") !== (req.kind === "ring")) {
      return c.json({ error: `${event} does not answer a ${req.kind}` }, 400);
    }
    const now = ctx.now();
    if (event === "shown") {
      await ctx.db
        .update(safetyRequests)
        .set({ shownAt: now })
        .where(and(eq(safetyRequests.id, req.id), isNull(safetyRequests.shownAt)));
    } else {
      // The first answer counts. A late answer is still recorded: the parent wants to know.
      await ctx.db
        .update(safetyRequests)
        .set({ answeredAt: now, answer: event, shownAt: req.shownAt ?? now })
        .where(and(eq(safetyRequests.id, req.id), isNull(safetyRequests.answeredAt)));
    }
    return c.body(null, 204);
  });

  app.put("/status", async (c) => {
    const phone = c.get("phone");
    const input = await body(
      c,
      z.object({
        appVersion: z.string().min(1).max(40),
        batteryPct: z.number().int().min(0).max(100).nullable(),
        charging: z.boolean().nullable(),
        deviceOwner: z.boolean(),
        lockIntact: z.boolean(),
        maintenance: z.boolean(),
        failedPolicies: z.array(z.string().min(1).max(200)).max(50),
        rulesEtag: z.string().max(100).nullable(),
        rulesAppliedAt: z.iso.datetime({ offset: true }).nullable(),
        dnsHost: z.string().max(253).nullable(),
        mode: z.enum(["strong", "light"]).optional(),
        protections: protections.optional(),
        timeUsed: z
          .record(limitTarget, z.number().int().min(0).max(1440))
          .refine((r) => Object.keys(r).length <= 200, "at most 200 entries")
          .optional(),
      }),
    );
    const appliedAt = input.rulesAppliedAt ? new Date(input.rulesAppliedAt) : null;
    if (appliedAt && appliedAt.getTime() > ctx.now().getTime() + 5 * 60_000) {
      return c.json({ error: "rulesAppliedAt is in the future" }, 400);
    }
    // A light-mode phone (paired as light, or reporting light) is only intact when all six
    // light protections are on, no policy failed and no maintenance unlock runs, whatever
    // it says about lockIntact. The server only ever makes this stricter.
    const p = input.protections;
    const light = phone.mode === "light" || input.mode === "light";
    const lockIntact =
      input.lockIntact &&
      (!light ||
        (p !== undefined &&
          LIGHT_LOCK.every((k) => p[k] === true) &&
          input.failedPolicies.length === 0 &&
          !input.maintenance));
    // The newest report replaces the one before; no history is kept. Times are stored in UTC.
    await ctx.db
      .update(phones)
      .set({
        deviceStatus: { ...input, lockIntact, rulesAppliedAt: appliedAt?.toISOString() ?? null },
        statusReportedAt: ctx.now(),
      })
      .where(eq(phones.id, phone.id));
    return c.body(null, 204);
  });

  app.put("/push-token", async (c) => {
    const input = await body(c, z.object({ fcmToken: z.string().min(1).max(4096).nullable() }));
    await ctx.db.update(phones).set({ fcmToken: input.fcmToken }).where(eq(phones.id, c.get("phone").id));
    return c.body(null, 204);
  });

  return app;
}
