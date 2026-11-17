// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { locations, safetyRequests } from "../src/db/schema.js";
import { sweep } from "../src/services/sweeper.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

async function setup(profile: "child" | "self" = "child") {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile });
  return { parent, phoneId, device };
}

const fix = (at: Date) => ({ lat: 55.6, lon: 12.5, accuracyM: 15, recordedAt: at.toISOString() });

describe("location modes", () => {
  it("defaults to Find and check-in for a child, and off for Self", async () => {
    const child = await setup();
    const c = (await child.parent.get(`/api/phones/${child.phoneId}/location`)).json;
    expect(c.mode).toBe("checkin");
    expect(c.enabled).toBe(true);
    const rules = (await child.device.get("/api/device/rules")).json;
    expect(rules.location.mode).toBe("checkin");
    // Older phones read only enabled + intervalMinutes: they get a day, not 5 minutes.
    expect(rules.location.intervalMinutes).toBe(24 * 60);

    const other = await signIn(h, "self@example.org");
    const self = await pairPhone(h, other, { profile: "self" });
    expect((await other.get(`/api/phones/${self.phoneId}/location`)).json.mode).toBe("off");
  });

  it("refuses unasked positions outside always, and turning off deletes the position", async () => {
    const { parent, phoneId, device } = await setup();
    expect((await device.put("/api/device/location", fix(h.clock.now))).status).toBe(409);

    const r = await parent.put(`/api/phones/${phoneId}/location/mode`, { mode: "always" });
    expect(r.status).toBe(200);
    expect(r.json.mode).toBe("always");
    expect((await device.get("/api/device/rules")).json.location.intervalMinutes).toBe(5);
    expect((await device.put("/api/device/location", fix(h.clock.now))).status).toBe(204);

    await parent.put(`/api/phones/${phoneId}/location/mode`, { mode: "find" });
    expect(await h.ctx.db.select().from(locations)).toHaveLength(1);
    await parent.put(`/api/phones/${phoneId}/location/mode`, { mode: "off" });
    expect(await h.ctx.db.select().from(locations)).toHaveLength(0);
    expect((await parent.get(`/api/phones/${phoneId}`)).json.locationEnabled).toBe(false);
    expect((await parent.post(`/api/phones/${phoneId}/locate`)).status).toBe(409);
    expect((await parent.put(`/api/phones/${phoneId}/location/mode`, { mode: "sometimes" })).status).toBe(400);

    // The old boolean still works and maps to the child default.
    await parent.patch(`/api/phones/${phoneId}`, { locationEnabled: true });
    expect((await parent.get(`/api/phones/${phoneId}/location`)).json.mode).toBe("checkin");
  });
});

describe("ring the phone", () => {
  it("rings until the child answers, polls fast meanwhile, and stops after 5 minutes at the latest", async () => {
    const { parent, phoneId, device } = await setup();
    const start = await parent.post(`/api/phones/${phoneId}/ring`, {});
    expect(start.status).toBe(202);
    expect(start.json.ring.active).toBe(true);
    expect(start.json.ring.stopOnAnswer).toBe(true);

    const rules = (await device.get("/api/device/rules")).json;
    expect(rules.ring.id).toBe(start.json.ring.id);
    expect(rules.pollSeconds).toBe(10);

    expect((await device.post(`/api/device/safety/${rules.ring.id}`, { event: "shown" })).status).toBe(204);
    expect((await parent.get(`/api/phones/${phoneId}/location`)).json.ring.shownAt).not.toBeNull();
    expect((await device.post(`/api/device/safety/${rules.ring.id}`, { event: "ok" })).status).toBe(400);
    expect((await device.post(`/api/device/safety/${rules.ring.id}`, { event: "here" })).status).toBe(204);

    const after = (await device.get("/api/device/rules")).json;
    expect(after.ring).toBeNull();
    expect(after.pollSeconds).toBe(60);
    const seen = (await parent.get(`/api/phones/${phoneId}/location`)).json.ring;
    expect(seen.active).toBe(false);
    expect(seen.answeredAt).not.toBeNull();

    // "Keep ringing for 5 minutes": an answer does not stop it, the parent or the clock does.
    const keep = await parent.post(`/api/phones/${phoneId}/ring`, { stopOnAnswer: false });
    const id = keep.json.ring.id;
    await device.post(`/api/device/safety/${id}`, { event: "here" });
    const ringing = (await device.get("/api/device/rules")).json.ring;
    expect(ringing).toMatchObject({ id, stopOnAnswer: false, answered: true });
    h.clock.advance(5 * 60_000);
    expect((await device.get("/api/device/rules")).json.ring).toBeNull();
  });

  it("can be stopped from the dashboard", async () => {
    const { parent, phoneId, device } = await setup();
    await parent.post(`/api/phones/${phoneId}/ring`, { stopOnAnswer: false });
    const stop = await parent.del(`/api/phones/${phoneId}/ring`);
    expect(stop.status).toBe(200);
    expect(stop.json.ring.active).toBe(false);
    expect(stop.json.ring.stoppedAt).not.toBeNull();
    expect((await device.get("/api/device/rules")).json.ring).toBeNull();
    // Only one ring row per phone, however often the parent presses.
    await parent.post(`/api/phones/${phoneId}/ring`, {});
    await parent.post(`/api/phones/${phoneId}/ring`, {});
    expect(await h.ctx.db.select().from(safetyRequests)).toHaveLength(1);
  });

  it("is not reachable from another household or another phone", async () => {
    const a = await setup();
    const stranger = await signIn(h, "stranger@example.org");
    expect((await stranger.post(`/api/phones/${a.phoneId}/ring`, {})).status).toBe(404);
    const ring = (await a.parent.post(`/api/phones/${a.phoneId}/ring`, {})).json.ring;
    const b = await pairPhone(h, stranger);
    expect((await b.device.post(`/api/device/safety/${ring.id}`, { event: "here" })).status).toBe(404);
    expect((await b.device.post(`/api/device/safety/not-a-uuid`, { event: "here" })).status).toBe(404);
  });
});

describe("are you okay?", () => {
  it("sends no position when the child answers", async () => {
    const { parent, phoneId, device } = await setup();
    const r = await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 10 });
    expect(r.status).toBe(202);
    expect(r.json.checkin).toMatchObject({ status: "waiting", sendsLocation: true });
    const rules = (await device.get("/api/device/rules")).json;
    expect(rules.checkIn).toMatchObject({ id: r.json.checkin.id, sendLocation: true, callNumber: null });
    expect(rules.pollSeconds).toBe(10);

    expect((await device.post(`/api/device/safety/${rules.checkIn.id}`, { event: "ok" })).status).toBe(204);
    expect((await device.get("/api/device/rules")).json.checkIn).toBeNull();
    h.clock.advance(11 * 60_000);
    expect((await device.put("/api/device/location", fix(h.clock.now))).status).toBe(409);
    const seen = (await parent.get(`/api/phones/${phoneId}/location`)).json;
    expect(seen.checkin).toMatchObject({ status: "answered", answer: "ok", locatedAt: null });
    expect(seen.location).toBeNull();
  });

  it("takes one position when nobody answers in time", async () => {
    const { parent, phoneId, device } = await setup();
    await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 5 });
    // Before the deadline the phone may not send anything.
    expect((await device.put("/api/device/location", fix(h.clock.now))).status).toBe(409);
    h.clock.advance(5 * 60_000);
    const rules = (await device.get("/api/device/rules")).json;
    expect(rules.checkIn).not.toBeNull(); // still listed: the phone owes its position
    expect((await parent.get(`/api/phones/${phoneId}/location`)).json.checkin.status).toBe("noReply");

    expect((await device.put("/api/device/location", fix(h.clock.now))).status).toBe(204);
    const seen = (await parent.get(`/api/phones/${phoneId}/location`)).json;
    expect(seen.checkin.locatedAt).not.toBeNull();
    expect(seen.location.lat).toBe(55.6);
    // One position, not a stream.
    expect((await device.get("/api/device/rules")).json.checkIn).toBeNull();
    h.clock.advance(60_000);
    expect((await device.put("/api/device/location", fix(h.clock.now))).status).toBe(409);
  });

  it("sends no position in Find-only mode, and the phone gives up after 30 minutes", async () => {
    const { parent, phoneId, device } = await setup();
    await parent.put(`/api/phones/${phoneId}/location/mode`, { mode: "find" });
    const c = (await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 5 })).json.checkin;
    expect(c.sendsLocation).toBe(false);
    h.clock.advance(5 * 60_000);
    expect((await device.get("/api/device/rules")).json.checkIn).toBeNull();
    expect((await device.put("/api/device/location", fix(h.clock.now))).status).toBe(409);

    await parent.put(`/api/phones/${phoneId}/location/mode`, { mode: "checkin" });
    await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 5 });
    h.clock.advance(36 * 60_000);
    expect((await device.get("/api/device/rules")).json.checkIn).toBeNull();
    expect((await device.put("/api/device/location", fix(h.clock.now))).status).toBe(409);
  });

  it("only offers call-back numbers from the approved contacts, and can be cancelled", async () => {
    const { parent, phoneId, device } = await setup();
    expect((await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 5, callNumber: "+4511111111" })).status).toBe(400);
    expect((await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 0 })).status).toBe(400);
    expect((await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 121 })).status).toBe(400);
    const contact = await parent.post(`/api/phones/${phoneId}/contacts`, { name: "Mum", number: "+4511111111" });
    expect(contact.status).toBeLessThan(300);
    const r = await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 15, callNumber: "+4511111111" });
    expect(r.status).toBe(202);
    expect((await device.get("/api/device/rules")).json.checkIn.callNumber).toBe("+4511111111");

    const stop = await parent.del(`/api/phones/${phoneId}/checkin`);
    expect(stop.json.checkin.status).toBe("cancelled");
    expect((await device.get("/api/device/rules")).json.checkIn).toBeNull();
    h.clock.advance(16 * 60_000);
    expect((await device.put("/api/device/location", fix(h.clock.now))).status).toBe(409);
  });

  it("is deleted by the sweeper a day after it ended", async () => {
    const { parent, phoneId } = await setup();
    await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 5 });
    await parent.post(`/api/phones/${phoneId}/ring`, {});
    h.clock.advance(23 * 60 * 60_000);
    await sweep(h.ctx);
    expect(await h.ctx.db.select().from(safetyRequests)).toHaveLength(2);
    h.clock.advance(2 * 60 * 60_000);
    const r = await sweep(h.ctx);
    expect(r.deleted.safety).toBe(2);
    expect(await h.ctx.db.select().from(safetyRequests)).toHaveLength(0);
  });
});

describe("notifications to the parents", () => {
  const sub = (c: Awaited<ReturnType<typeof signIn>>) =>
    c.post("/api/notifications/subscriptions", {
      platform: "web",
      endpoint: "https://fcm.googleapis.com/fcm/send/safety",
      keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
      label: "Chrome on Android",
    });
  const titles = () => h.parentPush.sent.map((s) => s.msg.title);

  it("tells the parents about answers, a missed deadline and the position, each once", async () => {
    const { parent, phoneId, device } = await setup();
    expect((await sub(parent)).status).toBeLessThan(300);

    const ring = (await parent.post(`/api/phones/${phoneId}/ring`, {})).json.ring;
    await device.post(`/api/device/safety/${ring.id}`, { event: "here" });
    await device.post(`/api/device/safety/${ring.id}`, { event: "here" });
    expect(titles()).toEqual([`Alma: "I'm here"`]);

    await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 5 });
    await sweep(h.ctx);
    expect(titles()).toHaveLength(1); // not due yet
    h.clock.advance(5 * 60_000);
    await sweep(h.ctx);
    await sweep(h.ctx);
    expect(titles().slice(1)).toEqual(["No answer from Alma"]);
    expect(h.parentPush.sent.at(-1)!.msg.body).toBe("The phone is sending its position.");
    await device.put("/api/device/location", fix(h.clock.now));
    await device.put("/api/device/location", fix(h.clock.now));
    expect(titles().slice(2)).toEqual(["Position of Alma"]);
    expect(h.parentPush.sent.at(-1)!.msg.url).toBe(`/phones/${phoneId}/location`);
  });

  it("says no position is coming in Find-only mode, and stays quiet after an answer", async () => {
    const { parent, phoneId, device } = await setup();
    await sub(parent);
    await parent.put(`/api/phones/${phoneId}/location/mode`, { mode: "find" });
    await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 5 });
    h.clock.advance(6 * 60_000);
    await sweep(h.ctx);
    expect(h.parentPush.sent.at(-1)!.msg.body).toBe('"Are you okay?" was not answered in time.');

    const c = (await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 5 })).json.checkin;
    await device.post(`/api/device/safety/${c.id}`, { event: "ok" });
    const n = h.parentPush.sent.length;
    h.clock.advance(6 * 60_000);
    await sweep(h.ctx);
    expect(h.parentPush.sent).toHaveLength(n);
    expect(h.parentPush.sent.at(-1)!.msg.title).toBe(`Alma: "Yes, I'm okay"`);
  });
});
