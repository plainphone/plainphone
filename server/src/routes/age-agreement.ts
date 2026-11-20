// SPDX-License-Identifier: Apache-2.0
// Age presets, the review date and the family agreement (docs/age-presets.md,
// docs/family-agreement.md). Child phones only: a Myself phone has no parents to remind.
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { phones } from "../db/schema.js";
import { AGE_PRESET_IDS } from "../lib/age-presets.js";
import { body } from "../lib/http.js";
import {
  AGREEMENT_LINE_MAX, agreementJson, applyAgePreset, markReviewed, presetsJson, REVIEW_INTERVALS, reviewState,
  ReviewError, setAgreement, setReview,
} from "../services/age-review.js";
import { ChangeError } from "../services/changes.js";
import type { Ctx } from "../services/context.js";

type Phone = typeof phones.$inferSelect;

const line = z.string().max(AGREEMENT_LINE_MAX * 2);

export function parentAgeRoutes<E extends { Variables: { user: { id: string } } }>(
  app: Hono<E>, ctx: Ctx, requirePhone: (c: Context<E>) => Promise<Phone>,
) {
  async function childPhone(c: Context<E>) {
    const phone = await requirePhone(c);
    if (phone.profile !== "child") throw new HTTPException(404, { message: "not found" });
    return phone;
  }
  function rethrow(err: unknown): never {
    if (err instanceof ReviewError || err instanceof ChangeError) throw new HTTPException(err.status, { message: err.message });
    throw err;
  }
  const reviewJson = async (phone: Phone) => ({ agePreset: phone.agePreset, review: await reviewState(ctx, phone) });

  // The table of presets: one source for setup in the dashboard and the parent app.
  app.get("/age-presets", (c) => c.json({ presets: presetsJson() }));

  app.get("/phones/:pid/age", async (c) => c.json(await reviewJson(await childPhone(c))));

  app.post("/phones/:pid/age-preset", async (c) => {
    const phone = await childPhone(c);
    const input = await body(c, z.strictObject({ preset: z.enum(AGE_PRESET_IDS) }));
    try {
      await applyAgePreset(ctx, phone, c.get("user").id, input.preset);
    } catch (err) {
      rethrow(err);
    }
    return c.json(await reviewJson(await childPhone(c)));
  });

  app.put("/phones/:pid/review", async (c) => {
    const phone = await childPhone(c);
    const input = await body(c, z.strictObject({
      enabled: z.boolean().optional(),
      intervalMonths: z.number().int().refine((n) => (REVIEW_INTERVALS as readonly number[]).includes(n)).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }));
    try {
      await setReview(ctx, phone, input);
    } catch (err) {
      rethrow(err);
    }
    return c.json(await reviewJson(await childPhone(c)));
  });

  app.post("/phones/:pid/review/done", async (c) => {
    const phone = await childPhone(c);
    try {
      await markReviewed(ctx, phone);
    } catch (err) {
      rethrow(err);
    }
    return c.json(await reviewJson(await childPhone(c)));
  });

  // The agreement is the family's own words: stored for this phone, never logged, never in analytics.
  app.get("/phones/:pid/agreement", async (c) => c.json(agreementJson(await childPhone(c))));

  app.put("/phones/:pid/agreement", async (c) => {
    const phone = await childPhone(c);
    const input = await body(c, z.strictObject({
      lines: z.array(line).max(20).optional(),
      adultLines: z.array(line).max(20).optional(),
      enabled: z.boolean().optional(),
      onHome: z.boolean().optional(),
    }));
    try {
      await setAgreement(ctx, phone, input);
    } catch (err) {
      rethrow(err);
    }
    return c.json(agreementJson(await childPhone(c)));
  });
}
