// SPDX-License-Identifier: Apache-2.0
import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { contacts, phones, sosEvents } from "../db/schema.js";
import { phoneNumber } from "../lib/validation.js";
import { body, param } from "../lib/http.js";
import type { Ctx } from "../services/context.js";
import { deliverSos, sosCutoff, sosJson } from "../services/sos.js";
import { clearSnapshot } from "../services/extended-family.js";
import { wakePhone } from "../services/phones.js";
import { HIDDEN_PRESSES, QUICK_TEXT_MAX, sosSettingsJson } from "../services/quick-messages.js";
import { deviceQuickMessageRoutes, parentQuickMessageRoutes } from "./quick-messages.js";

const report = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["urgent", "help"]),
  location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
  battery: z.number().int().min(0).max(100).optional(),
  smsSubmitted: z.boolean().optional(),
  sentAt: z.iso.datetime().optional(),
  /** A hidden SOS (power button, clock) or a quick message marked as a code word. Always urgent. */
  trigger: z.enum(["power", "clock", "code"]).optional(),
  message: z.string().trim().min(1).max(QUICK_TEXT_MAX).optional(),
}).refine((r) => !r.trigger || r.kind === "urgent", { message: "hidden SOS is urgent" })
  .refine((r) => (r.trigger === "code") === (r.message !== undefined), { message: "message goes with a code word" });

type Phone = typeof phones.$inferSelect;

/** Every field is optional: the dashboard saves one switch at a time. */
const sosSettingsInput = z.strictObject({
  callbackNumber: phoneNumber.nullable().optional(),
  hiddenPower: z.boolean().optional(),
  hiddenPresses: z.number().int().refine((n) => (HIDDEN_PRESSES as readonly number[]).includes(n), "3 to 6 presses").optional(),
  hiddenClock: z.boolean().optional(),
  hiddenFeedback: z.enum(["vibrate", "none"]).optional(),
  quickMessagesEnabled: z.boolean().optional(),
  quickSuggestionsEnabled: z.boolean().optional(),
  familyInbox: z.boolean().optional(),
  checkIns: z.boolean().optional(),
  extendedFamily: z.boolean().optional(),
  locationSnapshots: z.boolean().optional(),
});

export function deviceSosRoutes<E extends { Variables: { phone: Phone } }>(app: Hono<E>, ctx: Ctx) {
  app.post("/sos", async (c) => {
    const input = await body(c, report);
    const phoneId = c.get("phone").id;
    const now = ctx.now();
    const at = input.sentAt ? new Date(input.sentAt) : now;
    if (at < sosCutoff(now)) throw new HTTPException(410, { message: "SOS expired" });
    const { event, fresh } = await ctx.db.transaction(async (tx) => {
      const [phone] = await tx.select().from(phones).where(eq(phones.id, phoneId)).for("update");
      if (!phone) throw new HTTPException(404, { message: "phone not found" });
      // The phone is the authority for what it has already done: an SMS that was sent is always
      // recorded and the parents told, whatever the phone's state is on the server now.
      if ((phone.profile !== "child" || phone.releaseRequestedAt) && !input.smsSubmitted) {
        throw new HTTPException(403, { message: "SOS unavailable" });
      }
      const key = and(eq(sosEvents.phoneId, phoneId), eq(sosEvents.id, input.id));
      const [existing] = await tx.select().from(sosEvents).where(key);
      if (existing) {
        if (input.smsSubmitted && existing.deliveredVia == null) {
          const [updated] = await tx.update(sosEvents).set({ deliveredVia: "sms" }).where(key).returning();
          return { event: updated!, fresh: false };
        }
        return { event: existing, fresh: false };
      }
      const [recent] = await tx.select({ total: count() }).from(sosEvents).where(and(
        eq(sosEvents.phoneId, phoneId),
        gt(sosEvents.receivedAt, new Date(now.getTime() - 600_000)),
      ));
      const limited = input.kind === "help" && (recent?.total ?? 0) >= 5;
      // Over the limit the report is still stored, only the notification is skipped.
      const location = phone.locationEnabled && phone.locationMode !== "off" ? input.location : undefined;
      const [row] = await tx.insert(sosEvents).values({
        id: input.id, phoneId, kind: input.kind, receivedAt: now, createdAt: at > now ? now : at,
        lat: location?.lat, lon: location?.lon, battery: input.battery,
        deliveredVia: input.smsSubmitted ? "sms" : null, trigger: input.trigger, message: input.message,
        notificationClaimedAt: limited ? now : null,
      }).returning();
      return { event: row!, fresh: !limited };
    });
    if (fresh) void deliverSos(ctx, event.id, phoneId).catch(() => console.error("SOS notification dispatch failed"));
    return c.json(sosJson(event));
  });

  app.get("/sos/:id", async (c) => {
    const [event] = await ctx.db.select().from(sosEvents).where(and(
      eq(sosEvents.phoneId, c.get("phone").id), eq(sosEvents.id, param(c, "id")),
      gt(sosEvents.createdAt, sosCutoff(ctx.now())),
    ));
    if (!event) throw new HTTPException(404, { message: "SOS not found" });
    return c.json({ seenAt: event.seenAt, seenBy: event.seenBy !== null, seenByName: event.seenByName });
  });

  deviceQuickMessageRoutes(app, ctx);
}

export function parentSosRoutes<E extends { Variables: { user: { id: string } } }>(
  app: Hono<E>, ctx: Ctx, requirePhone: (c: Context<E>) => Promise<Phone>,
) {
  app.get("/phones/:pid/sos", async (c) => {
    const phone = await requirePhone(c);
    const events = await ctx.db.select().from(sosEvents).where(and(eq(sosEvents.phoneId, phone.id),
      gt(sosEvents.createdAt, sosCutoff(ctx.now())),
      c.req.query("unseen") === "1" ? isNull(sosEvents.seenAt) : undefined,
    )).orderBy(desc(sosEvents.createdAt));
    return c.json({ events: events.map(sosJson), callbackNumber: phone.sosCallbackNumber, settings: sosSettingsJson(phone) });
  });

  app.put("/phones/:pid/sos", async (c) => {
    const phone = await requirePhone(c);
    if (phone.profile !== "child") throw new HTTPException(404, { message: "not found" });
    const input = await body(c, sosSettingsInput);
    const set = {
      ...(input.callbackNumber !== undefined ? { sosCallbackNumber: input.callbackNumber } : {}),
      ...(input.hiddenPower !== undefined ? { hiddenSosPower: input.hiddenPower } : {}),
      ...(input.hiddenPresses !== undefined ? { hiddenSosPresses: input.hiddenPresses } : {}),
      ...(input.hiddenClock !== undefined ? { hiddenSosClock: input.hiddenClock } : {}),
      ...(input.hiddenFeedback !== undefined ? { hiddenSosFeedback: input.hiddenFeedback } : {}),
      ...(input.quickMessagesEnabled !== undefined ? { quickMessagesEnabled: input.quickMessagesEnabled } : {}),
      ...(input.quickSuggestionsEnabled !== undefined ? { quickSuggestionsEnabled: input.quickSuggestionsEnabled } : {}),
      ...(input.familyInbox !== undefined ? { familyInboxEnabled: input.familyInbox } : {}),
      ...(input.checkIns !== undefined ? { checkInsEnabled: input.checkIns } : {}),
      ...(input.extendedFamily !== undefined ? { extendedFamilyEnabled: input.extendedFamily } : {}),
      ...(input.locationSnapshots !== undefined ? { locationSnapshotsEnabled: input.locationSnapshots } : {}),
    };
    if (Object.keys(set).length) await ctx.db.update(phones).set(set).where(eq(phones.id, phone.id));
    // Switching snapshots or the inbox off deletes a stored snapshot, as switching location off does.
    if (input.locationSnapshots === false || input.familyInbox === false) await clearSnapshot(ctx, phone.id);
    // Everything but the callback number is in the rules (the sos and inbox blocks).
    if (Object.keys(set).some((k) => k !== "sosCallbackNumber")) await wakePhone(ctx, phone.id, "rules");
    return c.body(null, 204);
  });

  parentQuickMessageRoutes(app, ctx, requirePhone);

  app.post("/phones/:pid/sos/:id/seen", async (c) => {
    const phone = await requirePhone(c);
    const key = and(eq(sosEvents.phoneId, phone.id), eq(sosEvents.id, param(c, "id")),
      gt(sosEvents.createdAt, sosCutoff(ctx.now())));
    const { name } = c.req.raw.body
      ? await body(c, z.strictObject({ name: z.string().trim().min(1).max(60).optional() }))
      : {};
    const [changed] = await ctx.db.update(sosEvents).set({ seenBy: c.get("user").id, seenByName: name, seenAt: ctx.now() })
      .where(and(key, isNull(sosEvents.seenAt))).returning();
    if (changed) return c.json(sosJson(changed));
    const [event] = await ctx.db.select().from(sosEvents).where(key);
    if (!event) throw new HTTPException(404, { message: "SOS not found" });
    return c.json(sosJson(event));
  });

  app.put("/phones/:pid/contacts/:cid/sos-parent", async (c) => {
    const phone = await requirePhone(c);
    if (phone.profile !== "child") throw new HTTPException(404, { message: "not found" });
    const { enabled } = await body(c, z.strictObject({ enabled: z.boolean() }));
    // A parent is always Family (docs/modes.md).
    const [row] = await ctx.db.update(contacts).set({ sosParent: enabled, ...(enabled ? { contactGroup: "family" as const } : {}) })
      .where(and(eq(contacts.phoneId, phone.id), eq(contacts.id, param(c, "cid")))).returning();
    if (!row) throw new HTTPException(404, { message: "contact not found" });
    await wakePhone(ctx, phone.id, "rules");
    return c.body(null, 204);
  });
}
