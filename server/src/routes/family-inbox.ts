// SPDX-License-Identifier: Apache-2.0
// The family inbox (docs/family-inbox.md). The child's messages arrive through
// POST /device/quick-messages/send (with `inbox: true`); these routes read the thread, take the
// phone's device receipts and the parents' short replies.
import { and, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { contacts, phones } from "../db/schema.js";
import { body } from "../lib/http.js";
import type { Ctx } from "../services/context.js";
import {
  addParentReply, familyMessageJson, inboxSwitches, listFamilyMessages, markReceived, REPLY_MAX,
} from "../services/family-inbox.js";
import { parentSnapshot } from "../services/extended-family.js";
import { publishLive } from "../services/live-events.js";
import { wakePhone } from "../services/phones.js";

type Phone = typeof phones.$inferSelect;

/** The parents the child's messages go to, by the names the child knows (the SOS contacts). */
async function recipients(ctx: Ctx, phoneId: string) {
  const rows = await ctx.db.select({ name: contacts.name }).from(contacts)
    .where(and(eq(contacts.phoneId, phoneId), eq(contacts.sosParent, true)));
  return rows.map((r) => r.name).sort((a, b) => a.localeCompare(b));
}

export function deviceFamilyInboxRoutes<E extends { Variables: { phone: Phone } }>(app: Hono<E>, ctx: Ctx) {
  // The phone reads the thread when the rules' `inbox.latest` changes. Read-only for the phone:
  // it never sees the parents' accounts, only the names they chose to sign with.
  app.get("/inbox", async (c) => {
    const [phone] = await ctx.db.select().from(phones).where(eq(phones.id, c.get("phone").id));
    if (!phone || phone.profile !== "child") throw new HTTPException(404, { message: "not found" });
    const switches = inboxSwitches(phone);
    if (!switches.familyInbox) return c.json({ ...switches, recipients: [], messages: [] });
    const [messages, snapshot] = await Promise.all([listFamilyMessages(ctx.db, phone.id), parentSnapshot(ctx, phone.id)]);
    return c.json({ ...switches, recipients: await recipients(ctx, phone.id), messages: messages.map((m) => familyMessageJson(m, snapshot)) });
  });

  // The device receipt: the phone has these parent replies. A repeat changes nothing.
  app.post("/inbox/received", async (c) => {
    const input = await body(c, z.strictObject({ ids: z.array(z.uuid()).max(50) }));
    const phone = c.get("phone");
    if (await markReceived(ctx, phone.id, input.ids)) {
      publishLive(ctx, { type: "inbox.message", householdId: phone.householdId, phoneId: phone.id });
    }
    return c.body(null, 204);
  });
}

export function parentFamilyInboxRoutes<E extends { Variables: { user: { id: string } } }>(
  app: Hono<E>, ctx: Ctx, childPhone: (c: Context<E>) => Promise<Phone>,
) {
  app.get("/phones/:pid/inbox", async (c) => {
    const phone = await childPhone(c);
    const [messages, snapshot] = await Promise.all([listFamilyMessages(ctx.db, phone.id), parentSnapshot(ctx, phone.id)]);
    return c.json({
      ...inboxSwitches(phone), recipients: await recipients(ctx, phone.id),
      messages: messages.map((m) => familyMessageJson(m, snapshot)),
    });
  });

  app.post("/phones/:pid/inbox", async (c) => {
    const phone = await childPhone(c);
    if (!inboxSwitches(phone).familyInbox || phone.releaseRequestedAt) {
      throw new HTTPException(403, { message: "the family inbox is off for this phone" });
    }
    const input = await body(c, z.strictObject({
      text: z.string().trim().min(1).max(REPLY_MAX),
      name: z.string().trim().min(1).max(60).optional(),
    }));
    const row = await addParentReply(ctx, phone.id, { userId: c.get("user").id, text: input.text, name: input.name });
    // The other parents' open dashboards show the reply too.
    publishLive(ctx, { type: "inbox.message", householdId: phone.householdId, phoneId: phone.id, id: row.id });
    // The rules' `inbox.latest` changed: the phone fetches the thread and sends its receipt.
    await wakePhone(ctx, phone.id, "rules");
    return c.json(familyMessageJson(row), 201);
  });
}
