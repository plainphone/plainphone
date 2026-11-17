// SPDX-License-Identifier: Apache-2.0
//
// Parent API for location, "Ring the phone" and "Are you okay?" (docs/location.md). Mounted by
// parentRoutes, behind its session and household checks.

import { and, eq } from "drizzle-orm";
import type { Context, Env, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { contacts, LOCATION_MODES, locations, type phones, phones as phonesTable, safetyRequests } from "../db/schema.js";
import { body, RateLimiter } from "../lib/http.js";
import type { Ctx } from "../services/context.js";
import { wakePhone } from "../services/phones.js";
import {
  CHECKIN_MAX_MINUTES,
  CHECKIN_MIN_MINUTES,
  checkinJson,
  checkinStatus,
  loadSafety,
  ringActive,
  ringJson,
  startRequest,
} from "../services/safety.js";

type Phone = typeof phones.$inferSelect;

export interface LocationRouteHelpers<E extends Env> {
  requirePhone: (c: Context<E>) => Promise<Phone>;
  userId: (c: Context<E>) => string;
}

export function locationRoutes<E extends Env>(app: Hono<E>, ctx: Ctx, { requirePhone, userId }: LocationRouteHelpers<E>) {
  // A ring or a check-in every few minutes is plenty; this only stops a runaway client.
  const requestLimit = new RateLimiter(30, 60 * 60_000);

  async function state(phone: Phone) {
    const [[loc], safety] = await Promise.all([
      ctx.db.select().from(locations).where(eq(locations.phoneId, phone.id)),
      loadSafety(ctx, phone.id),
    ]);
    const now = ctx.now();
    return {
      enabled: phone.locationEnabled,
      mode: phone.locationMode,
      requestedAt: phone.locateRequestedAt?.toISOString() ?? null,
      location: loc
        ? { lat: loc.lat, lon: loc.lon, accuracyM: loc.accuracyM, recordedAt: loc.recordedAt.toISOString() }
        : null,
      ring: ringJson(safety.ring, now),
      checkin: checkinJson(safety.checkin, phone.locationMode, now),
    };
  }

  function limit(phone: Phone) {
    if (!requestLimit.take(phone.id)) throw new HTTPException(429, { message: "too many requests for this phone" });
  }

  // Location (D7: only the latest position)
  app.get("/phones/:pid/location", async (c) => c.json(await state(await requirePhone(c))));

  app.put("/phones/:pid/location/mode", async (c) => {
    const phone = await requirePhone(c);
    const { mode } = await body(c, z.object({ mode: z.enum(LOCATION_MODES) }));
    await setLocationMode(ctx, phone, mode);
    const [updated] = await ctx.db.select().from(phonesTable).where(eq(phonesTable.id, phone.id));
    return c.json(await state(updated!));
  });

  app.post("/phones/:pid/locate", async (c) => {
    const phone = await requirePhone(c);
    if (phone.locationMode === "off") return c.json({ error: "location is off for this phone" }, 409);
    await ctx.db.update(phonesTable).set({ locateRequestedAt: ctx.now() }).where(eq(phonesTable.id, phone.id));
    await wakePhone(ctx, phone.id, "locate");
    return c.json({ requestedAt: ctx.now().toISOString() }, 202);
  });

  // Ring the phone: alarm sound and vibration for at most 5 minutes.
  app.post("/phones/:pid/ring", async (c) => {
    const phone = await requirePhone(c);
    const input = await body(c, z.object({ stopOnAnswer: z.boolean().default(true) }));
    limit(phone);
    const row = await startRequest(ctx, phone.id, userId(c), { kind: "ring", stopOnAnswer: input.stopOnAnswer });
    await wakePhone(ctx, phone.id, "rules");
    return c.json({ ring: ringJson(row, ctx.now()) }, 202);
  });

  app.delete("/phones/:pid/ring", async (c) => {
    const phone = await requirePhone(c);
    const { ring } = await loadSafety(ctx, phone.id);
    if (ringActive(ring, ctx.now())) {
      await ctx.db.update(safetyRequests).set({ stoppedAt: ctx.now() }).where(eq(safetyRequests.id, ring.id));
      await wakePhone(ctx, phone.id, "rules");
    }
    return c.json({ ring: ringJson((await loadSafety(ctx, phone.id)).ring, ctx.now()) });
  });

  // "Are you okay?": the child answers, or the phone sends one position after the deadline.
  app.post("/phones/:pid/checkin", async (c) => {
    const phone = await requirePhone(c);
    const input = await body(
      c,
      z.object({
        minutes: z.number().int().min(CHECKIN_MIN_MINUTES).max(CHECKIN_MAX_MINUTES),
        callNumber: z.string().max(32).nullable().optional(),
      }),
    );
    // "Call me" may only dial a number the phone can call anyway.
    let callNumber: string | null = null;
    if (input.callNumber) {
      const [hit] = await ctx.db
        .select({ number: contacts.number })
        .from(contacts)
        .where(and(eq(contacts.phoneId, phone.id), eq(contacts.number, input.callNumber)));
      if (!hit) return c.json({ error: "callNumber must be one of the phone's approved contacts" }, 400);
      callNumber = hit.number;
    }
    limit(phone);
    const row = await startRequest(ctx, phone.id, userId(c), { kind: "checkin", minutes: input.minutes, callNumber });
    await wakePhone(ctx, phone.id, "rules");
    return c.json({ checkin: checkinJson(row, phone.locationMode, ctx.now()) }, 202);
  });

  app.delete("/phones/:pid/checkin", async (c) => {
    const phone = await requirePhone(c);
    const { checkin } = await loadSafety(ctx, phone.id);
    if (checkin && !checkin.stoppedAt && !checkin.locatedAt && checkinStatus(checkin, ctx.now()) !== "answered") {
      await ctx.db.update(safetyRequests).set({ stoppedAt: ctx.now() }).where(eq(safetyRequests.id, checkin.id));
      await wakePhone(ctx, phone.id, "rules");
    }
    return c.json({ checkin: checkinJson((await loadSafety(ctx, phone.id)).checkin, phone.locationMode, ctx.now()) });
  });
}

/** Changes the location mode. Turning it off deletes the stored position (D7). */
export async function setLocationMode(ctx: Ctx, phone: Phone, mode: (typeof LOCATION_MODES)[number]) {
  await ctx.db
    .update(phonesTable)
    .set({ locationMode: mode, locationEnabled: mode !== "off", ...(mode === "off" ? { locateRequestedAt: null } : {}) })
    .where(eq(phonesTable.id, phone.id));
  if (mode === "off") await ctx.db.delete(locations).where(eq(locations.phoneId, phone.id));
  if (mode !== phone.locationMode) await wakePhone(ctx, phone.id, "rules");
}
