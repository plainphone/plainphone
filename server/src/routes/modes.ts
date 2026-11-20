// SPDX-License-Identifier: Apache-2.0
//
// Parent API for modes and contact groups (docs/modes.md). Mounted by parentRoutes, behind its
// session and household checks. Child phones only: a Self phone's rules wait for the key, and
// modes do not go through that.

import type { Context, Env, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { contacts, type phones } from "../db/schema.js";
import { body } from "../lib/http.js";
import type { Ctx } from "../services/context.js";
import {
  contactGroupInput,
  createMode,
  currentMode,
  deleteMode,
  loadModes,
  ModeError,
  modeInput,
  modeJson,
  scheduleInput,
  setSchedule,
  slotJson,
  updateMode,
} from "../services/modes.js";
import { wakePhone } from "../services/phones.js";

type Phone = typeof phones.$inferSelect;

async function run<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof ModeError) throw new HTTPException(e.status, { message: e.message });
    throw e;
  }
}

export function modeRoutes<E extends Env>(app: Hono<E>, ctx: Ctx, { requirePhone }: { requirePhone: (c: Context<E>) => Promise<Phone> }) {
  const childPhone = async (c: Context<E>) => {
    const phone = await requirePhone(c);
    if (phone.profile !== "child") throw new HTTPException(404, { message: "not found" });
    return phone;
  };
  const id = (c: Context<E>, name: string) => {
    const value = c.req.param(name) ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(value)) throw new HTTPException(404, { message: "not found" });
    return value;
  };

  app.get("/phones/:pid/modes", async (c) => {
    const phone = await childPhone(c);
    const { modes, slots } = await loadModes(ctx.db, phone.id);
    const [parent] = await ctx.db.select({ id: contacts.id }).from(contacts)
      .where(and(eq(contacts.phoneId, phone.id), eq(contacts.sosParent, true))).limit(1);
    c.header("Cache-Control", "no-store");
    return c.json({
      enabled: phone.modesEnabled,
      parentsMarked: parent !== undefined,
      timezone: phone.timezone,
      modes: modes.map(modeJson),
      slots: slots.map(slotJson),
      current: phone.modesEnabled ? currentMode(modes, slots, ctx.now(), phone.timezone) : null,
    });
  });

  app.post("/phones/:pid/modes", async (c) => {
    const phone = await childPhone(c);
    const input = await body(c, modeInput);
    const mode = await run(() => createMode(ctx, phone, input));
    await wakePhone(ctx, phone.id, "rules");
    return c.json(modeJson(mode), 201);
  });

  app.put("/phones/:pid/modes/:mid", async (c) => {
    const phone = await childPhone(c);
    const raw: unknown = await c.req.json().catch(() => {
      throw new HTTPException(400, { message: "invalid JSON" });
    });
    const mode = await run(() => updateMode(ctx, phone, id(c, "mid"), raw));
    await wakePhone(ctx, phone.id, "rules");
    return c.json(modeJson(mode));
  });

  app.delete("/phones/:pid/modes/:mid", async (c) => {
    const phone = await childPhone(c);
    await run(() => deleteMode(ctx, phone, id(c, "mid")));
    await wakePhone(ctx, phone.id, "rules");
    return c.body(null, 204);
  });

  app.put("/phones/:pid/mode-schedule", async (c) => {
    const phone = await childPhone(c);
    const { slots } = await body(c, scheduleInput);
    const rows = await run(() => setSchedule(ctx, phone, slots));
    await wakePhone(ctx, phone.id, "rules");
    return c.json({ slots: rows.map(slotJson) });
  });

  app.patch("/phones/:pid/contacts/:cid", async (c) => {
    const phone = await childPhone(c);
    const { group } = await body(c, contactGroupInput);
    const cid = id(c, "cid");
    const [current] = await ctx.db.select().from(contacts).where(and(eq(contacts.phoneId, phone.id), eq(contacts.id, cid)));
    if (!current) throw new HTTPException(404, { message: "contact not found" });
    if (current.sosParent && group !== "family") throw new HTTPException(400, { message: "a parent is always family" });
    const [row] = await ctx.db.update(contacts).set({ contactGroup: group })
      .where(and(eq(contacts.phoneId, phone.id), eq(contacts.id, cid))).returning();
    if (phone.modesEnabled) await wakePhone(ctx, phone.id, "rules");
    return c.json({ id: row!.id, name: row!.name, number: row!.number, group: row!.contactGroup, ...(row!.sosParent ? { sosParent: true } : {}) });
  });
}
