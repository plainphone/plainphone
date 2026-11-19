// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { householdMembers, phones, pushSubscriptions, sosEvents } from "../src/db/schema.js";
import { sweep } from "../src/services/sweeper.js";
import { expect, it, vi } from "vitest";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

it("stores a retry once, limits help, and keeps urgent reports and acknowledgments", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
  const path = `/api/phones/${phoneId}/sos`;
  const report = { id: randomUUID(), kind: "help" };
  expect((await device.post("/api/device/sos", report)).status).toBe(200);
  expect((await device.post("/api/device/sos", report)).status).toBe(200);
  expect((await parent.get(path)).json.events).toHaveLength(1);
  for (let i = 0; i < 4; i++) {
    expect((await device.post("/api/device/sos", { ...report, id: randomUUID() })).status).toBe(200);
  }
  expect((await device.post("/api/device/sos", { ...report, id: randomUUID() })).status).toBe(429);
  const urgent = { id: randomUUID(), kind: "urgent" };
  expect((await device.post("/api/device/sos", urgent)).status).toBe(200);
  expect((await parent.post(`${path}/${urgent.id}/seen`, {})).status).toBe(200);
  expect((await device.get(`/api/device/sos/${urgent.id}`)).json.seenAt).toBeTruthy();
});

it("alerts each household parent and their devices once, without retaining a disabled location", async () => {
  const parent = await signIn(h, "parent@example.org");
  const second = await signIn(h, "second@example.org");
  const stranger = await signIn(h, "stranger@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child", mode: "light" });
  const [firstUser, secondUser, outsider] = await Promise.all([parent, second, stranger].map(async (who) => (await who.get("/api/me")).json.user.id));
  const [phone] = await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId));
  await h.ctx.db.insert(householdMembers).values({ householdId: phone!.householdId, userId: secondUser, role: "parent" });
  await h.ctx.db.insert(pushSubscriptions).values([
    { userId: firstUser, platform: "web", endpoint: "https://example.test/first" },
    { userId: firstUser, platform: "web", endpoint: "https://example.test/other" },
    { userId: secondUser, platform: "web", endpoint: "https://example.test/second" },
    { userId: outsider, platform: "web", endpoint: "https://example.test/stranger" },
  ]);
  const path = `/api/phones/${phoneId}/sos`;
  expect((await parent.put(`/api/phones/${phoneId}/location/mode`, { mode: "off" })).status).toBe(200);
  const mailBefore = h.mail.outbox.length;
  const report = { id: randomUUID(), kind: "urgent", location: { lat: 55, lon: 12 }, smsSubmitted: true };
  const replies = await Promise.all([device.post("/api/device/sos", report), device.post("/api/device/sos", report)]);
  expect(replies.map((res) => res.status)).toEqual([200, 200]);
  expect(replies[0]!.json).toMatchObject({ location: null, deliveredVia: "sms" });
  await vi.waitFor(() => {
    expect(h.parentPush.sent.map((entry) => entry.endpoint).sort()).toEqual([
      "https://example.test/first", "https://example.test/other", "https://example.test/second",
    ]);
    expect(h.mail.outbox.slice(mailBefore).map((mail) => mail.to).sort()).toEqual(["parent@example.org", "second@example.org"]);
  });
  expect(h.parentPush.sent.every((entry) => entry.urgent)).toBe(true);
  expect((await stranger.post(`${path}/${report.id}/seen`)).status).toBe(404);
  expect((await second.post(`${path}/${report.id}/seen`)).json.seenAt).toBeTruthy();
  h.clock.advance(30 * 86_400_000 + 1);
  await sweep(h.ctx);
  expect((await parent.get(path)).json.events).toEqual([]);
  expect(await h.ctx.db.select().from(sosEvents)).toEqual([]);
});
