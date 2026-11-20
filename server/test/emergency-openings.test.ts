// SPDX-License-Identifier: Apache-2.0
// Strictness levels (#42) and limited emergency openings (#43) on a Self phone. The clock is the
// harness clock (2026-11-16 12:00 UTC), never the real one.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { emergencyOpenings, phones, selfKeys } from "../src/db/schema.js";
import { monthKey } from "../src/services/emergency-openings.js";
import { selfLevel } from "../src/lib/self-level.js";
import { sweep } from "../src/services/sweeper.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

const KEY = { keyType: "delay", delayHours: 24, trustedEmail: null, payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone" };
const EP = "https://fcm.googleapis.com/fcm/send/";
const pushKeys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };

async function selfPhone(email = "adult@example.org") {
  const me = await signIn(h, email);
  const { phoneId, device } = await pairPhone(h, me, { name: "My phone", profile: "self" });
  return { me, phoneId, device };
}

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const report = (device: Client, over: Record<string, unknown> = {}) =>
  device.post("/api/device/emergency-openings", {
    id: uuid(), packageName: "com.spotify.music", openedAt: h.clock.now.toISOString(), minutes: 15, ...over,
  });

const rulesEmergency = async (device: Client) => (await device.get("/api/device/rules")).json.selfEmergency;
const setEmergency = (me: Client, phoneId: string, enabled: boolean, allowance = 3) =>
  me.put(`/api/phones/${phoneId}/emergency-openings`, { enabled, allowance });

/** The key is a trusted person who has signed in, in another household. */
async function withTrustedPerson(phoneId: string) {
  const helper = await signIn(h, "friend@example.org");
  const helperId = (await helper.get("/api/me")).json.user.id;
  await h.ctx.db.update(selfKeys).set({ keyType: "trusted", trustedUserId: helperId, trustedEmail: "friend@example.org" })
    .where(eq(selfKeys.phoneId, phoneId));
  await helper.post("/api/notifications/subscriptions", { platform: "web", endpoint: EP + "helper", keys: pushKeys, label: "Phone" });
  return helper;
}

describe("strictness levels", () => {
  it("derives the level from the key and never stores it", () => {
    expect(selfLevel({ keyType: "delay", delayHours: 1 })).toBe("mild");
    expect(selfLevel({ keyType: "delay", delayHours: 24 })).toBe("firm");
    expect(selfLevel({ keyType: "trusted", delayHours: 24 })).toBe("strict");
    expect(selfLevel({ keyType: "trusted", delayHours: 6 })).toBe("strict");
    for (const hours of [2, 6, 12, 48, 72]) expect(selfLevel({ keyType: "delay", delayHours: hours })).toBe("custom");
  });

  it("shows a new phone as Firm and an old custom delay as Custom, with the delay untouched", async () => {
    const { me, phoneId } = await selfPhone();
    expect((await me.get(`/api/phones/${phoneId}/key`)).json).toMatchObject({ level: "firm", delayHours: 24 });
    await h.ctx.db.update(selfKeys).set({ delayHours: 12 }).where(eq(selfKeys.phoneId, phoneId));
    expect((await me.get(`/api/phones/${phoneId}/key`)).json).toMatchObject({ level: "custom", delayHours: 12 });
  });

  it("makes Mild a loosening that waits 24 hours, and Firm a tightening that applies at once", async () => {
    const { me, phoneId } = await selfPhone();
    const mild = await me.put(`/api/phones/${phoneId}/key`, { ...KEY, delayHours: 1 });
    expect(mild.status).toBe(202);
    expect(new Date(mild.json.change.effectiveAt).getTime() - h.clock.now.getTime()).toBe(24 * 3_600_000);
    expect((await me.get(`/api/phones/${phoneId}/key`)).json.level).toBe("firm");
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    expect((await me.get(`/api/phones/${phoneId}/key`)).json).toMatchObject({ level: "mild", delayHours: 1 });
    // Back to Firm: a longer wait applies at once.
    expect((await me.put(`/api/phones/${phoneId}/key`, KEY)).json.status).toBe("applied");
    expect((await me.get(`/api/phones/${phoneId}/key`)).json.level).toBe("firm");
  });

  it("makes Strict a loosening that goes through the current key", async () => {
    const { me, phoneId } = await selfPhone();
    const strict = await me.put(`/api/phones/${phoneId}/key`, { ...KEY, keyType: "trusted", trustedEmail: "friend@example.org" });
    expect(strict.status).toBe(202);
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    expect((await me.get(`/api/phones/${phoneId}/key`)).json.level).toBe("strict");
  });
});

describe("emergency openings: the switch and the allowance", () => {
  it("are off for a Self phone and absent for a Child phone", async () => {
    const { me, phoneId, device } = await selfPhone();
    expect(await rulesEmergency(device)).toEqual({ enabled: false, allowance: 3, minutes: 15, used: { month: "2026-11", count: 0 } });
    expect((await me.get(`/api/phones/${phoneId}/key`)).json.emergency).toMatchObject({ enabled: false, allowance: 3, minutes: 15 });
    const kid = await pairPhone(h, me, { name: "Child", profile: "child" });
    expect((await kid.device.get("/api/device/rules")).json).not.toHaveProperty("selfEmergency");
    expect((await me.get(`/api/phones/${kid.phoneId}/emergency-openings`)).status).toBe(404);
    expect((await setEmergency(me, kid.phoneId, true)).status).toBe(404);
  });

  it("goes through the key to switch on, and applies at once to switch off", async () => {
    const { me, phoneId, device } = await selfPhone();
    const on = await setEmergency(me, phoneId, true);
    expect(on.status).toBe(202);
    expect(on.json.change.op).toMatchObject({ type: "emergency.set", enabled: true, allowance: 3 });
    expect((await rulesEmergency(device)).enabled).toBe(false);
    expect((await device.get("/api/device/rules")).json.pendingChanges).toHaveLength(1);

    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    expect(await rulesEmergency(device)).toMatchObject({ enabled: true, allowance: 3 });

    const off = await setEmergency(me, phoneId, false, 3);
    expect(off.status).toBe(200);
    expect((await rulesEmergency(device)).enabled).toBe(false);
  });

  it("treats a bigger allowance as a loosening and a smaller one as a tightening", async () => {
    const { me, phoneId, device } = await selfPhone();
    await h.ctx.db.update(selfKeys).set({ emergencyEnabled: true, emergencyAllowance: 3 }).where(eq(selfKeys.phoneId, phoneId));
    expect((await setEmergency(me, phoneId, true, 5)).status).toBe(202);
    expect((await rulesEmergency(device)).allowance).toBe(3);
    expect((await setEmergency(me, phoneId, true, 2)).status).toBe(200);
    expect((await rulesEmergency(device)).allowance).toBe(2);
    // The same allowance is no change at all.
    expect((await setEmergency(me, phoneId, true, 2)).status).toBe(200);
  });

  it("does not let a changed allowance while switched off sneak a bigger one in", async () => {
    const { me, phoneId } = await selfPhone();
    // Off, so the allowance is worth nothing: storing 8 applies at once but turning it on later is the loosening.
    expect((await setEmergency(me, phoneId, false, 8)).status).toBe(200);
    expect((await setEmergency(me, phoneId, true, 8)).status).toBe(202);
  });

  it("waits for the trusted person when the key is a person", async () => {
    const { me, phoneId } = await selfPhone();
    await withTrustedPerson(phoneId);
    const on = await setEmergency(me, phoneId, true);
    expect(on.status).toBe(202);
    expect(on.json.change).toMatchObject({ keyType: "trusted", effectiveAt: null });
    h.clock.advance(7 * 24 * 3_600_000);
    await sweep(h.ctx);
    expect((await me.get(`/api/phones/${phoneId}/key`)).json.emergency.enabled).toBe(false);
  });

  it("applies at once on a phone that has not connected yet (setup draft)", async () => {
    const { me, phoneId } = await selfPhone();
    await h.ctx.db.update(phones).set({ pairedAt: null, deviceTokenHash: null }).where(eq(phones.id, phoneId));
    expect((await setEmergency(me, phoneId, true)).status).toBe(200);
    expect((await me.get(`/api/phones/${phoneId}/emergency-openings`)).json.enabled).toBe(true);
  });

  it("keeps the other keys' households out", async () => {
    const { me, phoneId } = await selfPhone();
    const stranger = await signIn(h, "stranger@example.org");
    expect((await stranger.get(`/api/phones/${phoneId}/emergency-openings`)).status).toBe(404);
    expect((await setEmergency(stranger, phoneId, true)).status).toBe(404);
    expect((await me.get(`/api/phones/${phoneId}/emergency-openings`)).status).toBe(200);
  });
});

describe("emergency openings: reports from the phone", () => {
  it("records a report once per id, and counts it in the rules", async () => {
    const { me, phoneId, device } = await selfPhone();
    const id = uuid();
    expect((await report(device, { id })).status).toBe(204);
    expect((await report(device, { id })).status).toBe(204);
    expect((await rulesEmergency(device)).used).toEqual({ month: "2026-11", count: 1 });
    const history = (await me.get(`/api/phones/${phoneId}/emergency-openings`)).json;
    expect(history.used).toEqual({ month: "2026-11", count: 1 });
    expect(history.openings).toEqual([{ id, packageName: "com.spotify.music", appLabel: null, openedAt: h.clock.now.toISOString(), minutes: 15 }]);
  });

  it("never refuses: not when switched off, not when the allowance is spent", async () => {
    const { phoneId, device } = await selfPhone();
    await h.ctx.db.update(selfKeys).set({ emergencyEnabled: false, emergencyAllowance: 1 }).where(eq(selfKeys.phoneId, phoneId));
    for (let i = 0; i < 4; i++) expect((await report(device)).status).toBe(204);
    expect((await rulesEmergency(device)).used.count).toBe(4);
  });

  it("rejects only a malformed report", async () => {
    const { device } = await selfPhone();
    expect((await report(device, { id: "not-a-uuid" })).status).toBe(400);
    expect((await report(device, { packageName: "x" })).status).toBe(400);
    expect((await report(device, { openedAt: "yesterday" })).status).toBe(400);
  });

  it("accepts an opening used offline days ago and counts it in the month it happened", async () => {
    const { me, phoneId, device } = await selfPhone();
    h.clock.now = new Date("2026-12-02T10:00:00Z");
    const old = new Date("2026-11-29T10:00:00Z").toISOString();
    expect((await report(device, { openedAt: old })).status).toBe(204);
    expect((await rulesEmergency(device)).used).toEqual({ month: "2026-12", count: 0 });
    h.clock.now = new Date("2026-11-30T12:00:00Z");
    expect((await rulesEmergency(device)).used).toEqual({ month: "2026-11", count: 1 });
    expect((await me.get(`/api/phones/${phoneId}/emergency-openings`)).json.openings).toHaveLength(1);
  });

  it("does not trust a time more than a day in the future", async () => {
    const { phoneId, device } = await selfPhone();
    await report(device, { openedAt: "2030-01-01T00:00:00Z" });
    const [row] = await h.ctx.db.select().from(emergencyOpenings).where(eq(emergencyOpenings.phoneId, phoneId));
    expect(row!.openedAt.toISOString()).toBe(h.clock.now.toISOString());
  });

  it("keeps one phone's openings out of another's count", async () => {
    const a = await selfPhone("a@example.org");
    const b = await selfPhone("b@example.org");
    await report(a.device);
    expect((await rulesEmergency(a.device)).used.count).toBe(1);
    expect((await rulesEmergency(b.device)).used.count).toBe(0);
  });

  it("starts a new month at midnight in the phone's time zone", async () => {
    const { phoneId, device } = await selfPhone();
    await h.ctx.db.update(phones).set({ timezone: "Europe/Copenhagen" }).where(eq(phones.id, phoneId));
    // 23:30 UTC on 31 October is 00:30 on 1 November in Copenhagen (UTC+1 since 25 October).
    h.clock.now = new Date("2026-10-31T23:30:00Z");
    await report(device, { openedAt: "2026-10-31T23:10:00Z" });
    await report(device, { openedAt: "2026-10-31T23:05:00Z" });
    await report(device, { openedAt: "2026-10-31T22:50:00Z" }); // 23:50 on 31 October in Copenhagen
    expect((await rulesEmergency(device)).used).toEqual({ month: "2026-11", count: 2 });
    h.clock.now = new Date("2026-10-31T22:30:00Z");
    expect((await rulesEmergency(device)).used).toEqual({ month: "2026-10", count: 1 });
    h.clock.now = new Date("2026-11-30T22:59:00Z");
    expect((await rulesEmergency(device)).used).toEqual({ month: "2026-11", count: 2 });
    h.clock.now = new Date("2026-11-30T23:00:00Z");
    expect((await rulesEmergency(device)).used).toEqual({ month: "2026-12", count: 0 });
  });

  it("is not thrown by daylight saving time", () => {
    // Fall back (25 Oct 2026) and spring forward (29 Mar 2026) stay inside their own month.
    expect(monthKey(new Date("2026-10-25T00:30:00Z"), "Europe/Copenhagen")).toBe("2026-10");
    expect(monthKey(new Date("2026-10-25T01:30:00Z"), "Europe/Copenhagen")).toBe("2026-10");
    expect(monthKey(new Date("2026-03-29T00:59:00Z"), "Europe/Copenhagen")).toBe("2026-03");
    expect(monthKey(new Date("2026-03-29T01:00:00Z"), "Europe/Copenhagen")).toBe("2026-03");
    // 1 April 00:00 CEST is 31 March 22:00 UTC.
    expect(monthKey(new Date("2026-03-31T21:59:00Z"), "Europe/Copenhagen")).toBe("2026-03");
    expect(monthKey(new Date("2026-03-31T22:00:00Z"), "Europe/Copenhagen")).toBe("2026-04");
    // A zone behind UTC and one that is ahead.
    expect(monthKey(new Date("2026-12-01T03:00:00Z"), "America/Los_Angeles")).toBe("2026-11");
    expect(monthKey(new Date("2026-11-30T12:30:00Z"), "Pacific/Auckland")).toBe("2026-12");
  });

  it("lists the last 90 days, newest first, and drops older ones", async () => {
    const { me, phoneId, device } = await selfPhone();
    const day = 86_400_000;
    await report(device, { openedAt: new Date(h.clock.now.getTime() - 100 * day).toISOString() });
    await report(device, { openedAt: new Date(h.clock.now.getTime() - 2 * day).toISOString(), packageName: "com.example.first" });
    await report(device, { openedAt: new Date(h.clock.now.getTime() - 1 * day).toISOString(), packageName: "com.example.second" });
    const list = (await me.get(`/api/phones/${phoneId}/emergency-openings`)).json.openings;
    expect(list.map((o: { packageName: string }) => o.packageName)).toEqual(["com.example.second", "com.example.first"]);
  });
});

describe("emergency openings: the trusted person is told", () => {
  it("pushes once per opening to the trusted person, not to the owner", async () => {
    const { me, phoneId, device } = await selfPhone();
    await me.post("/api/notifications/subscriptions", { platform: "web", endpoint: EP + "owner", keys: pushKeys, label: "Mine" });
    const helper = await withTrustedPerson(phoneId);
    await h.ctx.db.update(selfKeys).set({ emergencyEnabled: true, emergencyAllowance: 3 }).where(eq(selfKeys.phoneId, phoneId));
    const id = uuid();
    await report(device, { id });
    await report(device, { id });
    const sent = h.parentPush.sent.filter((s) => s.msg.tag === `emergency-${phoneId}`);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ endpoint: EP + "helper", msg: { title: "My phone: emergency opening", url: "/approvals" } });
    expect(sent[0]!.msg.body).toContain("1 of 3 used this month");
    void helper;
  });

  it("shows the helper the switch, the count and the openings under People I help, and nobody else", async () => {
    const { me, phoneId, device } = await selfPhone();
    const helper = await withTrustedPerson(phoneId);
    await report(device);
    const people = (await helper.get("/api/people-i-help")).json.people;
    expect(people).toHaveLength(1);
    expect(people[0].emergency).toMatchObject({ enabled: false, allowance: 3, used: { month: "2026-11", count: 1 } });
    expect(people[0].emergency.openings).toHaveLength(1);
    const stranger = await signIn(h, "stranger@example.org");
    expect((await stranger.get("/api/people-i-help")).json.people).toEqual([]);
    void me;
  });

  it("does not push when there is no trusted person yet, and a failed push never fails the report", async () => {
    const { phoneId, device } = await selfPhone();
    expect((await report(device)).status).toBe(204);
    expect(h.parentPush.sent.filter((s) => s.msg.tag === `emergency-${phoneId}`)).toHaveLength(0);
  });
});
