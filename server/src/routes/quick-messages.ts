// SPDX-License-Identifier: Apache-2.0
// Quick messages (docs/sos.md): the parents write them, the child sends one with one tap and
// may suggest new ones. A code word (`meansSos`) goes to POST /device/sos instead.
import { and, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { phones, quickMessages } from "../db/schema.js";
import { body, param } from "../lib/http.js";
import type { Ctx } from "../services/context.js";
import { wakePhone } from "../services/phones.js";
import { deviceExtendedRoutes, parentExtendedRoutes } from "./extended-family.js";
import { deviceFamilyInboxRoutes, parentFamilyInboxRoutes } from "./family-inbox.js";
import {
  addQuickMessage, approveSuggestion, listQuickMessages, QUICK_TEXT_MAX, QuickMessageError, quickMessageJson,
  sendQuickMessage, suggestQuickMessage,
} from "../services/quick-messages.js";

type Phone = typeof phones.$inferSelect;

const text = z.string().trim().min(1).max(QUICK_TEXT_MAX);

function rethrow(err: unknown): never {
  if (err instanceof QuickMessageError) throw new HTTPException(err.status, { message: err.message });
  throw err;
}

export function deviceQuickMessageRoutes<E extends { Variables: { phone: Phone } }>(app: Hono<E>, ctx: Ctx) {
  app.post("/quick-messages/send", async (c) => {
    // `inbox`, `kind` and `sentAt` come from the family inbox (docs/family-inbox.md).
    const input = await body(c, z.strictObject({
      id: z.uuid(), text, kind: z.enum(["quick", "checkin"]).optional(), inbox: z.boolean().optional(),
      sentAt: z.iso.datetime().optional(), smsSent: z.boolean().optional(),
    }));
    const [phone] = await ctx.db.select().from(phones).where(eq(phones.id, c.get("phone").id));
    if (!phone || phone.profile !== "child") throw new HTTPException(404, { message: "not found" });
    return c.json(await sendQuickMessage(ctx, phone, { ...input, sentAt: input.sentAt ? new Date(input.sentAt) : undefined }));
  });

  deviceFamilyInboxRoutes(app, ctx);
  deviceExtendedRoutes(app, ctx);

  app.post("/quick-messages/suggest", async (c) => {
    const input = await body(c, z.strictObject({ text }));
    const [phone] = await ctx.db.select().from(phones).where(eq(phones.id, c.get("phone").id));
    if (!phone) throw new HTTPException(404, { message: "not found" });
    try {
      return c.json(await suggestQuickMessage(ctx, phone, input.text), 201);
    } catch (err) {
      rethrow(err);
    }
  });
}

export function parentQuickMessageRoutes<E extends { Variables: { user: { id: string } } }>(
  app: Hono<E>, ctx: Ctx, requirePhone: (c: Context<E>) => Promise<Phone>,
) {
  async function childPhone(c: Context<E>) {
    const phone = await requirePhone(c);
    if (phone.profile !== "child") throw new HTTPException(404, { message: "not found" });
    return phone;
  }
  const key = (phoneId: string, id: string) => and(eq(quickMessages.phoneId, phoneId), eq(quickMessages.id, id));
  parentFamilyInboxRoutes(app, ctx, childPhone);
  parentExtendedRoutes(app, ctx, childPhone);

  app.get("/phones/:pid/quick-messages", async (c) => {
    const phone = await childPhone(c);
    return c.json(await listQuickMessages(ctx.db, phone.id));
  });

  app.post("/phones/:pid/quick-messages", async (c) => {
    const phone = await childPhone(c);
    const input = await body(c, z.strictObject({ text, meansSos: z.boolean().default(false) }));
    try {
      const row = await addQuickMessage(ctx, phone.id, input);
      await wakePhone(ctx, phone.id, "rules");
      return c.json(quickMessageJson(row), 201);
    } catch (err) {
      rethrow(err);
    }
  });

  app.patch("/phones/:pid/quick-messages/:id", async (c) => {
    const phone = await childPhone(c);
    const input = await body(c, z.strictObject({ text: text.optional(), meansSos: z.boolean().optional() })
      .refine((v) => v.text !== undefined || v.meansSos !== undefined, { message: "nothing to change" }));
    const [row] = await ctx.db.update(quickMessages).set(input)
      .where(and(key(phone.id, param(c, "id")), eq(quickMessages.status, "active"))).returning();
    if (!row) throw new HTTPException(404, { message: "quick message not found" });
    await wakePhone(ctx, phone.id, "rules");
    return c.json(quickMessageJson(row));
  });

  app.delete("/phones/:pid/quick-messages/:id", async (c) => {
    const phone = await childPhone(c);
    const [row] = await ctx.db.delete(quickMessages).where(key(phone.id, param(c, "id"))).returning();
    if (!row) throw new HTTPException(404, { message: "quick message not found" });
    if (row.status === "active") await wakePhone(ctx, phone.id, "rules");
    return c.body(null, 204);
  });

  app.post("/phones/:pid/quick-messages/:id/approve", async (c) => {
    const phone = await childPhone(c);
    const { meansSos } = c.req.raw.body
      ? await body(c, z.strictObject({ meansSos: z.boolean().optional() }))
      : { meansSos: undefined };
    try {
      const row = await approveSuggestion(ctx, phone.id, param(c, "id"), meansSos ?? false);
      await wakePhone(ctx, phone.id, "rules");
      return c.json(quickMessageJson(row));
    } catch (err) {
      rethrow(err);
    }
  });

  // Declining removes the suggestion; nothing about it is kept.
  app.post("/phones/:pid/quick-messages/:id/decline", async (c) => {
    const phone = await childPhone(c);
    const [row] = await ctx.db.delete(quickMessages)
      .where(and(key(phone.id, param(c, "id")), eq(quickMessages.status, "suggested"))).returning();
    if (!row) throw new HTTPException(404, { message: "suggestion not found" });
    return c.body(null, 204);
  });
}
