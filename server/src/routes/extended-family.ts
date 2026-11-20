// SPDX-License-Identifier: Apache-2.0
// Extended family contacts and location snapshots (docs/extended-family.md): the parents' roster,
// the child's phone, and the contact's own page, which has no account and reaches nothing else.
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { householdMembers, phones } from "../db/schema.js";
import { body, param } from "../lib/http.js";
import type { Ctx } from "../services/context.js";
import {
  acceptInvite, answerInvite, blockContact, childReceived, childThread, clearSnapshot, CONTACT_REPLY_MAX, contactJson,
  contactReply, contactView, declineInvite, ExtendedError, extendedSwitches, inviteContact, leave, listContacts, NAME_MAX,
  previewInvite, recordChildToContact, recordSnapshot, removeContact, renewLink, sessionContact, setContactGroup,
} from "../services/extended-family.js";
import { markDelivered } from "../services/family-inbox.js";
import { notifyUsers } from "../services/notifications.js";
import { wakePhone } from "../services/phones.js";
import { QUICK_TEXT_MAX } from "../services/quick-messages.js";

type Phone = typeof phones.$inferSelect;

function rethrow(err: unknown): never {
  if (err instanceof ExtendedError) throw new HTTPException(err.status, { message: err.message });
  throw err;
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    rethrow(err);
  }
}

/** The stored text of a snapshot line; every reader shows its own words for it. */
const SNAPSHOT_TEXT = "Location";

async function childOnly<E extends { Variables: { phone: Phone } }>(ctx: Ctx, c: Context<E>) {
  const [phone] = await ctx.db.select().from(phones).where(eq(phones.id, c.get("phone").id));
  if (!phone || phone.profile !== "child") throw new HTTPException(404, { message: "not found" });
  return phone;
}

const snapshotInput = z.strictObject({
  id: z.uuid(),
  to: z.union([z.literal("parents"), z.uuid()]),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100_000).nullable().optional(),
  recordedAt: z.iso.datetime(),
  sentAt: z.iso.datetime().optional(),
});

export function deviceExtendedRoutes<E extends { Variables: { phone: Phone } }>(app: Hono<E>, ctx: Ctx) {
  app.get("/extended/:cid", async (c) => {
    const phone = await childOnly(ctx, c);
    return c.json(await guard(() => childThread(ctx, phone, param(c, "cid"))));
  });

  // The child says yes or no to an invitation, on the phone.
  app.post("/extended/:cid/answer", async (c) => {
    const phone = await childOnly(ctx, c);
    const input = await body(c, z.strictObject({ allow: z.boolean() }));
    await guard(() => answerInvite(ctx, phone, param(c, "cid"), input.allow));
    return c.body(null, 204);
  });

  // The child blocks a person. Always possible, also while the feature is switched off.
  app.post("/extended/:cid/block", async (c) => {
    const phone = await childOnly(ctx, c);
    await guard(() => blockContact(ctx, phone, param(c, "cid")));
    return c.body(null, 204);
  });

  app.post("/extended/:cid/messages", async (c) => {
    const phone = await childOnly(ctx, c);
    const input = await body(c, z.strictObject({
      id: z.uuid(), text: z.string().trim().min(1).max(QUICK_TEXT_MAX), sentAt: z.iso.datetime().optional(),
    }));
    return c.json(await recordChildToContact(ctx, phone, param(c, "cid"), {
      id: input.id, text: input.text, sentAt: input.sentAt ? new Date(input.sentAt) : undefined,
    }));
  });

  app.post("/extended/:cid/received", async (c) => {
    const phone = await childOnly(ctx, c);
    const input = await body(c, z.strictObject({ ids: z.array(z.uuid()).max(50) }));
    await childReceived(ctx, phone, param(c, "cid"), input.ids);
    return c.body(null, 204);
  });

  // A location snapshot the child confirmed. Recorded even if the switch changed on the way.
  app.post("/location-snapshot", async (c) => {
    const phone = await childOnly(ctx, c);
    const input = await body(c, snapshotInput);
    const result = await recordSnapshot(ctx, phone, {
      ...input, recordedAt: new Date(input.recordedAt), sentAt: input.sentAt ? new Date(input.sentAt) : undefined,
    }, SNAPSHOT_TEXT);
    if (!result.stored) return c.json({ stored: false, kept: false, gone: true });
    let notified = 0;
    if (input.to === "parents" && result.kept && !phone.releaseRequestedAt) {
      const members = await ctx.db.select({ id: householdMembers.userId }).from(householdMembers)
        .where(eq(householdMembers.householdId, phone.householdId));
      notified = await notifyUsers(ctx, members.map((m) => m.id), {
        type: "locationSnapshot", id: input.id, phoneId: phone.id, phoneName: phone.name,
      }).catch(() => 0);
    }
    if (input.to === "parents") await markDelivered(ctx, phone.id, input.id, notified);
    return c.json({ stored: true, kept: result.kept, expiresAt: result.expiresAt.toISOString(), notified });
  });
}

export function parentExtendedRoutes<E extends { Variables: { user: { id: string } } }>(
  app: Hono<E>, ctx: Ctx, childPhone: (c: Context<E>) => Promise<Phone>,
) {
  app.get("/phones/:pid/extended", async (c) => {
    const phone = await childPhone(c);
    const rows = await listContacts(ctx.db, phone.id);
    const sw = extendedSwitches(phone);
    return c.json({
      enabled: sw.extendedFamily, locationSnapshots: sw.locationSnapshots,
      contacts: rows.map((r) => contactJson(r, ctx.now())),
    });
  });

  app.post("/phones/:pid/extended", async (c) => {
    const phone = await childPhone(c);
    const input = await body(c, z.strictObject({ name: z.string().trim().min(1).max(NAME_MAX) }));
    const result = await guard(() => inviteContact(ctx, phone, c.get("user").id, input.name));
    await wakePhone(ctx, phone.id, "rules");
    return c.json({ contact: contactJson(result.contact, ctx.now()), link: result.link, expiresAt: result.expiresAt }, 201);
  });

  app.post("/phones/:pid/extended/:cid/link", async (c) => {
    const phone = await childPhone(c);
    const result = await guard(() => renewLink(ctx, phone, param(c, "cid")));
    await wakePhone(ctx, phone.id, "rules");
    return c.json({ contact: contactJson(result.contact, ctx.now()), link: result.link, expiresAt: result.expiresAt });
  });

  // Modes: the parent decides which contact group the person counts as (docs/modes.md).
  app.patch("/phones/:pid/extended/:cid", async (c) => {
    const phone = await childPhone(c);
    const input = await body(c, z.strictObject({ group: z.enum(["family", "friends", "others"]) }));
    const row = await guard(() => setContactGroup(ctx, phone.id, param(c, "cid"), input.group));
    await wakePhone(ctx, phone.id, "rules");
    return c.json(contactJson(row, ctx.now()));
  });

  app.delete("/phones/:pid/extended/:cid", async (c) => {
    const phone = await childPhone(c);
    await guard(() => removeContact(ctx, phone.id, param(c, "cid")));
    await wakePhone(ctx, phone.id, "rules");
    return c.body(null, 204);
  });
}

/** Turning snapshots off deletes the stored one; called from the switch route. */
export async function snapshotsSwitched(ctx: Ctx, phoneId: string, on: boolean) {
  if (!on) await clearSnapshot(ctx, phoneId);
}

type ContactEnv = { Variables: { contact: Awaited<ReturnType<typeof sessionContact>> & object } };

/**
 * The contact's own page (`/family` in the PWA). An invitation link is previewed, then accepted or
 * declined; accepting gives a session token that only these routes take. It is not a parent
 * session: the parent API answers 401 to it, and the device API 401 as well.
 */
export function familyContactRoutes(ctx: Ctx) {
  const app = new Hono<ContactEnv>();
  const token = z.strictObject({ token: z.string().min(10).max(200) });

  app.post("/invite", async (c) => {
    const input = await body(c, token);
    return c.json(await guard(() => previewInvite(ctx, input.token)));
  });

  app.post("/accept", async (c) => {
    const input = await body(c, token);
    const { session, contact } = await guard(() => acceptInvite(ctx, input.token));
    await wakePhone(ctx, contact.phoneId, "rules");
    return c.json({ session });
  });

  app.post("/decline", async (c) => {
    const input = await body(c, token);
    const row = await guard(() => declineInvite(ctx, input.token));
    await wakePhone(ctx, row.phoneId, "rules");
    return c.body(null, 204);
  });

  // Only a member's session gets past here: accepted, not blocked, not removed, no new link since.
  const member = async (c: Context<ContactEnv>, next: () => Promise<void>) => {
    const auth = c.req.header("authorization") ?? "";
    const found = auth.startsWith("Bearer ") ? await sessionContact(ctx, auth.slice(7)) : null;
    if (!found) throw new HTTPException(401, { message: "this link no longer works" });
    c.set("contact", found);
    await next();
  };
  app.use("/me", member);
  app.use("/me/*", member);

  app.get("/me", async (c) => {
    const { contact, phone } = c.get("contact");
    const { woke, ...view } = await contactView(ctx, contact, phone);
    // The child's messages reached this device: the phone fetches the new receipts.
    if (woke) await wakePhone(ctx, phone.id, "rules");
    return c.json(view);
  });

  app.post("/me/messages", async (c) => {
    const { contact, phone } = c.get("contact");
    const input = await body(c, z.strictObject({ text: z.string().trim().min(1).max(CONTACT_REPLY_MAX) }));
    const row = await guard(() => contactReply(ctx, contact, phone, input.text));
    await wakePhone(ctx, phone.id, "rules");
    return c.json({ id: row.id, from: row.sender, kind: row.kind, text: row.text, sentAt: row.sentAt, receivedAt: null }, 201);
  });

  // The person leaves. The child's roster shows they are gone.
  app.delete("/me", async (c) => {
    const { contact } = c.get("contact");
    await leave(ctx, contact);
    await wakePhone(ctx, contact.phoneId, "rules");
    return c.body(null, 204);
  });

  return app;
}
