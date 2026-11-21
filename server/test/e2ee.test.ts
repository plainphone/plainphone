// SPDX-License-Identifier: Apache-2.0
//
// E2EE phase 0 prototype: the delivery-service routes (docs/e2ee-prototype.md). The server
// only reads the clear MLS framing, so these tests build that framing by hand; real MLS bytes
// go through the same routes in scripts/e2ee-prototype-demo.sh and the parser's vectors.
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { isKeyPackage, parseMlsHeader } from "../src/lib/mls-wire.js";
import { type Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const vec = (b: Uint8Array) => {
  if (b.length < 64) return Buffer.concat([Buffer.from([b.length]), b]);
  return Buffer.concat([Buffer.from([0x40 | (b.length >> 8), b.length & 0xff]), b]);
};
const u16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
const u64 = (n: number) => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(BigInt(n));
  return out;
};

/** The clear framing of a PrivateMessage with opaque (random) encrypted parts. */
function privateMessage(groupId: Uint8Array, epoch: number, contentType: number, size = 100): string {
  return b64(Buffer.concat([u16(1), u16(2), vec(groupId), u64(epoch), Buffer.from([contentType]), vec(Buffer.alloc(0)), vec(randomBytes(20)), vec(randomBytes(size))]));
}
const welcome = () => b64(Buffer.concat([u16(1), u16(3), u16(1), vec(randomBytes(60)), vec(randomBytes(200))]));
const keyPackage = () => b64(Buffer.concat([u16(1), u16(1), vec(randomBytes(32)), randomBytes(150)]));

async function household() {
  const mum = await signIn(h, "mum@example.org");
  const { device: phone } = await pairPhone(h, mum, { name: "Test child" });
  const hid = (await mum.get("/api/me")).json.households[0].id as string;
  await mum.post(`/api/households/${hid}/invites`, { email: "dad@example.org" });
  const token = decodeURIComponent(/invite#token=(\S+)/.exec(h.mail.outbox.at(-1)!.text)![1]!);
  const dad = await signIn(h, "dad@example.org");
  await dad.post("/api/invites/accept", { token });
  const register = async (c: Client, householdId?: string) => {
    const r = await c.post("/api/e2ee/devices", { deviceId: randomUUID(), householdId, mlsSignPub: b64(randomBytes(32)) });
    expect(r.status).toBe(201);
    return r.json.deviceId as string;
  };
  const ids = { mum: await register(mum, hid), dad: await register(dad, hid), child: await register(phone) };
  return { mum, dad, phone, hid, ids };
}

async function conversation() {
  const hh = await household();
  const { mum, dad, phone, ids } = hh;
  for (const [c, id] of [[dad, ids.dad], [phone, ids.child]] as const) {
    expect((await c.post("/api/e2ee/key-packages", { deviceId: id, keyPackages: [keyPackage()], lastResort: keyPackage() })).status).toBe(201);
  }
  const mlsGroupId = randomBytes(16);
  const g = await mum.post("/api/e2ee/groups", { deviceId: ids.mum, mlsGroupId: b64(mlsGroupId) });
  expect(g.status).toBe(201);
  const gid = g.json.groupId as string;
  const claim = await mum.post("/api/e2ee/key-packages/claim", { deviceId: ids.mum, deviceIds: [ids.dad, ids.child] });
  expect(claim.status).toBe(200);
  const add = await mum.post(`/api/e2ee/groups/${gid}/commits`, {
    deviceId: ids.mum, commit: privateMessage(mlsGroupId, 0, 3), welcome: welcome(), members: [ids.mum, ids.dad, ids.child],
  });
  expect(add.status).toBe(201);
  expect(add.json.epoch).toBe(1);
  return { ...hh, gid, mlsGroupId };
}

const inbox = async (c: Client, deviceId: string) => (await c.get(`/api/e2ee/inbox?deviceId=${deviceId}`)).json.items as { cursor: number; kind: string; epoch: number; payload: string }[];

describe("E2EE prototype switch", () => {
  it("answers 404 on every route while E2EE_PROTOTYPE_ENABLED is off, before any auth", async () => {
    const mum = await signIn(h, "mum@example.org");
    for (const [method, path] of [["POST", "/api/e2ee/devices"], ["GET", "/api/e2ee/devices"], ["GET", "/api/e2ee/inbox"], ["POST", "/api/e2ee/key-packages/claim"]]) {
      expect((await mum.call(method!, path!, method === "POST" ? {} : undefined)).status).toBe(404);
      expect((await h.app.request(path!, { method })).status).toBe(404);
    }
  });

  it("stays off in production even when switched on", () => {
    const cfg = loadConfig({ DATABASE_URL: "unused", NODE_ENV: "production", E2EE_PROTOTYPE_ENABLED: "true" });
    expect(cfg.E2EE_PROTOTYPE_ENABLED).toBe(false);
    expect(cfg.configWarnings.other).toContain("e2ee: E2EE_PROTOTYPE_ENABLED is not allowed in production");
    expect(loadConfig({ DATABASE_URL: "unused", NODE_ENV: "development", E2EE_PROTOTYPE_ENABLED: "true" }).E2EE_PROTOTYPE_ENABLED).toBe(true);
    expect(loadConfig({ DATABASE_URL: "unused" }).E2EE_PROTOTYPE_ENABLED).toBe(false);
  });
});

describe("E2EE prototype delivery service", () => {
  beforeEach(() => {
    h.ctx.cfg.E2EE_PROTOTYPE_ENABLED = true;
  });

  it("registers parents as admins and the child phone as child, and lists the household's devices", async () => {
    const { mum, phone, ids } = await household();
    const list = await phone.get("/api/e2ee/devices");
    expect(list.json.devices.map((d: { deviceId: string; role: string }) => [d.deviceId, d.role]).sort()).toEqual(
      [[ids.mum, "admin"], [ids.dad, "admin"], [ids.child, "child"]].sort(),
    );
    const stranger = await signIn(h, "stranger@example.org");
    const hid = (await mum.get("/api/me")).json.households[0].id;
    expect((await stranger.get(`/api/e2ee/devices?householdId=${hid}`)).status).toBe(404);
    expect((await stranger.post("/api/e2ee/devices", { deviceId: randomUUID(), householdId: hid, mlsSignPub: b64(randomBytes(32)) })).status).toBe(404);
    expect((await mum.post("/api/e2ee/devices", { deviceId: randomUUID(), householdId: hid, mlsSignPub: "not+base64" })).status).toBe(400);
  });

  it("hands out each key package once and keeps the last resort", async () => {
    const { mum, phone, ids } = await household();
    await phone.post("/api/e2ee/key-packages", { deviceId: ids.child, keyPackages: [keyPackage()], lastResort: keyPackage() });
    const first = await mum.post("/api/e2ee/key-packages/claim", { deviceId: ids.mum, deviceIds: [ids.child] });
    const second = await mum.post("/api/e2ee/key-packages/claim", { deviceId: ids.mum, deviceIds: [ids.child] });
    const third = await mum.post("/api/e2ee/key-packages/claim", { deviceId: ids.mum, deviceIds: [ids.child] });
    expect(first.json.keyPackages[0].keyPackage).not.toBe(second.json.keyPackages[0].keyPackage);
    expect(third.json.keyPackages[0].keyPackage).toBe(second.json.keyPackages[0].keyPackage);
    // The child phone never adds anyone, and the server refuses what is not a key package.
    expect((await phone.post("/api/e2ee/key-packages/claim", { deviceId: ids.child, deviceIds: [ids.mum] })).status).toBe(403);
    expect((await phone.post("/api/e2ee/key-packages", { deviceId: ids.child, keyPackages: [b64(randomBytes(80))] })).status).toBe(400);
    expect((await mum.post("/api/e2ee/key-packages/claim", { deviceId: ids.mum, deviceIds: [ids.dad] })).status).toBe(409);
  });

  it("fans out commits, welcomes and texts in one order per recipient, never back to the sender", async () => {
    const { mum, dad, phone, ids, gid, mlsGroupId } = await conversation();
    expect((await inbox(dad, ids.dad)).map((i) => i.kind)).toEqual(["welcome"]);
    const text = privateMessage(mlsGroupId, 1, 1);
    expect((await phone.post(`/api/e2ee/groups/${gid}/messages`, { deviceId: ids.child, message: text })).status).toBe(201);
    const items = await inbox(dad, ids.dad);
    expect(items.map((i) => [i.kind, i.epoch])).toEqual([["welcome", 1], ["application", 1]]);
    expect(items[1]!.payload).toBe(text);
    expect(items[0]!.cursor).toBeLessThan(items[1]!.cursor);
    expect(await inbox(phone, ids.child)).toHaveLength(1);
    expect((await inbox(mum, ids.mum)).map((i) => i.kind)).toEqual(["application"]);
    const view = await phone.get(`/api/e2ee/groups/${gid}?deviceId=${ids.child}`);
    expect(view.json).toEqual({ groupId: gid, epoch: 1, members: [ids.mum, ids.dad, ids.child].sort() });
  });

  it("accepts one commit per epoch and refuses texts for any other epoch", async () => {
    const { mum, dad, phone, ids, gid, mlsGroupId } = await conversation();
    const members = [ids.mum, ids.dad, ids.child];
    const a = await mum.post(`/api/e2ee/groups/${gid}/commits`, { deviceId: ids.mum, commit: privateMessage(mlsGroupId, 1, 3), members });
    const b = await dad.post(`/api/e2ee/groups/${gid}/commits`, { deviceId: ids.dad, commit: privateMessage(mlsGroupId, 1, 3), members });
    expect([a.status, b.status]).toEqual([201, 409]);
    expect(b.json.error).toContain("epoch 2");
    // A sender that missed the commit (maybe a removal) cannot send in the old epoch.
    expect((await phone.post(`/api/e2ee/groups/${gid}/messages`, { deviceId: ids.child, message: privateMessage(mlsGroupId, 1, 1) })).status).toBe(409);
    expect((await phone.post(`/api/e2ee/groups/${gid}/messages`, { deviceId: ids.child, message: privateMessage(mlsGroupId, 2, 1) })).status).toBe(201);
    // A key rotation by the child (same members) is fine; adding or removing is not.
    expect((await phone.post(`/api/e2ee/groups/${gid}/commits`, { deviceId: ids.child, commit: privateMessage(mlsGroupId, 2, 3), members })).status).toBe(201);
    expect((await phone.post(`/api/e2ee/groups/${gid}/commits`, { deviceId: ids.child, commit: privateMessage(mlsGroupId, 3, 3), members: [ids.mum, ids.child] })).status).toBe(403);
  });

  it("refuses messages for another conversation, of the wrong type, or too large", async () => {
    const { phone, ids, gid, mlsGroupId } = await conversation();
    const post = (message: string) => phone.post(`/api/e2ee/groups/${gid}/messages`, { deviceId: ids.child, message });
    expect((await post(privateMessage(randomBytes(16), 1, 1))).status).toBe(400);
    expect((await post(privateMessage(mlsGroupId, 1, 3))).status).toBe(400);
    expect((await post(privateMessage(mlsGroupId, 1, 2))).status).toBe(400);
    expect((await post(b64(randomBytes(64)))).status).toBe(400);
    expect((await post(privateMessage(mlsGroupId, 1, 1, 9000))).status).toBe(400);
  });

  it("removes a member: it gets the commit, then nothing more", async () => {
    const { mum, dad, ids, gid, mlsGroupId } = await conversation();
    await dad.post("/api/e2ee/inbox/ack", { deviceId: ids.dad, upTo: (await inbox(dad, ids.dad)).at(-1)!.cursor });
    const r = await mum.post(`/api/e2ee/groups/${gid}/commits`, { deviceId: ids.mum, commit: privateMessage(mlsGroupId, 1, 3), members: [ids.mum, ids.child] });
    expect(r.status).toBe(201);
    expect((await inbox(dad, ids.dad)).map((i) => i.kind)).toEqual(["commit"]);
    await mum.post(`/api/e2ee/groups/${gid}/messages`, { deviceId: ids.mum, message: privateMessage(mlsGroupId, 2, 1) });
    expect((await inbox(dad, ids.dad)).map((i) => i.kind)).toEqual(["commit"]);
    expect((await dad.post(`/api/e2ee/groups/${gid}/messages`, { deviceId: ids.dad, message: privateMessage(mlsGroupId, 2, 1) })).status).toBe(404);
  });

  it("stops delivery to a revoked device at once and deletes what was waiting", async () => {
    const { mum, phone, ids, gid, mlsGroupId } = await conversation();
    expect((await mum.del(`/api/e2ee/devices/${ids.child}`)).status).toBe(204);
    expect((await phone.get(`/api/e2ee/inbox?deviceId=${ids.child}`)).status).toBe(404);
    await mum.post(`/api/e2ee/groups/${gid}/messages`, { deviceId: ids.mum, message: privateMessage(mlsGroupId, 1, 1) });
    const rows = await h.ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from e2ee_deliveries where device_id = ${ids.child}`);
    expect(rows[0]!.n).toBe(0);
  });

  it("deletes delivered messages once every recipient has acknowledged them", async () => {
    const { mum, dad, phone, ids, gid, mlsGroupId } = await conversation();
    await mum.post(`/api/e2ee/groups/${gid}/messages`, { deviceId: ids.mum, message: privateMessage(mlsGroupId, 1, 1) });
    const count = async () => (await h.ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from e2ee_messages`))[0]!.n;
    expect(await count()).toBe(2);
    for (const [c, id] of [[dad, ids.dad], [phone, ids.child]] as const) {
      const items = await inbox(c, id);
      expect((await c.post("/api/e2ee/inbox/ack", { deviceId: id, upTo: items.at(-1)!.cursor })).status).toBe(204);
    }
    expect(await count()).toBe(0);
    expect(await inbox(dad, ids.dad)).toEqual([]);
  });
});

describe("MLS clear framing", () => {
  const vectors = JSON.parse(readFileSync(new URL("../../docs/encryption-test-vectors/mls-prototype.json", import.meta.url), "utf8"));

  it("reads wire format, group ID, epoch and content type from real OpenMLS output", () => {
    for (const v of vectors.wire) {
      const parsed = parseMlsHeader(Buffer.from(v.message, "base64url"));
      expect(parsed.wireFormat, v.name).toBe(v.wireFormat);
      if (parsed.wireFormat === 2) {
        expect([b64(parsed.groupId), parsed.epoch, parsed.contentType], v.name).toEqual([v.groupId, v.epoch, v.contentType]);
      } else {
        expect(parsed.cipherSuite, v.name).toBe(v.cipherSuite);
      }
    }
    for (const kp of vectors.keyPackages) expect(isKeyPackage(Buffer.from(kp.keyPackage, "base64url")), kp.name).toBe(true);
  });

  it("rejects truncated, trailing, non-minimal and foreign framing", () => {
    for (const v of vectors.wireRejections) {
      expect(() => parseMlsHeader(Buffer.from(v.message, "base64url")), v.name).toThrow();
    }
  });
});
