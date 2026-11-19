// SPDX-License-Identifier: Apache-2.0
//
// Parent API for daily time limits (docs/time-limits.md). Mounted by parentRoutes, behind
// its session and household checks. Every write goes through submitChange.

import type { Context, Env, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { phones } from "../db/schema.js";
import { body } from "../lib/http.js";
import { packageName } from "../lib/validation.js";
import type { Op } from "../services/changes.js";
import type { Ctx } from "../services/context.js";
import { appLabels, bonusMinutes, limitInput, limitTarget, loadTimeLimits, localDate, TOTAL } from "../services/limits.js";

type Phone = typeof phones.$inferSelect;

export interface PhoneRouteHelpers<E extends Env> {
  requirePhone: (c: Context<E>) => Promise<Phone>;
  change: (c: Context<E>, phone: Phone, op: Op) => Promise<Response>;
}

function pkgParam(c: Context): string {
  const pkg = packageName.safeParse(c.req.param("package"));
  if (!pkg.success) throw new HTTPException(404, { message: "not found" });
  return pkg.data;
}

export function limitRoutes<E extends Env>(app: Hono<E>, ctx: Ctx, { requirePhone, change }: PhoneRouteHelpers<E>) {
  app.get("/phones/:pid/time-limits", async (c) => {
    const phone = await requirePhone(c);
    const l = await loadTimeLimits(ctx.db, phone, ctx.now());
    const labels = await appLabels(
      ctx.db,
      phone.id,
      l.apps.map((a) => a.packageName),
    );
    return c.json({
      total: l.total,
      apps: l.apps.map((a) => ({ packageName: a.packageName, label: labels.get(a.packageName) ?? a.packageName, limit: a.limit })),
      bonuses: l.bonuses,
      // Use is per day: a report from before local midnight is not today's.
      used:
        phone.statusReportedAt && localDate(phone.timezone, phone.statusReportedAt) === l.today
          ? (phone.deviceStatus?.timeUsed ?? null)
          : null,
    });
  });

  app.put("/phones/:pid/time-limits/total", async (c) => {
    const phone = await requirePhone(c);
    const limit = await body(c, limitInput);
    return change(c, phone, { type: "timeLimit.set", packageName: TOTAL, limit });
  });

  app.delete("/phones/:pid/time-limits/total", async (c) => {
    const phone = await requirePhone(c);
    return change(c, phone, { type: "timeLimit.set", packageName: TOTAL, limit: null });
  });

  app.put("/phones/:pid/time-limits/apps/:package", async (c) => {
    const phone = await requirePhone(c);
    const pkg = pkgParam(c);
    const limit = await body(c, limitInput);
    return change(c, phone, { type: "timeLimit.set", packageName: pkg, limit });
  });

  app.delete("/phones/:pid/time-limits/apps/:package", async (c) => {
    const phone = await requirePhone(c);
    return change(c, phone, { type: "timeLimit.set", packageName: pkgParam(c), limit: null });
  });

  app.post("/phones/:pid/time-limits/bonus", async (c) => {
    const phone = await requirePhone(c);
    const input = await body(c, z.object({ packageName: limitTarget, minutes: bonusMinutes }));
    return change(c, phone, {
      type: "timeLimit.bonus",
      packageName: input.packageName,
      date: localDate(phone.timezone, ctx.now()),
      minutes: input.minutes,
    });
  });
}
