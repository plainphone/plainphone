// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { sweep } from "../src/services/sweeper.js";
import { type Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

const EP = "https://fcm.googleapis.com/fcm/send/";
const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
const subscribe = (c: Client, id: string) =>
  c.post("/api/notifications/subscriptions", { platform: "web", endpoint: EP + id, keys, label: "Chrome on Android" });

const status = (over: Partial<Record<string, unknown>> = {}) => ({
  appVersion: "0.1.3",
  batteryPct: 80,
  charging: false,
  deviceOwner: true,
  lockIntact: true,
  maintenance: false,
  failedPolicies: [],
  rulesEtag: null,
  rulesAppliedAt: null,
  dnsHost: null,
  ...over,
});

describe("push subscriptions", () => {
  it("registers, lists, tests and removes a browser", async () => {
    const mum = await signIn(h, "mum@example.org");
    const r = await subscribe(mum, "one");
    expect(r.status).toBe(201);
    const list = await mum.get("/api/notifications");
    expect(list.json).toMatchObject({ webPushEnabled: true, webPushPublicKey: "test-public-key", offlineAlertHours: 12, mutedPhoneIds: [] });
    expect(list.json.subscriptions).toEqual([expect.objectContaining({ id: r.json.id, platform: "web", label: "Chrome on Android" })]);
    // Keys never come back.
    expect(JSON.stringify(list.json)).not.toContain(keys.auth);

    expect((await mum.post("/api/notifications/test", {})).json).toEqual({ sent: 1 });
    expect(h.parentPush.sent[0]).toMatchObject({ endpoint: EP + "one", msg: { title: "Notifications work", url: "/settings" } });

    // Someone else cannot remove it.
    const dad = await signIn(h, "dad@example.org");
    await dad.del(`/api/notifications/subscriptions/${r.json.id}`);
    expect((await mum.get("/api/notifications")).json.subscriptions).toHaveLength(1);
    expect((await mum.del(`/api/notifications/subscriptions/${r.json.id}`)).status).toBe(204);
    expect((await mum.get("/api/notifications")).json.subscriptions).toHaveLength(0);
  });

  it("refuses endpoints outside the known push services", async () => {
    const mum = await signIn(h, "mum@example.org");
    const r = await mum.post("/api/notifications/subscriptions", { platform: "web", endpoint: "https://10.0.0.1:8053/v1/clients", keys });
    expect(r.status).toBe(400);
  });

  it("stores native tokens for the parent apps, but sends nothing to them yet", async () => {
    const mum = await signIn(h, "mum@example.org");
    expect((await mum.post("/api/notifications/subscriptions", { platform: "fcm", token: "f".repeat(40) })).status).toBe(201);
    expect((await mum.post("/api/notifications/test", {})).json).toEqual({ sent: 0 });
    expect((await mum.get("/api/notifications")).json.subscriptions).toHaveLength(1);
  });

  it("drops a subscription the push service says is gone", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "old");
    h.parentPush.gone.add(EP + "old");
    expect((await mum.post("/api/notifications/test", {})).json).toEqual({ sent: 0 });
    expect((await mum.get("/api/notifications")).json.subscriptions).toHaveLength(0);
  });

  it("moves a browser to whoever signs in on it", async () => {
    const mum = await signIn(h, "mum@example.org");
    const dad = await signIn(h, "dad@example.org");
    await subscribe(mum, "shared");
    await subscribe(dad, "shared");
    expect((await mum.get("/api/notifications")).json.subscriptions).toHaveLength(0);
    expect((await dad.get("/api/notifications")).json.subscriptions).toHaveLength(1);
  });
});

describe("protection removed", () => {
  it("tells the parents when the very first report shows a broken lock", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "mum");
    const { device } = await pairPhone(h, mum);
    await device.put("/api/device/status", status({ lockIntact: false }));
    expect(h.parentPush.sent).toHaveLength(1);
    expect(h.mail.outbox.at(-1)!.subject).toBe("Protection removed on Alma");
  });

  it("notifies once when the lock breaks, not on every report", async () => {
    const mum = await signIn(h, "mum@example.org", "da");
    await subscribe(mum, "mum");
    const { device } = await pairPhone(h, mum, { name: "Alma" });
    await device.put("/api/device/status", status());
    expect(h.parentPush.sent).toHaveLength(0);
    await device.put("/api/device/status", status({ lockIntact: false, failedPolicies: ["dialer role"] }));
    await device.put("/api/device/status", status({ lockIntact: false }));
    expect(h.parentPush.sent).toHaveLength(1);
    expect(h.parentPush.sent[0]).toMatchObject({ urgent: true, msg: { title: "Beskyttelsen er fjernet på Alma" } });
    // Fixed and broken again: a new event.
    await device.put("/api/device/status", status());
    await device.put("/api/device/status", status({ lockIntact: false }));
    expect(h.parentPush.sent).toHaveLength(2);
  });

  it("treats a maintenance unlock as not a removal, but notices when it ends broken", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "mum");
    const { device } = await pairPhone(h, mum);
    await device.put("/api/device/status", status());
    await device.put("/api/device/status", status({ lockIntact: false, maintenance: true }));
    expect(h.parentPush.sent).toHaveLength(0);
    await device.put("/api/device/status", status({ lockIntact: false, maintenance: false }));
    expect(h.parentPush.sent).toHaveLength(1);
  });

  it("notifies when Device Owner disappears, and respects a muted phone", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "mum");
    const a = await pairPhone(h, mum, { name: "Alma" });
    const b = await pairPhone(h, mum, { name: "Bo" });
    expect((await mum.put(`/api/phones/${b.phoneId}/notifications`, { enabled: false })).status).toBe(204);
    expect((await mum.get("/api/notifications")).json.mutedPhoneIds).toEqual([b.phoneId]);
    for (const p of [a, b]) {
      await p.device.put("/api/device/status", status());
      await p.device.put("/api/device/status", status({ deviceOwner: false, lockIntact: false }));
    }
    expect(h.parentPush.sent.map((s) => s.msg.title)).toEqual(["Protection removed on Alma"]);
    expect(h.parentPush.sent[0]!.msg.body).toContain("no longer controls");
  });

  it("reaches every parent in the household", async () => {
    const mum = await signIn(h, "mum@example.org");
    const hid = (await mum.get("/api/me")).json.households[0].id;
    await mum.post(`/api/households/${hid}/invites`, { email: "dad@example.org" });
    const token = decodeURIComponent(/invite#token=(\S+)/.exec(h.mail.outbox.at(-1)!.text)![1]!);
    const dad = await signIn(h, "dad@example.org");
    await dad.post("/api/invites/accept", { token });
    await subscribe(mum, "mum");
    await subscribe(dad, "dad");
    const { device } = await pairPhone(h, mum);
    await device.put("/api/device/status", status());
    await device.put("/api/device/status", status({ lockIntact: false }));
    expect(h.parentPush.sent.map((s) => s.endpoint).sort()).toEqual([EP + "dad", EP + "mum"]);
  });
});

describe("offline (#22)", () => {
  it("notifies once after 12 hours without contact, and again only after the phone was back", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "mum");
    const { device } = await pairPhone(h, mum, { name: "Alma" });
    await device.get("/api/device/rules");
    const mails = h.mail.outbox.length;
    h.clock.advance(12 * 3_600_000 - 60_000);
    await sweep(h.ctx);
    expect(h.parentPush.sent).toHaveLength(0);
    h.clock.advance(120_000);
    const r = await sweep(h.ctx);
    expect(r.offlineAlerts).toBe(1);
    await sweep(h.ctx);
    h.clock.advance(3_600_000);
    await sweep(h.ctx);
    expect(h.parentPush.sent.map((s) => s.msg.title)).toEqual(["Alma has not been in touch for 12 hours"]);
    // 12:00 UTC is 13:00 in Copenhagen, the phone's time zone.
    expect(h.parentPush.sent[0]!.msg.body).toBe("Last contact Mon 13:00. It may be switched off, out of battery or reset.");
    // And one calm mail, in the shared layout.
    const sent = h.mail.outbox.slice(mails);
    expect(sent.map((m) => [m.to, m.subject])).toEqual([["mum@example.org", "Alma has not been in touch for 12 hours"]]);
    expect(sent[0]!.html).toContain("/phones/");
    expect(sent[0]!.text).toContain("out of battery or reset");

    await device.get("/api/device/rules");
    h.clock.advance(13 * 3_600_000);
    await sweep(h.ctx);
    expect(h.parentPush.sent).toHaveLength(2);
  });
});

describe("offline time per phone", () => {
  it("follows the parents' choice, and 0 means never", async () => {
    const mum = await signIn(h, "mum@example.org", "da");
    await subscribe(mum, "mum");
    const a = await pairPhone(h, mum, { name: "Alma" });
    const b = await pairPhone(h, mum, { name: "Bo" });
    expect((await mum.patch(`/api/phones/${a.phoneId}`, { offlineAlertHours: 2 })).json).toMatchObject({ offlineAlertHours: 2, offlineAlertHoursDefault: 12 });
    await mum.patch(`/api/phones/${b.phoneId}`, { offlineAlertHours: 0 });
    await a.device.get("/api/device/rules");
    await b.device.get("/api/device/rules");
    h.clock.advance(3 * 3_600_000);
    await sweep(h.ctx);
    expect(h.parentPush.sent.map((s) => s.msg.title)).toEqual(["Alma har ikke været i kontakt i 2 timer"]);
    h.clock.advance(100 * 3_600_000);
    await sweep(h.ctx);
    expect(h.parentPush.sent).toHaveLength(1);
  });
});

describe("trusted person", () => {
  it("gets a push when a request waits for them", async () => {
    const me = await signIn(h, "adult@example.org");
    const { phoneId, device } = await pairPhone(h, me, { name: "My phone", profile: "self" });
    await device.put("/api/device/apps", { apps: [{ packageName: "com.instagram.android", label: "Instagram" }] });
    const key = { keyType: "trusted", delayHours: 24, trustedEmail: "friend@example.org", payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone" };
    await me.put(`/api/phones/${phoneId}/key`, key);
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    const friend = await signIn(h, "friend@example.org");
    await subscribe(friend, "friend");
    await subscribe(me, "me");
    await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true });
    expect(h.parentPush.sent).toEqual([
      expect.objectContaining({ endpoint: EP + "friend", msg: expect.objectContaining({ title: "A request is waiting for you", url: "/approvals" }) }),
    ]);
  });
});
