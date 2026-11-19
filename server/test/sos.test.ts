// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { householdMembers, phones, pushSubscriptions, sosEvents } from "../src/db/schema.js";
import { sweep } from "../src/services/sweeper.js";
import { expect, it, vi } from "vitest";
import { pairPhone, signIn, useHarness, waitForSosRetryBackoff } from "./harness.js";

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
  // Over the limit the report is stored (the phone already acted), it just does not notify again.
  const limited = { ...report, id: randomUUID() };
  expect((await device.post("/api/device/sos", limited)).status).toBe(200);
  expect((await parent.get(path)).json.events.map((e: { id: string }) => e.id)).toContain(limited.id);
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

it("retries an accepted urgent report after both notification providers fail", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
  const { user } = (await parent.get("/api/me")).json;
  await h.ctx.db.insert(pushSubscriptions).values({
    userId: user.id, platform: "web", endpoint: "https://example.test/retry",
  });
  const push = vi.spyOn(h.parentPush, "send").mockResolvedValue("failed");
  const mail = vi.spyOn(h.mail, "send").mockRejectedValue(new Error("unavailable"));
  const report = { id: randomUUID(), kind: "urgent" };
  try {
    expect((await device.post("/api/device/sos", report)).status).toBe(200);
    await waitForSosRetryBackoff(h, report.id);
    expect(push).toHaveBeenCalledTimes(1);
    expect(mail).toHaveBeenCalledTimes(1);
  } finally {
    push.mockRestore();
    mail.mockRestore();
  }
  h.clock.advance(60_000);
  await sweep(h.ctx);
  expect(h.parentPush.sent).toHaveLength(1);
  await sweep(h.ctx);
  expect(h.parentPush.sent).toHaveLength(1);
  expect((await parent.get(`/api/phones/${phoneId}/sos`)).json.events).toHaveLength(1);
});

it("sends urgent SOS through the native push path as time-sensitive with the SOS route", async () => {
  const sent: { platform: string; message: unknown; urgent: unknown }[] = [];
  h.ctx.parentPush = {
    name: "native-test", webPublicKey: null, enabled: (platform) => platform === "fcm",
    async send(target, message, opts) { sent.push({ platform: target.platform, message, urgent: opts?.urgent }); return "sent"; },
  };
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
  expect((await parent.post("/api/notifications/subscriptions", { platform: "fcm", token: "f".repeat(40) })).status).toBe(201);
  expect((await device.post("/api/device/sos", { id: randomUUID(), kind: "urgent" })).status).toBe(200);
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]).toMatchObject({
    platform: "fcm", urgent: true,
    message: { data: { type: "sos-urgent", phoneId }, url: `/phones/${phoneId}` },
  });
});

it("reclaims dispatch after an interrupted worker's lease expires", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId } = await pairPhone(h, parent, { profile: "child" });
  const { user } = (await parent.get("/api/me")).json;
  await h.ctx.db.insert(pushSubscriptions).values({
    userId: user.id, platform: "web", endpoint: "https://example.test/interrupted",
  });
  const now = h.ctx.now();
  await h.ctx.db.insert(sosEvents).values({
    id: randomUUID(), phoneId, kind: "urgent", createdAt: now, receivedAt: now,
    notificationLeaseUntil: new Date(now.getTime() + 60_000),
  });
  await sweep(h.ctx);
  expect(h.parentPush.sent).toHaveLength(0);
  h.clock.advance(120_000);
  await sweep(h.ctx);
  await sweep(h.ctx);
  expect(h.parentPush.sent).toHaveLength(1);
});
