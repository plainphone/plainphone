// SPDX-License-Identifier: Apache-2.0
import { and, eq } from "drizzle-orm";
import { exportPKCS8, generateKeyPair } from "jose";
import { expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { contacts, dnsSettings, moveIdentity, phones, phoneSettings, schedules, selfKeys } from "../src/db/schema.js";
import { randomToken } from "../src/lib/crypto.js";
import { sweep } from "../src/services/sweeper.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();
const destinationUrl = "https://new.example.test:8443";

async function servers() {
  const parent = await signIn(h, "source@example.org");
  const sourceHousehold = (await parent.get("/api/me")).json.households[0].id;
  // The harness shares Postgres, but distinct households, app contexts and URL/DNS
  // settings test the transfer boundary without letting either access the other's routes.
  const cfg = { ...h.ctx.cfg, PUBLIC_URL: destinationUrl, DNS_HOST_SUFFIX: "filter.example.test", DNS_PROVIDER: "http" as const };
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
