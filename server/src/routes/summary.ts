// SPDX-License-Identifier: Apache-2.0
//
// Parent API for the weekly summary (docs/weekly-summary.md). Mounted by parentRoutes, behind
// its session check; every route needs a member of the household.

import { eq } from "drizzle-orm";
import type { Context, Env, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { households } from "../db/schema.js";
import { body, param } from "../lib/http.js";
import { validTimeZone } from "../lib/zoned-time.js";
import type { Ctx } from "../services/context.js";
import { listSummaries } from "../services/weekly-summary.js";

type Household = typeof households.$inferSelect;

export function summarySettingsJson(h: Household, mailEnabled: boolean) {
  return {
    enabled: h.summaryEnabled,
    byMail: h.summaryByMail,
    byPush: h.summaryByPush,
    actNowOnly: h.actNowOnly,
    day: h.summaryDay,
    hour: h.summaryHour,
    minute: h.summaryMinute,
    timeZone: h.timeZone,
    mailEnabled,
  };
}

export function summaryRoutes<E extends Env>(
  app: Hono<E>,
  ctx: Ctx,
  { requireMember }: { requireMember: (c: Context<E>, householdId: string) => Promise<unknown> },
) {
  async function household(c: Context<E>): Promise<Household> {
    const hid = param(c, "hid");
    await requireMember(c, hid);
    const [h] = await ctx.db.select().from(households).where(eq(households.id, hid));
    if (!h) throw new HTTPException(404, { message: "not found" });
    return h;
  }

  app.get("/households/:hid/summary-settings", async (c) => {
    return c.json(summarySettingsJson(await household(c), ctx.mail.canSend));
  });

  app.patch("/households/:hid/summary-settings", async (c) => {
    const h = await household(c);
    const input = await body(
      c,
      z.object({
        enabled: z.boolean().optional(),
        byMail: z.boolean().optional(),
        byPush: z.boolean().optional(),
        actNowOnly: z.boolean().optional(),
        day: z.number().int().min(0).max(6).optional(),
        hour: z.number().int().min(0).max(23).optional(),
        minute: z.number().int().min(0).max(59).optional(),
        timeZone: z.string().min(1).max(64).refine(validTimeZone, "unknown time zone").optional(),
      }),
    );
    const fields = {
      ...(input.enabled !== undefined ? { summaryEnabled: input.enabled } : {}),
      ...(input.byMail !== undefined ? { summaryByMail: input.byMail } : {}),
      ...(input.byPush !== undefined ? { summaryByPush: input.byPush } : {}),
      ...(input.actNowOnly !== undefined ? { actNowOnly: input.actNowOnly } : {}),
      ...(input.day !== undefined ? { summaryDay: input.day } : {}),
      ...(input.hour !== undefined ? { summaryHour: input.hour } : {}),
      ...(input.minute !== undefined ? { summaryMinute: input.minute } : {}),
      ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
    };
    if (Object.keys(fields).length === 0) return c.json(summarySettingsJson(h, ctx.mail.canSend));
    const [updated] = await ctx.db.update(households).set(fields).where(eq(households.id, h.id)).returning();
    return c.json(summarySettingsJson(updated!, ctx.mail.canSend));
  });

  app.get("/households/:hid/summaries", async (c) => {
    const h = await household(c);
    const rows = await listSummaries(ctx.db, h.id);
    return c.json({
      summaries: rows.map((s) => ({
        id: s.id,
        weekEnd: s.weekEnd,
        periodStart: s.periodStart.toISOString(),
        periodEnd: s.periodEnd.toISOString(),
        data: s.data,
      })),
    });
  });
}
