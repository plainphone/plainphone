// SPDX-License-Identifier: Apache-2.0
//
// E2EE phase 0 prototype: the MLS delivery service (docs/e2ee-prototype.md). TEST DATA ONLY.
// With E2EE_PROTOTYPE_ENABLED off (the default, and forced off in production) every route
// answers 404 before it looks at the request.
//
// The server stores and orders ciphertext. It accepts one commit per conversation and epoch
// (409 for the loser), refuses texts for any other epoch (409), gives every recipient one total
// order (the delivery cursor) and never stores who sent an application message. It logs
// nothing about the content, the keys or the sizes. Clients do every cryptographic check.
import { and, asc, count, eq, exists, gt, inArray, isNotNull, isNull, lte, ne, notExists, or, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  e2eeDeliveries, e2eeDevices, e2eeGroupMembers, e2eeGroups, e2eeKeyPackages, e2eeMessages,
} from "../db/e2ee-schema.js";
import { householdMembers, phones } from "../db/schema.js";
import { body, param } from "../lib/http.js";
import { CIPHERSUITE, CONTENT, isKeyPackage, MlsWireError, parseMlsHeader, WIRE } from "../lib/mls-wire.js";
import { sha256 } from "../lib/crypto.js";
import { resolveSession } from "../services/auth.js";
import type { Ctx } from "../services/context.js";
import { DEVICE_PREFIX } from "./device.js";

/** Size limits in decoded bytes. */
export const E2EE_LIMITS = {
  keyPackage: 4096,
  commit: 65_536,
  welcome: 65_536,
  application: 8192,
  keyPackagesPerDevice: 50,
  devicesPerCaller: 5,
  members: 50,
  inboxPage: 200,
} as const;

type Phone = typeof phones.$inferSelect;
type Device = typeof e2eeDevices.$inferSelect;
type Caller = { kind: "phone"; phone: Phone } | { kind: "user"; userId: string };
type Env = { Variables: { caller: Caller } };

const b64 = (max: number) => z.string().regex(/^[A-Za-z0-9_-]+$/).max(Math.ceil((max * 4) / 3));

function decode(text: string, max: number, what: string): Uint8Array {
  const bytes = Buffer.from(text, "base64url");
  if (bytes.toString("base64url") !== text) throw new HTTPException(400, { message: `${what}: not canonical base64url` });
  if (bytes.length > max) throw new HTTPException(413, { message: `${what} too large` });
  return bytes;
}

const notFound = () => new HTTPException(404, { message: "not found" });

/** Device IDs are lowercase UUIDs, as the core requires (`roster.rs`). */
const deviceUuid = z.uuid().regex(/^[0-9a-f-]+$/, "lowercase UUID");

export function e2eeRoutes(ctx: Ctx) {
  const app = new Hono<Env>();

  /** Not revoked, and a child phone or the device of a parent who still belongs to the household. */
  const activeDevice = and(
    isNull(e2eeDevices.revokedAt),
    or(isNotNull(e2eeDevices.phoneId), exists(ctx.db.select({ one: sql`1` }).from(householdMembers).where(and(
      eq(householdMembers.householdId, e2eeDevices.householdId), eq(householdMembers.userId, e2eeDevices.userId),
    )))),
  );

  app.use("/*", async (c, next) => {
    if (!ctx.cfg.E2EE_PROTOTYPE_ENABLED) throw notFound();
    // Bearer only (native apps and the phone): no cookies, so no cross-site writes.
    const auth = c.req.header("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token.startsWith(DEVICE_PREFIX)) {
      const [phone] = await ctx.db.select().from(phones).where(eq(phones.deviceTokenHash, sha256(token)));
      if (!phone) throw new HTTPException(401, { message: "unknown device; pair again" });
      c.set("caller", { kind: "phone", phone });
    } else {
      const session = token ? await resolveSession(ctx, token) : null;
      if (!session) throw new HTTPException(401, { message: "sign in first" });
      c.set("caller", { kind: "user", userId: session.user.id });
    }
    await next();
  });

  async function isMember(householdId: string, userId: string) {
    const [m] = await ctx.db.select().from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));
    return Boolean(m);
  }

  /** The household the caller acts in: the phone's own, or one the parent belongs to. */
  async function householdOf(c: Context<Env>, householdId: string | undefined): Promise<string> {
    const caller = c.get("caller");
    if (caller.kind === "phone") return caller.phone.householdId;
    if (!householdId || !(await isMember(householdId, caller.userId))) throw notFound();
    return householdId;
  }

  /** An active MLS device that belongs to the caller. */
  async function ownDevice(c: Context<Env>, deviceId: string): Promise<Device> {
    const caller = c.get("caller");
    const [d] = await ctx.db.select().from(e2eeDevices).where(and(eq(e2eeDevices.id, deviceId), isNull(e2eeDevices.revokedAt)));
    if (!d) throw notFound();
    if (caller.kind === "phone" ? d.phoneId !== caller.phone.id : d.userId !== caller.userId) throw notFound();
    if (caller.kind === "user" && !(await isMember(d.householdId, caller.userId))) throw notFound();
    return d;
  }

  async function queryDevice(c: Context<Env>): Promise<Device> {
    const id = z.uuid().safeParse(c.req.query("deviceId"));
    if (!id.success) throw notFound();
    return ownDevice(c, id.data);
  }

  async function memberGroup(c: Context<Env>, device: Device) {
    const gid = param(c, "gid");
    const [g] = await ctx.db.select({ group: e2eeGroups }).from(e2eeGroups)
      .innerJoin(e2eeGroupMembers, eq(e2eeGroupMembers.groupId, e2eeGroups.id))
      .where(and(eq(e2eeGroups.id, gid), eq(e2eeGroupMembers.deviceId, device.id)));
    if (!g) throw notFound();
    return g.group;
  }

  function header(bytes: Uint8Array) {
    try {
      return parseMlsHeader(bytes);
    } catch (err) {
      if (err instanceof MlsWireError) throw new HTTPException(400, { message: `not an accepted MLS message: ${err.message}` });
      throw err;
    }
  }

  // --- Devices ------------------------------------------------------------------------------

  app.post("/devices", async (c) => {
    // The client picks its random device ID first: the MLS credential carries it.
    const input = await body(c, z.strictObject({ deviceId: deviceUuid, householdId: z.uuid().optional(), mlsSignPub: b64(32) }));
    if (decode(input.mlsSignPub, 32, "mlsSignPub").length !== 32) throw new HTTPException(400, { message: "mlsSignPub must be 32 bytes" });
    const caller = c.get("caller");
    const householdId = await householdOf(c, input.householdId);
    // The prototype covers parents and child phones; Self phones come later.
    if (caller.kind === "phone" && caller.phone.profile !== "child") throw notFound();
    const own = caller.kind === "phone" ? eq(e2eeDevices.phoneId, caller.phone.id) : eq(e2eeDevices.userId, caller.userId);
    const [{ n }] = await ctx.db.select({ n: count() }).from(e2eeDevices)
      .where(and(own, eq(e2eeDevices.householdId, householdId), isNull(e2eeDevices.revokedAt))) as [{ n: number }];
    if (n >= E2EE_LIMITS.devicesPerCaller) throw new HTTPException(409, { message: "too many devices" });
    const [d] = await ctx.db.insert(e2eeDevices).values({
      id: input.deviceId,
      householdId,
      userId: caller.kind === "user" ? caller.userId : null,
      phoneId: caller.kind === "phone" ? caller.phone.id : null,
      role: caller.kind === "phone" ? "child" : "admin",
      mlsSignPub: input.mlsSignPub,
    }).onConflictDoNothing().returning();
    if (!d) throw new HTTPException(409, { message: "device ID in use" });
    return c.json({ deviceId: d.id, role: d.role }, 201);
  });

  app.get("/devices", async (c) => {
    const caller = c.get("caller");
    if (caller.kind === "phone" && caller.phone.profile !== "child") throw notFound();
    const householdId = await householdOf(c, z.uuid().optional().catch(undefined).parse(c.req.query("householdId")));
    const rows = await ctx.db.select().from(e2eeDevices)
      .where(and(eq(e2eeDevices.householdId, householdId), isNull(e2eeDevices.revokedAt)))
      .orderBy(asc(e2eeDevices.createdAt));
    return c.json({
      devices: rows.map((d) => ({ deviceId: d.id, role: d.role, mlsSignPub: d.mlsSignPub })),
    });
  });

  /** A parent revokes any device of the household; a phone only its own. Delivery stops at once. */
  app.delete("/devices/:did", async (c) => {
    const did = param(c, "did");
    const caller = c.get("caller");
    const [d] = await ctx.db.select().from(e2eeDevices).where(and(eq(e2eeDevices.id, did), isNull(e2eeDevices.revokedAt)));
    if (!d) throw notFound();
    const allowed = caller.kind === "phone" ? d.phoneId === caller.phone.id : await isMember(d.householdId, caller.userId);
    if (!allowed) throw notFound();
    await ctx.db.transaction(async (tx) => {
      await tx.update(e2eeDevices).set({ revokedAt: ctx.now() }).where(eq(e2eeDevices.id, did));
      await tx.delete(e2eeKeyPackages).where(eq(e2eeKeyPackages.deviceId, did));
      await tx.delete(e2eeDeliveries).where(eq(e2eeDeliveries.deviceId, did));
    });
    return c.body(null, 204);
  });

  // --- Key packages -------------------------------------------------------------------------

  app.post("/key-packages", async (c) => {
    const input = await body(c, z.strictObject({
      deviceId: z.uuid(),
      keyPackages: z.array(b64(E2EE_LIMITS.keyPackage)).max(20).default([]),
      lastResort: b64(E2EE_LIMITS.keyPackage).optional(),
    }));
    const device = await ownDevice(c, input.deviceId);
    for (const kp of [...input.keyPackages, ...(input.lastResort ? [input.lastResort] : [])]) {
      if (!isKeyPackage(decode(kp, E2EE_LIMITS.keyPackage, "keyPackage"))) {
        throw new HTTPException(400, { message: `key packages must use cipher suite ${CIPHERSUITE}` });
      }
    }
    await ctx.db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: count() }).from(e2eeKeyPackages)
        .where(and(eq(e2eeKeyPackages.deviceId, device.id), eq(e2eeKeyPackages.lastResort, false))) as [{ n: number }];
      if (n + input.keyPackages.length > E2EE_LIMITS.keyPackagesPerDevice) throw new HTTPException(409, { message: "too many key packages" });
      if (input.keyPackages.length) {
        await tx.insert(e2eeKeyPackages).values(input.keyPackages.map((keyPackage) => ({ deviceId: device.id, keyPackage })));
      }
      if (input.lastResort) {
        await tx.delete(e2eeKeyPackages).where(and(eq(e2eeKeyPackages.deviceId, device.id), eq(e2eeKeyPackages.lastResort, true)));
        await tx.insert(e2eeKeyPackages).values({ deviceId: device.id, keyPackage: input.lastResort, lastResort: true });
      }
    });
    return c.json({ stored: input.keyPackages.length + (input.lastResort ? 1 : 0) }, 201);
  });

  /** An admin device claims one key package per target. A normal one is used up; the last resort is not. */
  app.post("/key-packages/claim", async (c) => {
    const input = await body(c, z.strictObject({ deviceId: z.uuid(), deviceIds: z.array(z.uuid()).min(1).max(10) }));
    const device = await ownDevice(c, input.deviceId);
    if (device.role !== "admin") throw new HTTPException(403, { message: "only a parent device adds members" });
    const targets = [...new Set(input.deviceIds)];
    const out = await ctx.db.transaction(async (tx) => {
      const found = await tx.select({ id: e2eeDevices.id }).from(e2eeDevices).where(and(
        inArray(e2eeDevices.id, targets), eq(e2eeDevices.householdId, device.householdId), isNull(e2eeDevices.revokedAt),
        ne(e2eeDevices.id, device.id),
      ));
      if (found.length !== targets.length) throw notFound();
      const claimed: { deviceId: string; keyPackage: string }[] = [];
      for (const target of targets) {
        // A normal package goes to one claimer (a concurrent claim skips it); the last resort is
        // shared, so it is read without a lock and never skipped.
        const [normal] = await tx.select().from(e2eeKeyPackages)
          .where(and(eq(e2eeKeyPackages.deviceId, target), eq(e2eeKeyPackages.lastResort, false)))
          .orderBy(asc(e2eeKeyPackages.createdAt)).limit(1).for("update", { skipLocked: true });
        const kp = normal ?? (await tx.select().from(e2eeKeyPackages)
          .where(and(eq(e2eeKeyPackages.deviceId, target), eq(e2eeKeyPackages.lastResort, true))).limit(1))[0];
        if (!kp) throw new HTTPException(409, { message: `no key package for ${target}` });
        if (!kp.lastResort) await tx.delete(e2eeKeyPackages).where(eq(e2eeKeyPackages.id, kp.id));
        claimed.push({ deviceId: target, keyPackage: kp.keyPackage });
      }
      return claimed;
    });
    return c.json({ keyPackages: out });
  });

  // --- Conversations ------------------------------------------------------------------------

  app.post("/groups", async (c) => {
    const input = await body(c, z.strictObject({ deviceId: z.uuid(), mlsGroupId: b64(64) }));
    const device = await ownDevice(c, input.deviceId);
    if (device.role !== "admin") throw new HTTPException(403, { message: "only a parent device starts a conversation" });
    const len = decode(input.mlsGroupId, 64, "mlsGroupId").length;
    if (len < 16) throw new HTTPException(400, { message: "mlsGroupId must be 16 to 64 random bytes" });
    const group = await ctx.db.transaction(async (tx) => {
      const [g] = await tx.insert(e2eeGroups).values({ householdId: device.householdId, mlsGroupId: input.mlsGroupId })
        .onConflictDoNothing().returning();
      if (!g) throw new HTTPException(409, { message: "conversation exists" });
      await tx.insert(e2eeGroupMembers).values({ groupId: g.id, deviceId: device.id });
      return g;
    });
    return c.json({ groupId: group.id, epoch: group.epoch }, 201);
  });

  /** The server's view: epoch and declared members. A client behind this epoch syncs before sending. */
  app.get("/groups/:gid", async (c) => {
    const device = await queryDevice(c);
    const group = await memberGroup(c, device);
    const members = await ctx.db.select({ id: e2eeGroupMembers.deviceId }).from(e2eeGroupMembers).where(eq(e2eeGroupMembers.groupId, group.id));
    return c.json({ groupId: group.id, epoch: group.epoch, members: members.map((m) => m.id).sort() });
  });

  async function fanOut(tx: Parameters<Parameters<typeof ctx.db.transaction>[0]>[0], groupId: string, kind: "welcome" | "commit" | "application", epoch: number, payload: string, to: string[]) {
    if (!to.length) return;
    // Revoked devices, and devices of parents who left the household, get nothing, even while
    // the group still lists them. The recipients' rows stay locked until the transaction ends,
    // taken in ID order so two fan-outs cannot deadlock. Two fan-outs to one device therefore
    // take its cursors in commit order: a device never sees cursor 11 while 10 is uncommitted.
    const active = await tx.select({ id: e2eeDevices.id }).from(e2eeDevices)
      .where(and(inArray(e2eeDevices.id, to), activeDevice))
      .orderBy(asc(e2eeDevices.id)).for("update", { of: e2eeDevices });
    const ids = active.map((d) => d.id);
    if (!ids.length) return;
    const [m] = await tx.insert(e2eeMessages).values({ groupId, kind, epoch, payload }).returning({ id: e2eeMessages.id });
    await tx.insert(e2eeDeliveries).values(ids.map((deviceId) => ({ deviceId, messageId: m!.id })));
  }

  app.post("/groups/:gid/commits", async (c) => {
    const input = await body(c, z.strictObject({
      deviceId: z.uuid(),
      commit: b64(E2EE_LIMITS.commit),
      welcome: b64(E2EE_LIMITS.welcome).optional(),
      members: z.array(z.uuid()).min(1).max(E2EE_LIMITS.members),
    }));
    const device = await ownDevice(c, input.deviceId);
    const group = await memberGroup(c, device);
    const h = header(decode(input.commit, E2EE_LIMITS.commit, "commit"));
    if (h.wireFormat !== WIRE.privateMessage || h.contentType !== CONTENT.commit) throw new HTTPException(400, { message: "not a commit" });
    if (Buffer.from(h.groupId).toString("base64url") !== group.mlsGroupId) throw new HTTPException(400, { message: "commit is for another conversation" });
    if (input.welcome) {
      const w = header(decode(input.welcome, E2EE_LIMITS.welcome, "welcome"));
      if (w.wireFormat !== WIRE.welcome || w.cipherSuite !== CIPHERSUITE) throw new HTTPException(400, { message: "not a welcome" });
    }
    const next = [...new Set(input.members)].sort();
    if (next.length !== input.members.length || !next.includes(device.id)) throw new HTTPException(400, { message: "members must be unique and include the sender" });
    const valid = await ctx.db.select({ id: e2eeDevices.id }).from(e2eeDevices)
      .where(and(inArray(e2eeDevices.id, next), eq(e2eeDevices.householdId, group.householdId), activeDevice));
    if (valid.length !== next.length) throw new HTTPException(400, { message: "members must be active devices of the household" });

    const epoch = await ctx.db.transaction(async (tx) => {
      // One commit per epoch: the row lock orders concurrent commits, the loser gets 409.
      const [locked] = await tx.select().from(e2eeGroups).where(eq(e2eeGroups.id, group.id)).for("update");
      if (h.epoch !== locked!.epoch) throw new HTTPException(409, { message: `conversation is at epoch ${locked!.epoch}` });
      const current = (await tx.select({ id: e2eeGroupMembers.deviceId }).from(e2eeGroupMembers)
        .where(eq(e2eeGroupMembers.groupId, group.id))).map((m) => m.id);
      const added = next.filter((d) => !current.includes(d));
      const removed = current.filter((d) => !next.includes(d));
      if ((added.length || removed.length) && device.role !== "admin") {
        throw new HTTPException(403, { message: "only a parent device adds or removes members" });
      }
      if (Boolean(added.length) !== Boolean(input.welcome)) throw new HTTPException(400, { message: "a welcome goes with added members, and only then" });
      // Removed members get the commit too, so they learn that they are out.
      await fanOut(tx, group.id, "commit", locked!.epoch, input.commit, current.filter((d) => d !== device.id));
      if (input.welcome) await fanOut(tx, group.id, "welcome", locked!.epoch + 1, input.welcome, added);
      await tx.update(e2eeGroups).set({ epoch: locked!.epoch + 1 }).where(eq(e2eeGroups.id, group.id));
      if (removed.length) {
        await tx.delete(e2eeGroupMembers).where(and(eq(e2eeGroupMembers.groupId, group.id), inArray(e2eeGroupMembers.deviceId, removed)));
      }
      if (added.length) await tx.insert(e2eeGroupMembers).values(added.map((deviceId) => ({ groupId: group.id, deviceId })));
      return locked!.epoch + 1;
    });
    return c.json({ epoch }, 201);
  });

  app.post("/groups/:gid/messages", async (c) => {
    const input = await body(c, z.strictObject({ deviceId: z.uuid(), message: b64(E2EE_LIMITS.application) }));
    const device = await ownDevice(c, input.deviceId);
    const group = await memberGroup(c, device);
    const h = header(decode(input.message, E2EE_LIMITS.application, "message"));
    if (h.wireFormat !== WIRE.privateMessage || h.contentType !== CONTENT.application) throw new HTTPException(400, { message: "not an application message" });
    if (Buffer.from(h.groupId).toString("base64url") !== group.mlsGroupId) throw new HTTPException(400, { message: "message is for another conversation" });
    await ctx.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(e2eeGroups).where(eq(e2eeGroups.id, group.id)).for("update");
      // A text from an older epoch is refused: the sender missed a commit (maybe a removal).
      if (h.epoch !== locked!.epoch) throw new HTTPException(409, { message: `conversation is at epoch ${locked!.epoch}` });
      const members = await tx.select({ id: e2eeGroupMembers.deviceId }).from(e2eeGroupMembers).where(eq(e2eeGroupMembers.groupId, group.id));
      await fanOut(tx, group.id, "application", locked!.epoch, input.message, members.map((m) => m.id).filter((d) => d !== device.id));
    });
    return c.json({}, 201);
  });

  // --- Inbox --------------------------------------------------------------------------------

  app.get("/inbox", async (c) => {
    const device = await queryDevice(c);
    const after = z.coerce.number().int().min(0).catch(0).parse(c.req.query("after") ?? 0);
    const rows = await ctx.db.select({
      cursor: e2eeDeliveries.cursor, groupId: e2eeMessages.groupId, kind: e2eeMessages.kind, epoch: e2eeMessages.epoch, payload: e2eeMessages.payload,
    }).from(e2eeDeliveries)
      .innerJoin(e2eeMessages, eq(e2eeMessages.id, e2eeDeliveries.messageId))
      .where(and(eq(e2eeDeliveries.deviceId, device.id), gt(e2eeDeliveries.cursor, after)))
      .orderBy(asc(e2eeDeliveries.cursor))
      .limit(E2EE_LIMITS.inboxPage);
    return c.json({ items: rows });
  });

  /** Delivered items are deleted, and so is every message nobody still has to fetch. */
  app.post("/inbox/ack", async (c) => {
    const input = await body(c, z.strictObject({ deviceId: z.uuid(), upTo: z.number().int().min(1) }));
    const device = await ownDevice(c, input.deviceId);
    await ctx.db.transaction(async (tx) => {
      const gone = await tx.delete(e2eeDeliveries)
        .where(and(eq(e2eeDeliveries.deviceId, device.id), lte(e2eeDeliveries.cursor, input.upTo)))
        .returning({ messageId: e2eeDeliveries.messageId });
      const ids = [...new Set(gone.map((g) => g.messageId))];
      if (ids.length) {
        await tx.delete(e2eeMessages).where(and(
          inArray(e2eeMessages.id, ids),
          notExists(tx.select({ one: sql`1` }).from(e2eeDeliveries).where(eq(e2eeDeliveries.messageId, e2eeMessages.id))),
        ));
      }
    });
    return c.body(null, 204);
  });

  return app;
}
