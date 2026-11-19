// SPDX-License-Identifier: Apache-2.0
import { and, eq, gt } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { householdMembers, phoneMoves } from "../db/schema.js";
import { body, param, RateLimiter } from "../lib/http.js";
import type { Op } from "../services/changes.js";
import type { Ctx } from "../services/context.js";
import { phoneSummaries } from "../services/phones.js";
import { allowsServerMove, type MovePhone } from "../services/move-policy.js";
import {
  exportMove, importMove, maxMoveBytes, MoveError, moveSource, moveTicket, prepareImport, sourceIdentity,
} from "../services/server-move.js";

import type { ParentEnv } from "./parent.js";

export function mountServerMoveRoutes(
  app: Hono<ParentEnv>,
  ctx: Ctx,
  access: {
    requireMember(c: Context<ParentEnv>, id: string): Promise<typeof householdMembers.$inferSelect>;
    requirePhone(c: Context<ParentEnv>): Promise<MovePhone>;
    change(c: Context<ParentEnv>, phone: MovePhone, op: Op): Promise<Response>;
  },
) {
  const transfers = new RateLimiter(150, 60 * 60_000);
  function limit(c: Context<ParentEnv>) {
    if (!transfers.take(c.get("user").id)) throw new HTTPException(429, { message: "too many transfers" });
    c.header("Cache-Control", "no-store");
  }
  async function owner(c: Context<ParentEnv>, householdId: string) {
    const member = await access.requireMember(c, householdId);
    if (member.role !== "owner") throw new HTTPException(403, { message: "only the household owner can move phones" });
  }
  async function transfer<T>(work: () => Promise<T>) {
    try { return await work(); }
    catch (err) {
      if (err instanceof MoveError) throw new HTTPException(err.status, { message: err.message });
      throw err;
    }
  }

  app.get("/households/:hid/server-move/phones", async (c) => {
    const householdId = param(c, "hid");
    await owner(c, householdId);
    return c.json({ phones: await phoneSummaries(ctx, [householdId]) });
  });

  app.get("/households/:hid/server-move/source", async (c) => {
    await owner(c, param(c, "hid"));
    limit(c);
    return c.json(await transfer(() => sourceIdentity(ctx)));
  });
  app.post("/households/:hid/server-move/prepare", bodyLimit({ maxSize: 4096 }), async (c) => {
    const householdId = param(c, "hid");
    await owner(c, householdId);
    limit(c);
    const source = await body(c, moveSource);
    return c.json(await transfer(() => prepareImport(ctx, householdId, source)), 201);
  });
  app.post("/households/:hid/server-move/export", bodyLimit({ maxSize: 4096 }), async (c) => {
    const householdId = param(c, "hid");
    await owner(c, householdId);
    limit(c);
    const input = await body(c, z.object({ ticket: moveTicket, phoneId: z.uuid().optional() }));
    return c.json(await transfer(() => exportMove(ctx, householdId, input.ticket, input.phoneId)), 201);
  });
  app.post("/households/:hid/server-move/import", bodyLimit({ maxSize: maxMoveBytes }), async (c) => {
    const householdId = param(c, "hid");
    await owner(c, householdId);
    limit(c);
    const { ticketId, bundle } = await body(c, z.object({ ticketId: z.uuid(), bundle: z.string().max(maxMoveBytes).min(10) }));
    return c.json({ phoneIds: await transfer(() => importMove(ctx, householdId, ticketId, bundle)) }, 201);
  });
  app.put("/phones/:pid/server-move/allow", bodyLimit({ maxSize: 1024 }), async (c) => {
    const phone = await access.requirePhone(c);
    const { allowed } = await body(c, z.object({ allowed: z.boolean() }));
    if (phone.profile === "self" && allowed && !phone.pairedAt) {
      throw new HTTPException(409, { message: "pair the phone before enabling moves" });
    }
    if (allowed && allowsServerMove(phone)) return c.json({ status: "applied" });
    return access.change(c, phone, { type: "move.allow", allowed });
  });
  app.post("/phones/:pid/server-move/start", bodyLimit({ maxSize: 1024 }), async (c) => {
    const phone = await access.requirePhone(c);
    await owner(c, phone.householdId);
    limit(c);
    const { exportId } = await body(c, z.object({ exportId: z.uuid() }));
    const [move] = await ctx.db.select({ url: phoneMoves.serverUrl }).from(phoneMoves).where(and(
      eq(phoneMoves.phoneId, phone.id), eq(phoneMoves.transferId, exportId), eq(phoneMoves.direction, "outgoing"),
      gt(phoneMoves.expiresAt, ctx.now()),
    ));
    if (!phone.pairedAt || !allowsServerMove(phone) || !move) {
      throw new HTTPException(409, { message: "allow moving this paired phone and use a current export" });
    }
    return access.change(c, phone, { type: "move.start", exportId, serverUrl: move.url });
  });
}
