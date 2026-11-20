// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { alertOfflinePhones } from "../src/services/notifications.js";
import { sweep } from "../src/services/sweeper.js";
import { households, phones } from "../src/db/schema.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

/** These tests are about the alerts themselves: the weekly summary (its own tests) would add pushes and hold offline news back. */
const withoutSummary = () => h.ctx.db.update(households).set({ summaryEnabled: false });

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

  it("refuses native registrations when their provider is off", async () => {
    const mum = await signIn(h, "mum@example.org");
    expect((await mum.post("/api/notifications/subscriptions", { platform: "fcm", token: "f".repeat(40) })).status).toBe(409);
    expect((await mum.post("/api/notifications/test", {})).json).toEqual({ sent: 0 });
    expect((await mum.get("/api/notifications")).json.subscriptions).toHaveLength(0);
  });

  it("replaces rotated native tokens and removes invalid registrations without VAPID", async () => {
    const token = "f".repeat(40);
    const replacement = "r".repeat(40);
    h.ctx.parentPush = {
      name: "native-test", webPublicKey: null, enabled: (platform) => platform === "fcm",
      async send(target) { return target.endpoint === replacement ? "gone" : "sent"; },
    };
    const parent = await signIn(h, "parent@example.org");
    const register = (value: string, replaces?: string) =>
      parent.post("/api/notifications/subscriptions", { platform: "fcm", token: value, replaces });
    expect((await register(token)).status).toBe(201);
    expect((await parent.post("/api/notifications/test", {})).json).toEqual({ sent: 1 });
    const rotated = await register(replacement, token);
    expect(rotated.status).toBe(201);
    expect((await parent.get("/api/notifications")).json.subscriptions).toEqual([expect.objectContaining({ id: rotated.json.id })]);
    expect((await parent.post("/api/notifications/test", {})).json).toEqual({ sent: 0 });
    expect((await parent.get("/api/notifications")).json.subscriptions).toHaveLength(0);
  });

  it("rotates native tokens in place and refuses to refresh a removed subscription", async () => {
    h.ctx.parentPush = {
      name: "native-test", webPublicKey: null, enabled: (platform) => platform === "fcm",
      async send() { return "sent"; },
    };
    const parent = await signIn(h, "parent@example.org");
    const path = "/api/notifications/subscriptions";
    const initial = await parent.post(path, { platform: "fcm", token: "a".repeat(40) });
    expect(initial.status).toBe(201);
    const rotation = { platform: "fcm", token: "b".repeat(40), subscriptionId: initial.json.id };
    const rotated = await parent.post(path, rotation);
    expect(rotated.status).toBe(201);
    expect(rotated.json.id).toBe(initial.json.id);
    expect((await parent.del(`${path}/${initial.json.id}`)).status).toBe(204);
    expect((await parent.post(path, rotation)).status).toBe(404);
    expect((await parent.get("/api/notifications")).json.subscriptions).toEqual([]);
  });

  it("keeps manual native removal after logout, login and token rotation until opt-in", async () => {
    h.ctx.parentPush = {
      name: "native-test", webPublicKey: null, enabled: () => true,
      async send() { return "sent"; },
    };
    const parent = await signIn(h, "parent@example.org");
    const path = "/api/notifications/subscriptions";
    const registration = { platform: "apns", token: "a".repeat(40), installationKey: "a".repeat(40) };
    const initial = await parent.post(path, registration);
    expect(initial.status).toBe(201);
    await parent.del(`${path}/${initial.json.id}`);
    expect((await parent.post("/api/auth/logout")).status).toBe(204);

    const signedInAgain = await signIn(h, "parent@example.org");
    expect((await signedInAgain.post(path, registration)).status).toBe(404);
    const rotated = { ...registration, token: "b".repeat(40) };
    expect((await signedInAgain.post(path, rotated)).status).toBe(404);
    expect((await signedInAgain.post("/api/notifications/test", {})).json).toEqual({ sent: 0 });
    expect((await signedInAgain.post(path, { ...rotated, optIn: true })).status).toBe(201);
    expect((await signedInAgain.post("/api/notifications/test", {})).json).toEqual({ sent: 1 });
  });

  it("logout removes native registrations even without their POST responses", async () => {
    h.ctx.parentPush = {
      name: "native-test", webPublicKey: null, enabled: () => true,
      async send() { return "sent"; },
    };
    const parent = await signIn(h, "parent@example.org");
    const otherSession = await signIn(h, "parent@example.org");
    const path = "/api/notifications/subscriptions";
    const register = (client: Client, seed: string) =>
      client.post(path, { platform: "fcm", token: seed.repeat(40), installationKey: seed.repeat(40) });
    expect((await register(parent, "a")).status).toBe(201);
    expect((await register(parent, "b")).status).toBe(201);
    const other = await register(otherSession, "c");
    expect((await parent.post("/api/auth/logout")).status).toBe(204);
    expect((await register(parent, "d")).status).toBe(401);
    expect((await otherSession.get("/api/notifications")).json.subscriptions)
      .toEqual([expect.objectContaining({ id: other.json.id })]);
    expect((await otherSession.post("/api/notifications/test", {})).json).toEqual({ sent: 1 });
  });

  it("lets a reinstall with a new installation key take over its active token", async () => {
    h.ctx.parentPush = {
      name: "native-test", webPublicKey: null, enabled: () => true,
      async send() { return "sent"; },
    };
    const parent = await signIn(h, "parent@example.org");
    const path = "/api/notifications/subscriptions";
    const token = "a".repeat(40);
    const first = await parent.post(path, { platform: "apns", token, installationKey: token });
    expect(first.status).toBe(201);
    const again = await parent.post(path, { platform: "apns", token, installationKey: "n".repeat(40) });
    expect(again.status).toBe(201);
    expect(again.json.id).toBe(first.json.id);
    expect((await parent.get("/api/notifications")).json.subscriptions).toHaveLength(1);
  });

  it("does not leave an active subscription when its registration races logout", async () => {
    h.ctx.parentPush = {
      name: "native-test", webPublicKey: null, enabled: () => true,
      async send() { return "sent"; },
    };
    const parent = await signIn(h, "parent@example.org");
    const observer = await signIn(h, "parent@example.org");
    const token = "a".repeat(40);
    const [registration, logout] = await Promise.all([
      parent.post("/api/notifications/subscriptions", { platform: "fcm", token, installationKey: token }),
      parent.post("/api/auth/logout"),
    ]);
    expect([201, 401]).toContain(registration.status);
    expect(logout.status).toBe(204);
    expect((await observer.get("/api/notifications")).json.subscriptions).toEqual([]);
  });

  it.each(["fcm", "apns"])("recovers %s provider cleanup with a fresh token", async (platform) => {
    const token = "a".repeat(40);
    h.ctx.parentPush = {
      name: "native-test", webPublicKey: null, enabled: () => true,
      async send(target) { return target.endpoint === token ? "gone" : "sent"; },
    };
    let parent = await signIn(h, "parent@example.org");
    const path = "/api/notifications/subscriptions";
    const registration = { platform, token, installationKey: token };
    const initial = await parent.post(path, registration);
    expect((await parent.post("/api/notifications/test", {})).json).toEqual({ sent: 0 });
    expect((await parent.get("/api/notifications")).json.subscriptions).toEqual([]);
    expect((await parent.post(path, { ...registration, subscriptionId: initial.json.id })).status).toBe(404);
    expect((await parent.post("/api/auth/logout")).status).toBe(204);
    parent = await signIn(h, "parent@example.org");
    expect((await parent.post(path, registration)).status).toBe(404);
    const rotated = await parent.post(path, { ...registration, subscriptionId: initial.json.id, token: "b".repeat(40) });
    expect(rotated.status).toBe(201);
    expect(rotated.json.id).toBe(initial.json.id);
    expect((await parent.post("/api/notifications/test", {})).json).toEqual({ sent: 1 });
  });

  it("drops a subscription the push service says is gone", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "old");
    h.parentPush.gone.add(EP + "old");
    expect((await mum.post("/api/notifications/test", {})).json).toEqual({ sent: 0 });
    expect((await mum.get("/api/notifications")).json.subscriptions).toHaveLength(0);
  });

  it("replaces a rotated subscription and keeps its label", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "old");
    const r = await mum.post("/api/notifications/subscriptions", { platform: "web", endpoint: EP + "new", keys, replaces: EP + "old" });
    expect(r.status).toBe(201);
    const subs = (await mum.get("/api/notifications")).json.subscriptions;
    expect(subs).toEqual([expect.objectContaining({ id: r.json.id, label: "Chrome on Android" })]);
    // The browser finds its own row by a hash of its endpoint; the endpoint itself never comes back.
    expect(subs[0].endpointHash).toBe(createHash("sha256").update(EP + "new").digest("hex"));
    expect(JSON.stringify(subs)).not.toContain(EP);
    // Re-registering the same endpoint without a label keeps the label.
    await mum.post("/api/notifications/subscriptions", { platform: "web", endpoint: EP + "new", keys });
    expect((await mum.get("/api/notifications")).json.subscriptions[0].label).toBe("Chrome on Android");
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

describe("lifted lock step (#75)", () => {
  const NAME = "restriction no_modify_accounts";
  const lifted = (afterMs: number) => [{ name: NAME, until: new Date(h.clock.now.getTime() + afterMs).toISOString() }];

  it("keeps the lock intact and quiet while the window is open, and shows the deadline to the parents", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "mum");
    const { device, phoneId } = await pairPhone(h, mum);
    await device.put("/api/device/status", status());
    const liftedPolicies = lifted(3 * 60_000);
    expect((await device.put("/api/device/status", status({ liftedPolicies }))).status).toBe(204);
    // Two minutes past the deadline is still within the grace for clock skew.
    h.clock.advance(5 * 60_000 - 1000);
    expect((await device.put("/api/device/status", status({ liftedPolicies }))).status).toBe(204);
    expect(h.parentPush.sent).toHaveLength(0);
    const seen = (await mum.get(`/api/phones/${phoneId}`)).json.status;
    expect(seen).toMatchObject({ lockIntact: true, failedPolicies: [], liftedPolicies });
    expect(seen).not.toHaveProperty("liftedOverdueAlertedAt");
  });

  it("counts a window that is still open after its deadline as a failed step, and alerts once", async () => {
    const mum = await signIn(h, "mum@example.org", "da");
    await subscribe(mum, "mum");
    const { device, phoneId } = await pairPhone(h, mum, { name: "Alma" });
    await device.put("/api/device/status", status());
    const liftedPolicies = lifted(3 * 60_000);
    h.clock.advance(6 * 60_000);
    await device.put("/api/device/status", status({ liftedPolicies, failedPolicies: ["dialer role"] }));
    await device.put("/api/device/status", status({ liftedPolicies }));
    expect(h.parentPush.sent).toHaveLength(1);
    expect(h.parentPush.sent[0]).toMatchObject({ urgent: true, msg: { title: "Beskyttelsen er fjernet på Alma" } });
    const seen = (await mum.get(`/api/phones/${phoneId}`)).json.status;
    expect(seen.lockIntact).toBe(false);
    expect(seen.failedPolicies).toEqual([NAME]);
  });

  it("tells the parents once when the phone stays silent after the deadline, and clears on the next report", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "mum");
    const { device } = await pairPhone(h, mum, { name: "Alma" });
    await withoutSummary();
    await device.put("/api/device/status", status({ liftedPolicies: lifted(3 * 60_000) }));
    h.clock.advance(3 * 60_000 + 9 * 60_000);
    expect((await sweep(h.ctx)).offlineAlerts).toBe(0);
    h.clock.advance(2 * 60_000);
    expect((await sweep(h.ctx)).offlineAlerts).toBe(1);
    expect((await sweep(h.ctx)).offlineAlerts).toBe(0);
    expect(h.parentPush.sent.map((s) => s.msg.title)).toEqual(["Alma: account changes may still be allowed"]);
    expect(h.parentPush.sent[0]).toMatchObject({ urgent: true, msg: { url: expect.stringContaining("/phones/") } });
    expect(h.mail.outbox.at(-1)!.subject).toBe("Alma: account changes may still be allowed");
    // The phone is back: the marker goes with the replaced status, and a later lifted window can alert again.
    await device.put("/api/device/status", status());
    expect((await sweep(h.ctx)).offlineAlerts).toBe(0);
    await device.put("/api/device/status", status({ liftedPolicies: lifted(3 * 60_000) }));
    h.clock.advance(14 * 60_000);
    expect((await sweep(h.ctx)).offlineAlerts).toBe(1);
  });

  it("leaves a phone alone that reported after the deadline", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "mum");
    const { device } = await pairPhone(h, mum, { name: "Alma" });
    await withoutSummary();
    await device.put("/api/device/status", status({ liftedPolicies: lifted(60_000) }));
    h.clock.advance(5 * 60_000);
    await device.put("/api/device/status", status({ liftedPolicies: lifted(-4 * 60_000) }));
    const pushes = h.parentPush.sent.length;
    h.clock.advance(30 * 60_000);
    expect((await sweep(h.ctx)).offlineAlerts).toBe(0);
    expect(h.parentPush.sent).toHaveLength(pushes);
  });
});

describe("offline (#22)", () => {
  it("notifies once after 12 hours without contact, and again only after the phone was back", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "mum");
    const { device } = await pairPhone(h, mum, { name: "Alma" });
    await withoutSummary();
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
    expect(h.parentPush.sent[0]!.msg.body).toBe("Last contact Mon 16 Nov, 13:00. It may be switched off, out of battery or reset.");
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

  it("still alerts the other claimed phones when one alert fails", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "mum");
    const a = await pairPhone(h, mum, { name: "Alma" });
    const b = await pairPhone(h, mum, { name: "Bo" });
    await withoutSummary();
    await a.device.get("/api/device/rules");
    await b.device.get("/api/device/rules");
    h.clock.advance(13 * 3_600_000);
    const select = vi.spyOn(h.ctx.db, "select").mockImplementationOnce(() => {
      throw new Error("database unavailable");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await alertOfflinePhones(h.ctx)).toBe(2);
    } finally {
      select.mockRestore();
      log.mockRestore();
    }
    expect(h.parentPush.sent).toHaveLength(1);
  });

  it("says how long the phone has really been quiet, in days after two days", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "mum");
    const { device } = await pairPhone(h, mum, { name: "Alma" });
    await withoutSummary();
    await device.get("/api/device/rules");
    // The server was down for three days: the alert tells the real silence.
    h.clock.advance(3 * 86_400_000 + 3_600_000);
    await sweep(h.ctx);
    expect(h.parentPush.sent.map((s) => s.msg.title)).toEqual(["Alma has not been in touch for 3 days"]);
  });
});

describe("confirmed light phone that never connects (#88)", () => {
  async function confirmedButSilent(parent: Awaited<ReturnType<typeof signIn>>, name: string) {
    const device = new Client(h);
    const start = await device.post("/api/device/pairings", { mode: "light", profile: "child", confirmOnPhone: true });
    const path = `/api/device/pairings/${start.json.pairingId}`;
    const headers = { "x-poll-secret": start.json.pollSecret };
    expect((await parent.post("/api/phones/claim", { code: start.json.code, name, profile: "child" })).status).toBe(201);
    expect((await device.call("POST", path, { action: "confirm" }, headers)).status).toBe(200);
    return device;
  }

  it("reminds the parents once, after two days, with a push and a mail", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "mum");
    await confirmedButSilent(mum, "Alma");
    await withoutSummary();
    const mails = h.mail.outbox.length;
    h.clock.advance(47 * 3_600_000);
    expect((await sweep(h.ctx)).offlineAlerts).toBe(0);
    h.clock.advance(2 * 3_600_000);
    expect((await sweep(h.ctx)).offlineAlerts).toBe(1);
    await sweep(h.ctx);
    h.clock.advance(3 * 86_400_000);
    await sweep(h.ctx);
    expect(h.parentPush.sent.map((s) => s.msg.title)).toEqual(["Alma has not connected yet"]);
    expect(h.mail.outbox.slice(mails).map((m) => [m.to, m.subject])).toEqual([["mum@example.org", "Alma has not connected yet"]]);
  });

  it("stays quiet when the parents turned offline alerts off for the phone", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "mum");
    await confirmedButSilent(mum, "Alma");
    await withoutSummary();
    const [phone] = await h.ctx.db.select({ id: phones.id }).from(phones);
    await h.ctx.db.update(phones).set({ offlineAlertHours: 0 }).where(eq(phones.id, phone!.id));
    h.clock.advance(5 * 86_400_000);
    expect((await sweep(h.ctx)).offlineAlerts).toBe(0);
    expect(h.parentPush.sent).toHaveLength(0);
  });
});

describe("offline time per phone", () => {
  it("follows the parents' choice, and 0 means never", async () => {
    const mum = await signIn(h, "mum@example.org", "da");
    await subscribe(mum, "mum");
    const a = await pairPhone(h, mum, { name: "Alma" });
    const b = await pairPhone(h, mum, { name: "Bo" });
    await withoutSummary();
    expect((await mum.patch(`/api/phones/${a.phoneId}`, { offlineAlertHours: 2 })).json).toMatchObject({ offlineAlertHours: 2, offlineAlertHoursDefault: 12 });
    await mum.patch(`/api/phones/${b.phoneId}`, { offlineAlertHours: 0 });
    await a.device.get("/api/device/rules");
    await b.device.get("/api/device/rules");
    h.clock.advance(3 * 3_600_000);
    await sweep(h.ctx);
    expect(h.parentPush.sent.map((s) => s.msg.title)).toEqual(["Alma har ikke været i kontakt i 3 timer"]);
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
