// SPDX-License-Identifier: Apache-2.0
// Asking a parent to call (docs/sos.md#asking-a-parent-to-call). Neither side sends a number:
// the phone asks, the parents dial the number they saved.
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { phones } from "../db/schema.js";
import { body, param } from "../lib/http.js";
import { phoneNumber } from "../lib/validation.js";
import {
  CallbackError, getDeviceCallback, listCallbackRequests, markCallbackDone, requestCallback,
} from "../services/callback-requests.js";
import type { Ctx } from "../services/context.js";
import { elapsedHeader } from "../services/latency.js";

type Phone = typeof phones.$inferSelect;

function rethrow(err: unknown): never {
  if (err instanceof CallbackError) throw new HTTPException(err.status, { message: err.message });
  throw err;
}

export function deviceCallbackRoutes<E extends { Variables: { phone: Phone } }>(app: Hono<E>, ctx: Ctx) {
  app.post("/callback-requests", async (c) => {
    const input = await body(c, z.strictObject({ id: z.uuid(), sentAt: z.iso.datetime().optional() }));
    try {
      return c.json(await requestCallback(ctx, c.get("phone").id, {
        id: input.id, sentAt: input.sentAt ? new Date(input.sentAt) : undefined,
        elapsedMs: elapsedHeader(c.req.header("x-plainphone-elapsed-ms")),
      }));
    } catch (err) {
      rethrow(err);
    }
  });

  app.get("/callback-requests/:id", async (c) => {
    try {
      return c.json(await getDeviceCallback(ctx, c.get("phone").id, param(c, "id")));
    } catch (err) {
      rethrow(err);
    }
  });
}

export function parentCallbackRoutes<E extends { Variables: { user: { id: string } } }>(
  app: Hono<E>, ctx: Ctx, requirePhone: (c: Context<E>) => Promise<Phone>,
) {
  async function childPhone(c: Context<E>) {
    const phone = await requirePhone(c);
    if (phone.profile !== "child") throw new HTTPException(404, { message: "not found" });
    return phone;
  }

  app.get("/phones/:pid/callback-requests", async (c) => c.json(await listCallbackRequests(ctx, await childPhone(c))));

  app.post("/phones/:pid/callback-requests/:id/done", async (c) => {
    const phone = await childPhone(c);
    const input = await body(c, z.discriminatedUnion("via", [
      z.strictObject({ via: z.literal("number"), number: phoneNumber }),
      z.strictObject({ via: z.literal("other"), at: z.iso.datetime().optional() }),
    ]));
    try {
      return c.json(await markCallbackDone(ctx, phone, c.get("user").id, param(c, "id"),
        input.via === "number" ? input : { via: "other", at: input.at ? new Date(input.at) : undefined }));
    } catch (err) {
      rethrow(err);
    }
  });
}
