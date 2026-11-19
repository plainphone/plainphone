// SPDX-License-Identifier: Apache-2.0
//
// "Ask for more time" (docs/more-time.md). The phone asks from its stop screen; a parent answers
// from the notification, the dashboard or the parent app. Both sides use these routes.

import type { Context, Env, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { phones } from "../db/schema.js";
import { body, param, RateLimiter } from "../lib/http.js";
import type { Ctx } from "../services/context.js";
import { limitTarget } from "../services/limits.js";
import {
  answerMoreTimeRequest,
  createMoreTimeRequest,
  MORE_TIME_ANSWERS,
  MORE_TIME_REASON_MAX,
  MoreTimeError,
  moreTimeJson,
  parentMoreTimeList,
  phoneMoreTimeList,
} from "../services/more-time.js";

type Phone = typeof phones.$inferSelect;

function fail(err: unknown): never {
  if (err instanceof MoreTimeError) throw new HTTPException(err.status, { message: err.message });
  throw err;
}

export function deviceMoreTimeRoutes<E extends { Variables: { phone: Phone } }>(app: Hono<E>, ctx: Ctx) {
  // A bored child cannot flood the parents: a few asks an hour per phone, on top of "one open request per app".
  const askLimit = new RateLimiter(6, 60 * 60_000);
  app.post("/more-time-requests", async (c) => {
    const input = await body(
      c,
      z.object({
        packageName: limitTarget,
        reason: z.string().trim().max(MORE_TIME_REASON_MAX).optional(),
      }),
    );
    const phone = c.get("phone");
    try {
      const { request, created } = await createMoreTimeRequest(ctx, phone, input, () => askLimit.take(phone.id));
      return c.json(moreTimeJson(request), created ? 201 : 200);
    } catch (err) {
      return fail(err);
    }
  });

  app.get("/more-time-requests", async (c) => c.json({ requests: await phoneMoreTimeList(ctx, c.get("phone")) }));
}

export interface MoreTimeParentHelpers<E extends Env> {
  requirePhone: (c: Context<E>) => Promise<Phone>;
  userId: (c: Context<E>) => string;
}

export function parentMoreTimeRoutes<E extends Env>(app: Hono<E>, ctx: Ctx, { requirePhone, userId }: MoreTimeParentHelpers<E>) {
  app.get("/phones/:pid/more-time-requests", async (c) => {
    const phone = await requirePhone(c);
    c.header("Cache-Control", "no-store");
    return c.json({ requests: await parentMoreTimeList(ctx, phone, userId(c)) });
  });

  // Idempotent: the first answer wins and a later one gets that result back with `won: false`.
  app.post("/phones/:pid/more-time-requests/:rid/answer", async (c) => {
    const phone = await requirePhone(c);
    const input = await body(c, z.object({ answer: z.enum(MORE_TIME_ANSWERS) }));
    try {
      const { request, won } = await answerMoreTimeRequest(ctx, phone, param(c, "rid"), userId(c), input.answer);
      return c.json({ ...moreTimeJson(request), won, answeredByYou: request.decidedBy === userId(c) });
    } catch (err) {
      return fail(err);
    }
  });
}
