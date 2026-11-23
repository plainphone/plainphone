// SPDX-License-Identifier: Apache-2.0
import { and, eq } from "drizzle-orm";
import { exportPKCS8, generateKeyPair } from "jose";
import { expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { contacts, dnsSettings, moveIdentity, phones, phoneSettings, schedules, selfKeys } from "../src/db/schema.js";
import { randomToken } from "../src/lib/crypto.js";
import { portablePolicy, readMovePolicy } from "../src/services/move-policy.js";
import { sweep } from "../src/services/sweeper.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();
const destinationUrl = "https://new.example.test:8443";

async function servers() {
  const parent = await signIn(h, "source@example.org");
  const sourceHousehold = (await parent.get("/api/me")).json.households[0].id;
  // The harness shares Postgres, but distinct households, app contexts and URL/DNS
  // settings test the transfer boundary without letting either access the other's routes.
  const cfg = { ...h.ctx.cfg, PUBLIC_URL: destinationUrl, DNS_HOST_SUFFIX: "filter.example.test", DNS_PROVIDER: "http" as const, PROVISIONING_DNS_HOST: "family.example.test" };
  const ctx = { ...h.ctx, cfg };
  const destination = { ...h, ctx, app: createApp(ctx) };
  const newParent = await signIn(destination, "destination@example.org");
  const destinationHousehold = (await newParent.get("/api/me")).json.households[0].id;
  const sourcePath = `/api/households/${sourceHousehold}/server-move`;
  const destinationPath = `/api/households/${destinationHousehold}/server-move`;
  return { parent, newParent, destination, sourcePath, destinationPath };
}

async function invitation(s: Awaited<ReturnType<typeof servers>>) {
  const source = await s.parent.get(s.sourcePath + "/source");
  expect(source.status).toBe(200);
  const response = await s.newParent.post(s.destinationPath + "/prepare", source.json);
  expect(response.status).toBe(201);
  return response.json;
}

async function exportPhone(s: Awaited<ReturnType<typeof servers>>, phoneId: string) {
  const ticket = await invitation(s);
  const output = await s.parent.post(s.sourcePath + "/export", { ticket, phoneId });
  expect(output.status).toBe(201);
  return { ticketId: ticket.id, bundle: output.json.bundle, exportId: output.json.exportId };
}

it("copies settings for the whole household and refuses a modified, expired or replayed bundle", async () => {
  const s = await servers();
  const first = await pairPhone(h, s.parent, { name: "Test phone A" });
  const second = await pairPhone(h, s.parent, { name: "Test phone B", mode: "light" });
  await first.device.get("/api/device/rules");
  await second.device.get("/api/device/rules");
  await h.ctx.db.insert(contacts).values({ phoneId: first.phoneId, name: "Example contact", number: "+15550100001" });
  await h.ctx.db.insert(schedules).values({
    phoneId: first.phoneId, kind: "school", days: [1, 3], startMinute: 480, endMinute: 840, allowedPackages: [],
  });
  await h.ctx.db.insert(phoneSettings).values({ phoneId: first.phoneId, settings: { camera: { mode: "locked", value: "off" } } });
  await h.ctx.db.update(dnsSettings).set({ blockDomains: ["blocked.example"] }).where(eq(dnsSettings.phoneId, first.phoneId));
  const ticket = await invitation(s);
  const out = await s.parent.post(s.sourcePath + "/export", { ticket });
  expect(out.status).toBe(201);
  expect(out.json.phoneIds).toHaveLength(2);
  const bundle: string = out.json.bundle;
  expect(bundle).not.toContain("Example contact");
  const segments = bundle.split(".");
  segments[3] = (segments[3]![0] === "a" ? "b" : "a") + segments[3]!.slice(1);
  const importPath = s.destinationPath + "/import";
  expect((await s.newParent.post(importPath, { ticketId: ticket.id, bundle: segments.join(".") })).status).toBe(400);
  const forgedKey = await generateKeyPair("EdDSA", { extractable: true });
  const [oldIdentity] = await h.ctx.db.select().from(moveIdentity);
  await h.ctx.db.update(moveIdentity).set({ privateKey: await exportPKCS8(forgedKey.privateKey) });
  const wrongSigner = await s.parent.post(s.sourcePath + "/export", { ticket });
  expect(wrongSigner.status).toBe(201);
  expect((await s.newParent.post(importPath, { ticketId: ticket.id, bundle: wrongSigner.json.bundle })).status).toBe(400);
  await h.ctx.db.update(moveIdentity).set({ privateKey: oldIdentity!.privateKey });
  const imported = await s.newParent.post(importPath, { ticketId: ticket.id, bundle });
  expect(imported.status).toBe(201);
  expect(imported.json.phoneIds).toHaveLength(2);
  const summary = (await s.newParent.get("/api/phones")).json.phones;
  expect(summary).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "Test phone A", awaitingServerMove: true, setupQrAvailable: false }),
    expect.objectContaining({ name: "Test phone B", mode: "light", awaitingServerMove: true }),
  ]));
  const id: string = summary.find((phone: { name: string }) => phone.name === "Test phone A").id;
  expect((await s.newParent.post(`/api/phones/${id}/enrollment`)).status).toBe(409);
  expect((await h.ctx.db.select().from(contacts).where(eq(contacts.phoneId, id)))[0]?.name).toBe("Example contact");
  expect((await h.ctx.db.select().from(schedules).where(eq(schedules.phoneId, id)))[0]?.days).toEqual([1, 3]);
  expect((await h.ctx.db.select().from(phoneSettings).where(eq(phoneSettings.phoneId, id)))[0]?.settings.camera)
    .toEqual({ mode: "locked", value: "off" });
  expect((await h.ctx.db.select().from(dnsSettings).where(eq(dnsSettings.phoneId, id)))[0]?.blockDomains)
    .toEqual(["blocked.example"]);
  expect((await s.newParent.post(importPath, { ticketId: ticket.id, bundle })).status).toBe(410);
  const expired = await exportPhone(s, first.phoneId);
  h.clock.advance(8 * 24 * 60 * 60_000);
  expect((await s.newParent.post(importPath, expired)).status).toBe(410);
});

it("consumes a token once, keeps the old pairing during an outage, and provisions new filter rules", async () => {
  const s = await servers();
  const { device, phoneId } = await pairPhone(h, s.parent);
  const original = await device.get("/api/device/rules");
  expect(original.json.allowServerMove).toBe(true);
  const transfer = await exportPhone(s, phoneId);
  const start = `/api/phones/${phoneId}/server-move/start`;
  expect((await s.parent.post(start, { exportId: transfer.exportId })).status).toBe(200);
  const instruction = (await device.get("/api/device/rules")).json.move;
  expect(instruction.serverUrl).toBe(destinationUrl);
  const first = new Client(s.destination);
  first.token = randomToken("pp_d_");
  const endpoint = "/api/device/move";
  const redeem = { token: instruction.token, deviceToken: first.token };
  expect((await first.post(endpoint, redeem)).status).toBe(410);
  expect((await device.get("/api/device/rules")).json.dns.host).toBe(original.json.dns.host);
  const imported = await s.newParent.post(s.destinationPath + "/import", transfer);
  expect(imported.status).toBe(201);
  const importedId = imported.json.phoneIds[0] as string;
  await h.ctx.db.update(phones).set({ dnsDirty: true }).where(eq(phones.id, importedId));
  expect((await first.post(endpoint, redeem)).status).toBe(503);
  await h.ctx.db.update(phones).set({ dnsDirty: false }).where(eq(phones.id, importedId));
  expect((await first.post(endpoint, redeem)).status).toBe(204);
  const preview = await first.get("/api/device/move-rules");
  expect(preview.json.dns).toMatchObject({ ready: true, blockedCategories: original.json.dns.blockedCategories });
  expect(preview.json.dns.host).toMatch(/\.filter\.example\.test$/);
  // The phone falls back to this host, never to its per-phone host, if it is later removed.
  expect(preview.json.fallbackDnsHost).toBe("family.example.test");
  expect(original.json.fallbackDnsHost).not.toBe("family.example.test");
  const second = new Client(s.destination);
  second.token = randomToken("pp_d_");
  expect((await second.post(endpoint, { token: instruction.token, deviceToken: second.token })).status).toBe(410);
  expect((await second.get("/api/device/rules")).status).toBe(401);
  expect((await first.post(endpoint, redeem)).status).toBe(410);
  expect((await first.get("/api/device/rules")).status).toBe(200);
  expect((await s.newParent.get(`/api/phones/${importedId}`)).json.awaitingServerMove).toBe(false);
});

it("checks the per-phone switch and the Myself key before issuing a move", async () => {
  const s = await servers();
  const { device, phoneId } = await pairPhone(h, s.parent, { profile: "self" });
  const path = `/api/phones/${phoneId}/server-move`;
  expect((await device.get("/api/device/rules")).json.allowServerMove).toBe(false);
  expect((await s.parent.put(path + "/allow", { allowed: true })).status).toBe(202);
  expect((await device.get("/api/device/rules")).json.allowServerMove).toBe(false);
  h.clock.advance(24 * 60 * 60_000);
  expect((await device.get("/api/device/rules")).json.allowServerMove).toBe(true);
  const transfer = await exportPhone(s, phoneId);
  expect((await s.parent.post(path + "/start", { exportId: transfer.exportId })).status).toBe(202);
  expect((await device.get("/api/device/rules")).json.move).toBeUndefined();
  h.clock.advance(24 * 60 * 60_000);
  expect((await device.get("/api/device/rules")).json.move.serverUrl).toBe(destinationUrl);
  expect((await s.parent.put(path + "/allow", { allowed: false })).status).toBe(200);
  expect((await device.get("/api/device/rules")).json).toMatchObject({ allowServerMove: false });
  expect((await device.get("/api/device/rules")).json.move).toBeUndefined();
  const [phone] = await h.ctx.db.select().from(phones).where(and(eq(phones.id, phoneId), eq(phones.allowServerMove, false)));
  expect(phone).toBeDefined();
});


it("requires the separate trusted helper to approve a Myself move", async () => {
  const s = await servers();
  const helper = await signIn(h, "helper@example.org");
  const helperId = (await helper.get("/api/me")).json.user.id;
  const { device, phoneId } = await pairPhone(h, s.parent, { profile: "self" });
  await device.get("/api/device/rules");
  await h.ctx.db.update(phones).set({ allowServerMove: true }).where(eq(phones.id, phoneId));
  await h.ctx.db.update(selfKeys).set({ keyType: "trusted", trustedUserId: helperId })
    .where(eq(selfKeys.phoneId, phoneId));
  const transfer = await exportPhone(s, phoneId);
  const result = await s.parent.post(`/api/phones/${phoneId}/server-move/start`, { exportId: transfer.exportId });
  expect(result.status).toBe(202);
  expect(result.json.change.keyType).toBe("trusted");
  const changeId = result.json.change.id;
  const route = `/api/changes/${changeId}/approve`;
  const preview = (await helper.get("/api/approvals")).json.approvals.find((item: { id: string }) => item.id === changeId);
  expect(preview.summary.en).toContain(destinationUrl);
  expect((await s.parent.post(route, { revision: preview.revision })).status).toBe(404);
  expect((await device.get("/api/device/rules")).json.move).toBeUndefined();
  expect((await helper.post(route, { revision: preview.revision })).status).toBe(204);
  expect((await device.get("/api/device/rules")).json.move.serverUrl).toBe(destinationUrl);
});

it("frees an imported phone for normal setup when its move expires unused", async () => {
  const s = await servers();
  const { phoneId } = await pairPhone(h, s.parent);
  const transfer = await exportPhone(s, phoneId);
  const imported = await s.newParent.post(s.destinationPath + "/import", transfer);
  const importedId = imported.json.phoneIds[0] as string;
  expect((await s.newParent.post(`/api/phones/${importedId}/enrollment`)).status).toBe(409);
  h.clock.advance(8 * 24 * 60 * 60_000);
  await sweep(h.ctx);
  expect((await s.newParent.get(`/api/phones/${importedId}`)).json.awaitingServerMove).toBe(false);
  expect((await s.newParent.post(`/api/phones/${importedId}/enrollment`)).status).not.toBe(409);
});

it("carries the Private DNS filter method across a move", async () => {
  const s = await servers();
  const { device, phoneId } = await pairPhone(h, s.parent, { mode: "light" });
  await h.ctx.db.update(phones).set({ filterMethod: "privateDns" }).where(eq(phones.id, phoneId));
  const original = await device.get("/api/device/rules");
  expect(original.json.dns.filterMethod).toBe("privateDns");
  const transfer = await exportPhone(s, phoneId);
  expect((await s.parent.post(`/api/phones/${phoneId}/server-move/start`, { exportId: transfer.exportId })).status).toBe(200);
  const instruction = (await device.get("/api/device/rules")).json.move;
  const imported = await s.newParent.post(s.destinationPath + "/import", transfer);
  const importedId = imported.json.phoneIds[0] as string;
  expect((await h.ctx.db.select().from(phones).where(eq(phones.id, importedId)))[0]?.filterMethod).toBe("privateDns");
  const moved = new Client(s.destination);
  moved.token = randomToken("pp_d_");
  expect((await moved.post("/api/device/move", { token: instruction.token, deviceToken: moved.token })).status).toBe(204);
  expect((await moved.get("/api/device/move-rules")).json.dns.filterMethod).toBe("privateDns");
});

it("refuses imported values the normal endpoints would reject", async () => {
  const s = await servers();
  const { phoneId } = await pairPhone(h, s.parent);
  await h.ctx.db.update(phones).set({ name: "x".repeat(41) }).where(eq(phones.id, phoneId));
  const longName = await exportPhone(s, phoneId);
  expect((await s.newParent.post(s.destinationPath + "/import", longName)).status).toBe(400);
  const mine = await pairPhone(h, s.parent, { profile: "self", name: "Mine" });
  await mine.device.get("/api/device/rules");
  const [row] = await h.ctx.db.select().from(phones).where(eq(phones.id, mine.phoneId));
  const policy = await readMovePolicy(h.ctx.db, row!, h.ctx.now());
  expect(portablePolicy.safeParse(policy).success).toBe(true);
  const key = policy.key!;
  const bad = [
    { ...policy, key: { ...key, delayHours: 100 } },
    { ...policy, key: { ...key, payUnlockRecipient: "someone-else" } },
    { ...policy, key: { ...key, payUnlockAmount: 1 } },
    { ...policy, key: { ...key, payUnlockCurrency: "dkk and more" } },
    { ...policy, contacts: [{ name: "x", number: "not a number" }] },
    { ...policy, contacts: [{ name: "x".repeat(61), number: "+15550100001" }] },
    { ...policy, apps: [{ packageName: "bad package", label: "x", allowed: true, core: false, explicitlyBlocked: false, installed: true, requested: false }] },
    { ...policy, dns: { ...policy.dns, blockDomains: ["not a domain"] } },
    { ...policy, filterMethod: "other" },
    { ...policy, bonuses: [{ packageName: "*", day: "2030-01-01", minutes: 1440 }] },
  ];
  for (const candidate of bad) expect(portablePolicy.safeParse(candidate).success).toBe(false);
});

it("frees a phone whose move was redeemed but never activated", async () => {
  const s = await servers();
  const { phoneId } = await pairPhone(h, s.parent);
  const transfer = await exportPhone(s, phoneId);
  const imported = await s.newParent.post(s.destinationPath + "/import", transfer);
  const importedId = imported.json.phoneIds[0] as string;
  await h.ctx.db.update(phones).set({ deviceTokenHash: "a".repeat(64) }).where(eq(phones.id, importedId));
  h.clock.advance(8 * 24 * 60 * 60_000);
  await sweep(h.ctx);
  const [row] = await h.ctx.db.select().from(phones).where(eq(phones.id, importedId));
  expect(row).toMatchObject({ awaitingServerMove: false, deviceTokenHash: null });
  const summary = (await s.newParent.get(`/api/phones/${importedId}`)).json;
  expect(summary.setupQrAvailable).toBe(true);
  expect((await s.newParent.post(`/api/phones/${importedId}/enrollment`)).status).toBe(201);
});

it("moves a Myself phone whose trusted key is still a pending QR invitation", async () => {
  const s = await servers();
  const { device, phoneId } = await pairPhone(h, s.parent, { profile: "self", name: "Mine" });
  await device.get("/api/device/rules");
  await h.ctx.db.update(selfKeys).set({ keyType: "trusted", trustedEmail: null, trustedUserId: null })
    .where(eq(selfKeys.phoneId, phoneId));
  const [row] = await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId));
  const policy = await readMovePolicy(h.ctx.db, row!, h.ctx.now());
  expect(policy.key).toMatchObject({ keyType: "trusted", trustedEmail: null, qrInvite: true });
  const transfer = await exportPhone(s, phoneId);
  const imported = await s.newParent.post(s.destinationPath + "/import", transfer);
  expect(imported.status).toBe(201);
  const [key] = await h.ctx.db.select().from(selfKeys).where(eq(selfKeys.phoneId, imported.json.phoneIds[0]));
  expect(key).toMatchObject({ keyType: "trusted", trustedEmail: null, trustedUserId: null });
});

it("keeps a redeemed phone that syncs just after the move expired, and frees one that never does", async () => {
  const s = await servers();
  const { device, phoneId } = await pairPhone(h, s.parent);
  await device.get("/api/device/rules");
  const transfer = await exportPhone(s, phoneId);
  expect((await s.parent.post(`/api/phones/${phoneId}/server-move/start`, { exportId: transfer.exportId })).status).toBe(200);
  const instruction = (await device.get("/api/device/rules")).json.move;
  const imported = await s.newParent.post(s.destinationPath + "/import", transfer);
  const importedId = imported.json.phoneIds[0] as string;
  // Redeem a minute before the invitation expires, then lose the network until after it.
  h.clock.advance(7 * 24 * 60 * 60_000 - 60_000);
  const moved = new Client(s.destination);
  moved.token = randomToken("pp_d_");
  expect((await moved.post("/api/device/move", { token: instruction.token, deviceToken: moved.token })).status).toBe(204);
  h.clock.advance(60 * 60_000);
  await sweep(h.ctx);
  expect((await moved.get("/api/device/rules")).status).toBe(200);
  expect((await h.ctx.db.select().from(phones).where(eq(phones.id, importedId)))[0]?.pairedAt).not.toBeNull();

  const second = await pairPhone(h, s.parent);
  const again = await exportPhone(s, second.phoneId);
  const secondImport = await s.newParent.post(s.destinationPath + "/import", again);
  const secondId = secondImport.json.phoneIds[0] as string;
  await h.ctx.db.update(phones).set({ deviceTokenHash: "b".repeat(64) }).where(eq(phones.id, secondId));
  h.clock.advance(8 * 24 * 60 * 60_000);
  await sweep(h.ctx);
  expect((await h.ctx.db.select().from(phones).where(eq(phones.id, secondId)))[0]).toMatchObject({ awaitingServerMove: false, deviceTokenHash: null });
});

it("counts imported phones against HOUSEHOLD_PHONE_CAP and keeps the invitation when it refuses", async () => {
  const s = await servers();
  await pairPhone(h, s.parent, { name: "Test phone A" });
  await pairPhone(h, s.parent, { name: "Test phone B" });
  s.destination.ctx.cfg.HOUSEHOLD_PHONE_CAP = 2;
  expect((await s.newParent.post("/api/phones/enroll", { name: "Already here", profile: "child" })).status).toBe(201);
  const ticket = await invitation(s);
  const out = await s.parent.post(s.sourcePath + "/export", { ticket });
  expect(out.status).toBe(201);
  const importPath = s.destinationPath + "/import";
  const refused = await s.newParent.post(importPath, { ticketId: ticket.id, bundle: out.json.bundle });
  expect(refused.status).toBe(403);
  expect(refused.json).toMatchObject({ code: "household_phone_cap", max: 2 });
  expect((await s.newParent.get("/api/phones")).json.phones).toHaveLength(1);
  s.destination.ctx.cfg.HOUSEHOLD_PHONE_CAP = 3;
  const imported = await s.newParent.post(importPath, { ticketId: ticket.id, bundle: out.json.bundle });
  expect(imported.status).toBe(201);
  expect((await s.newParent.get("/api/phones")).json.phones).toHaveLength(3);
});
