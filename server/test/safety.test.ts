// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { locations, phones, safetyRequests } from "../src/db/schema.js";
import { alwaysUntil } from "../src/services/safety.js";
import { sweep } from "../src/services/sweeper.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

async function setup(profile: "child" | "self" = "child") {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile });
  return { parent, phoneId, device };
}

async function publishCheckin() {
  h.clock.advance(1_000);
  await sweep(h.ctx);
}

const fix = (at: Date) => ({ lat: 55.6, lon: 12.5, accuracyM: 15, recordedAt: at.toISOString() });

describe("location modes", () => {
  it("discards a position when sharing is disabled after device authentication", async () => {
    const { parent, phoneId, device } = await setup();
    const mode = `/api/phones/${phoneId}/location/mode`;
    expect((await parent.put(mode, { mode: "always", alwaysFor: "hour" })).status).toBe(200);
    const request = new Request("https://app.example.test/api/device/location", {
      method: "PUT",
      headers: { authorization: `Bearer ${device.token}`, "content-type": "application/json" },
      body: JSON.stringify(fix(h.clock.now)),
    });
    const read = request.text.bind(request);
    request.text = async () => {
      expect((await parent.put(mode, { mode: "off" })).status).toBe(200);
      return read();
    };
    expect((await h.app.fetch(request)).status).toBe(409);
    expect(await h.ctx.db.select().from(locations)).toHaveLength(0);
  });

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

    // "always" is never open-ended.
    expect((await parent.put(`/api/phones/${phoneId}/location/mode`, { mode: "always" })).status).toBe(400);
    const r = await parent.put(`/api/phones/${phoneId}/location/mode`, { mode: "always", alwaysFor: "hour" });
    expect(r.status).toBe(200);
    expect(r.json.alwaysUntil).toBe(new Date(h.clock.now.getTime() + 60 * 60_000).toISOString());
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

    // A Find that was never answered is over after 30 minutes.
    await parent.put(`/api/phones/${phoneId}/location/mode`, { mode: "find" });
    expect((await parent.post(`/api/phones/${phoneId}/locate`)).status).toBe(202);
    h.clock.advance(31 * 60_000);
    expect((await device.put("/api/device/location", fix(h.clock.now))).status).toBe(409);

    // The old boolean still works and maps to the child default.
    await parent.patch(`/api/phones/${phoneId}`, { locationEnabled: false });
    await parent.patch(`/api/phones/${phoneId}`, { locationEnabled: true });
    expect((await parent.get(`/api/phones/${phoneId}/location`)).json.mode).toBe("checkin");
  });
});

describe("always, for a while", () => {
  it("falls back to Find and check-in by itself when the time is up", async () => {
    const { parent, phoneId, device } = await setup();
    await parent.put(`/api/phones/${phoneId}/location/mode`, { mode: "always", alwaysFor: "hour" });
    const rules = (await device.get("/api/device/rules")).json;
    expect(rules.location.mode).toBe("always");
    expect(rules.location.alwaysUntil).not.toBeNull();

    h.clock.advance(60 * 60_000);
    // Past the end the server stops taking positions, even before the sweeper ran.
    expect((await device.put("/api/device/location", fix(h.clock.now))).status).toBe(409);
    const r = await sweep(h.ctx);
    expect(r.alwaysEnded).toBe(1);
    const after = (await parent.get(`/api/phones/${phoneId}/location`)).json;
    expect(after.mode).toBe("checkin");
    expect(after.alwaysUntil).toBeNull();
    expect((await device.get("/api/device/rules")).json.location.mode).toBe("checkin");

    // An "always" without an end (no code writes one) counts as ended, too.
    await h.ctx.db.update(phones).set({ locationMode: "always", locationAlwaysUntil: null }).where(eq(phones.id, phoneId));
    expect((await device.put("/api/device/location", fix(h.clock.now))).status).toBe(409);
    expect((await sweep(h.ctx)).alwaysEnded).toBe(1);
  });

  it("ends today at the phone's local midnight, and a week after 7 days", () => {
    // 22:30 in Copenhagen in winter (UTC+1) -> midnight is 23:00 UTC.
    const now = new Date("2026-12-01T21:30:00Z");
    expect(alwaysUntil("today", "Europe/Copenhagen", now).toISOString()).toBe("2026-12-01T23:00:00.000Z");
    // The day the clocks go back (25 hours long) still ends at local midnight.
    expect(alwaysUntil("today", "Europe/Copenhagen", new Date("2026-10-25T10:00:00Z")).toISOString()).toBe(
      "2026-10-25T23:00:00.000Z",
    );
    expect(alwaysUntil("week", "Europe/Copenhagen", now).toISOString()).toBe("2026-12-08T21:30:00.000Z");
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
    const ringing = await device.get("/api/device/rules");
    expect(ringing.json.ring).toMatchObject({ id, stopOnAnswer: false, answered: true });
    const conditional = { "if-none-match": ringing.headers.get("etag")! };
    expect((await device.get("/api/device/rules", conditional)).status).toBe(304);
    h.clock.advance(5 * 60_000);
    const expired = await device.get("/api/device/rules", conditional);
    expect(expired.status).toBe(200);
    expect(expired.json.ring).toBeNull();
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
    // ...at the normal pace: no precise fix every 10 seconds while it looks for one.
    expect(rules.pollSeconds).toBe(60);
    expect((await parent.get(`/api/phones/${phoneId}/location`)).json.checkin.status).toBe("noReply");

    expect((await device.put("/api/device/location", fix(h.clock.now))).status).toBe(204);
    await publishCheckin();
    const seen = (await parent.get(`/api/phones/${phoneId}/location`)).json;
    expect(seen.checkin.locatedAt).not.toBeNull();
    expect(seen.location.lat).toBe(55.6);
    // One position, not a stream.
    expect((await device.get("/api/device/rules")).json.checkIn).toBeNull();
    h.clock.advance(60_000);
    expect((await device.put("/api/device/location", fix(h.clock.now))).status).toBe(409);
  });

  it("only locates a check-in with a fresh fix for that request", async () => {
    const { parent, phoneId, device } = await setup();
    const stale = fix(h.clock.now);
    h.clock.advance(60_000);
    const { checkin } = (await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 5 })).json;
    const before = await device.get("/api/device/rules");
    expect(before.json.checkIn.locationDue).toBe(false);
    h.clock.advance(5 * 60_000);

    const status = async () => (await parent.get(`/api/phones/${phoneId}/location`)).json.checkin;
    expect((await status()).locatedAt).toBeNull();
    expect((await device.put("/api/device/location", {
      ...stale, purpose: `checkin:${checkin.id}`,
    })).status).toBe(400);

    const due = await device.get("/api/device/rules", { "if-none-match": before.headers.get("etag")! });
    expect(due.status).toBe(200);
    expect(due.json.checkIn.locationDue).toBe(true);

    await parent.post(`/api/phones/${phoneId}/locate`);
    const requestedAt = h.clock.now.getTime();
    h.clock.advance(60_001);
    const overlap = (await device.get("/api/device/rules")).json;
    expect(overlap.location.requestedAt).toBe(new Date(requestedAt).toISOString());
    expect(overlap.checkIn).toMatchObject({ id: checkin.id, locationDue: true });
    expect(Date.parse(overlap.checkIn.deadline)).toBeLessThan(h.clock.now.getTime());

    expect((await device.put("/api/device/location", {
      ...fix(h.clock.now), purpose: `find:${requestedAt}`,
    })).status).toBe(204);
    expect((await status()).locatedAt).toBeNull();
    const afterFind = (await device.get("/api/device/rules")).json;
    expect(afterFind.location.requestedAt).toBeNull();
    expect(afterFind.checkIn).toMatchObject({ id: checkin.id, locationDue: true });

    h.clock.advance(1);
    await parent.post(`/api/phones/${phoneId}/locate`);
    expect((await device.put("/api/device/location", {
      ...fix(h.clock.now), purpose: `checkin:${checkin.id}`,
    })).status).toBe(204);
    expect((await device.get("/api/device/rules")).json.location.requestedAt).toBe(h.clock.now.toISOString());
    await publishCheckin();
    expect((await status()).locatedAt).not.toBeNull();
  });

  it("completes Find and check-in from the legacy client's single precise upload", async () => {
    const { parent, phoneId, device } = await setup();
    const { checkin } = (await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 5 })).json;
    h.clock.advance(4 * 60_000);
    await parent.post(`/api/phones/${phoneId}/locate`);
    h.clock.advance(2 * 60_000);

    // The legacy SyncRunner sees both requests and sends one untagged fix.
    const { json: rules } = await device.get("/api/device/rules");
    expect(rules.location.requestedAt).not.toBeNull();
    expect(rules.checkIn).toMatchObject({ id: checkin.id, sendLocation: true });
    expect(Date.parse(rules.checkIn.deadline)).toBeLessThan(h.clock.now.getTime());
    expect((await device.put("/api/device/location", fix(h.clock.now))).status).toBe(204);

    const receivedAt = h.clock.now.toISOString();
    await publishCheckin();
    // The client marks both as handled locally after that attempt.
    const seen = (await parent.get(`/api/phones/${phoneId}/location`)).json;
    expect(seen.checkin.locatedAt).toBe(receivedAt);
    const after = (await device.get("/api/device/rules")).json;
    expect(after.location.requestedAt).toBeNull();
    expect(after.checkIn).toBeNull();
  });

  it("accepts an untagged fix recorded before check-in creation", async () => {
    const { parent, phoneId, device } = await setup();
    const oldFix = fix(h.clock.now);
    h.clock.advance(60_000);
    await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 5 });
    h.clock.advance(3 * 60_000 - 1);
    expect((await device.put("/api/device/location", oldFix)).status).toBe(409);
    h.clock.advance(1);
    expect((await device.put("/api/device/location", oldFix)).status).toBe(204);
    await publishCheckin();
    expect((await parent.get(`/api/phones/${phoneId}/location`)).json.location).toBeNull();

    h.clock.advance(2 * 60_000);
    await sweep(h.ctx);
    const seen = (await parent.get(`/api/phones/${phoneId}/location`)).json;
    expect(seen.checkin.locatedAt).not.toBeNull();
    expect(seen.location.recordedAt).toBe(oldFix.recordedAt);
  });

  it.each(["find", "always"])("accepts an early untagged fix for %s and check-in", async (mode) => {
    const { parent, phoneId, device } = await setup();
    if (mode === "always") {
      await parent.put(`/api/phones/${phoneId}/location/mode`, { mode, alwaysFor: "hour" });
    }
    await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 1 });
    const deadline = new Date(h.clock.now.getTime() + 60_000).toISOString();
    if (mode === "find") await parent.post(`/api/phones/${phoneId}/locate`);
    h.clock.advance(5_000);
    const earlyFix = fix(h.clock.now);
    expect((await device.put("/api/device/location", earlyFix)).status).toBe(204);
    const status = async () => (await parent.get(`/api/phones/${phoneId}/location`)).json;
    expect((await status()).location.recordedAt).toBe(earlyFix.recordedAt);
    expect((await status()).checkin.locatedAt).toBeNull();
    h.clock.advance(56_000);
    await sweep(h.ctx);
    // Located as of the deadline, not the earlier upload time.
    expect((await status()).checkin.locatedAt).toBe(deadline);
  });

  it("lets the answer win when a location upload commits first in the same second", async () => {
    const { parent, phoneId, device } = await setup();
    const { checkin } = (await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 1 })).json;
    h.clock.advance(60_000);
    expect((await device.put("/api/device/location", {
      ...fix(h.clock.now), purpose: `checkin:${checkin.id}`,
    })).status).toBe(204);
    expect(await h.ctx.db.select().from(locations)).toHaveLength(0);
    await sweep(h.ctx);
    h.clock.advance(500);
    expect((await device.post(`/api/device/safety/${checkin.id}`, { event: "ok" })).status).toBe(204);
    h.clock.advance(500);
    await sweep(h.ctx);
    const seen = (await parent.get(`/api/phones/${phoneId}/location`)).json;
    expect(seen.checkin).toMatchObject({ status: "answered", locatedAt: null });
    expect(seen.location).toBeNull();
  });

  it("accepts an untagged check-in fix from a legacy clock five seconds ahead", async () => {
    const { parent, phoneId, device } = await setup();
    await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 1 });
    const deadline = new Date(h.clock.now.getTime() + 60_000).toISOString();
    h.clock.advance(55_000);
    const deadlineFix = fix(new Date(h.clock.now.getTime() + 5_000));

    expect((await device.get("/api/device/rules")).json.checkIn.locationDue).toBe(false);
    expect((await device.put("/api/device/location", deadlineFix)).status).toBe(204);
    const beforeDeadline = (await parent.get(`/api/phones/${phoneId}/location`)).json;
    expect(beforeDeadline.location).toBeNull();
    expect(beforeDeadline.checkin.locatedAt).toBeNull();
    h.clock.advance(5_000);
    await publishCheckin();
    const seen = (await parent.get(`/api/phones/${phoneId}/location`)).json;
    // Received five seconds early, but the position is shown as of the deadline, never before it.
    expect(seen.checkin.locatedAt).toBe(deadline);
    expect(seen.location.recordedAt).toBe(deadlineFix.recordedAt);
  });

  it("answers 400, not 409, to a tagged fix recorded between creation and the deadline", async () => {
    const { parent, phoneId, device } = await setup();
    const { checkin } = (await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 5 })).json;
    h.clock.advance(5 * 60_000 + 1_000);
    const early = await device.put("/api/device/location", {
      ...fix(new Date(h.clock.now.getTime() - 30_000)), purpose: `checkin:${checkin.id}`,
    });
    expect(early.status).toBe(400);
    expect((await device.put("/api/device/location", {
      ...fix(h.clock.now), purpose: `checkin:${checkin.id}`,
    })).status).toBe(204);
  });

  it("rejects a tagged fix five seconds into a one-minute check-in", async () => {
    const { parent, phoneId, device } = await setup();
    const { checkin } = (await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 1 })).json;
    h.clock.advance(5_000);
    expect((await device.get("/api/device/rules")).json.checkIn.locationDue).toBe(false);
    expect((await device.put("/api/device/location", {
      ...fix(h.clock.now), purpose: `checkin:${checkin.id}`,
    })).status).toBe(409);
    const seen = (await parent.get(`/api/phones/${phoneId}/location`)).json;
    expect(seen.checkin.locatedAt).toBeNull();
    expect(seen.location).toBeNull();
  });

  it.each([true, false])("rejects a check-in fix after an answer (tagged: %s)", async (tagged) => {
    const { parent, phoneId, device } = await setup();
    const { checkin } = (await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 1 })).json;
    h.clock.advance(60_000);
    expect((await device.post(`/api/device/safety/${checkin.id}`, { event: "ok" })).status).toBe(204);
    expect((await device.put("/api/device/location", {
      ...fix(h.clock.now), ...(tagged ? { purpose: `checkin:${checkin.id}` } : {}),
    })).status).toBe(409);
    await publishCheckin();
    expect((await parent.get(`/api/phones/${phoneId}/location`)).json.location).toBeNull();
  });

  it("lets an answer at the deadline win over a concurrent location upload", async () => {
    const { parent, phoneId, device } = await setup();
    const { checkin } = (await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 1 })).json;
    h.clock.advance(60_000);
    const [answer, upload] = await Promise.all([
      device.post(`/api/device/safety/${checkin.id}`, { event: "ok" }),
      device.put("/api/device/location", { ...fix(h.clock.now), purpose: `checkin:${checkin.id}` }),
    ]);
    expect(answer.status).toBe(204);
    expect([204, 409]).toContain(upload.status);
    await publishCheckin();
    const seen = (await parent.get(`/api/phones/${phoneId}/location`)).json;
    expect(seen.checkin).toMatchObject({ status: "answered", locatedAt: null });
    expect(seen.location).toBeNull();
  });

  it.each([true, false])("lets a reply waiting on the upload's row lock discard its pending fix (tagged: %s)", async (tagged) => {
    const { parent, phoneId, device } = await setup();
    const { checkin } = (await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 1 })).json;
    h.clock.advance(60_000);
    const staged = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const transaction = h.ctx.db.transaction.bind(h.ctx.db);
    const hold = vi.spyOn(h.ctx.db, "transaction").mockImplementationOnce((run, config) =>
      transaction(async (tx) => {
        const result = await run(tx);
        staged.resolve();
        await release.promise;
        return result;
      }, config),
    );
    const upload = device.put("/api/device/location", {
      ...fix(h.clock.now), ...(tagged ? { purpose: `checkin:${checkin.id}` } : {}),
    });
    let answer: ReturnType<typeof device.post> | undefined;
    try {
      await Promise.race([staged.promise, upload]);
      answer = device.post(`/api/device/safety/${checkin.id}`, { event: "ok" });
      await vi.waitFor(async () => {
        const [row] = await h.ctx.db.execute<{ waiting: boolean }>(sql`
          select exists (
            select from pg_stat_activity where wait_event_type = 'Lock'
            and query like 'update "safety_requests"%' and query like '%"answered_at"%'
          ) as waiting
        `);
        expect(row?.waiting).toBe(true);
      });
    } finally {
      release.resolve();
      hold.mockRestore();
      await Promise.all([answer, upload]);
    }
    expect((await upload).status).toBe(204);
    expect((await answer)?.status).toBe(204);
    await publishCheckin();
    const seen = (await parent.get(`/api/phones/${phoneId}/location`)).json;
    expect(seen.checkin).toMatchObject({ status: "answered", locatedAt: null });
    expect(seen.location).toBeNull();
  });

  it("discards a staged fix on cancellation and keeps the earlier Find fix", async () => {
    const { parent, phoneId, device } = await setup();
    await parent.post(`/api/phones/${phoneId}/locate`);
    const find = fix(h.clock.now);
    expect((await device.put("/api/device/location", {
      ...find, purpose: `find:${h.clock.now.getTime()}`,
    })).status).toBe(204);
    const { checkin } = (await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 1 })).json;
    h.clock.advance(60_000);
    expect((await device.put("/api/device/location", {
      ...fix(h.clock.now), purpose: `checkin:${checkin.id}`,
    })).status).toBe(204);
    await parent.del(`/api/phones/${phoneId}/checkin`);
    await publishCheckin();

    const seen = (await parent.get(`/api/phones/${phoneId}/location`)).json;
    expect(seen.checkin).toMatchObject({ status: "cancelled", locatedAt: null });
    expect(seen.location.recordedAt).toBe(find.recordedAt);
    expect((await h.ctx.db.select().from(safetyRequests))[0]?.pendingLocation).toBeNull();
  });

  it("rejects a check-in fix after cancellation even when Find is open", async () => {
    const { parent, phoneId, device } = await setup();
    const { checkin } = (await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 1 })).json;
    await parent.del(`/api/phones/${phoneId}/checkin`);
    await parent.post(`/api/phones/${phoneId}/locate`);
    const requestedAt = h.clock.now.getTime();
    h.clock.advance(60_000);
    expect((await device.put("/api/device/location", {
      ...fix(h.clock.now), purpose: `checkin:${checkin.id}`,
    })).status).toBe(409);
    expect(await h.ctx.db.select().from(locations)).toHaveLength(0);
    expect((await device.put("/api/device/location", {
      ...fix(h.clock.now), purpose: `find:${requestedAt}`,
    })).status).toBe(204);
    const seen = (await parent.get(`/api/phones/${phoneId}/location`)).json;
    expect(seen.checkin).toMatchObject({ status: "cancelled", locatedAt: null });
    expect(seen.location.recordedAt).toBe(h.clock.now.toISOString());
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
    await publishCheckin();
    await sweep(h.ctx);
    expect(titles().slice(1)).toEqual(["No answer from Alma"]);
    expect(h.parentPush.sent.at(-1)!.msg.body).toBe("The phone is sending its position.");
    await device.put("/api/device/location", fix(h.clock.now));
    await device.put("/api/device/location", fix(h.clock.now));
    await publishCheckin();
    expect(titles().slice(2)).toEqual(["Position of Alma"]);
    expect(h.parentPush.sent.at(-1)!.msg.url).toBe(`/phones/${phoneId}/location`);
  });

  it("waits for the server deadline before notifying about an early legacy fix", async () => {
    const { parent, phoneId, device } = await setup();
    await sub(parent);
    await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 1 });
    h.clock.advance(55_000);
    const deadlineFix = fix(new Date(h.clock.now.getTime() + 5_000));
    expect((await device.put("/api/device/location", deadlineFix)).status).toBe(204);
    await sweep(h.ctx);
    expect(titles()).toEqual([]);

    h.clock.advance(5_000);
    await publishCheckin();
    await sweep(h.ctx);
    expect(titles()).toEqual(["Position of Alma"]);
  });

  it("does not report no answer when the child answers after an early legacy fix", async () => {
    const { parent, phoneId, device } = await setup();
    await sub(parent);
    const { checkin } = (await parent.post(`/api/phones/${phoneId}/checkin`, { minutes: 1 })).json;
    h.clock.advance(55_000);
    expect((await device.put("/api/device/location", fix(new Date(h.clock.now.getTime() + 5_000)))).status).toBe(204);
    expect((await device.post(`/api/device/safety/${checkin.id}`, { event: "ok" })).status).toBe(204);
    h.clock.advance(5_000);
    await publishCheckin();
    expect(titles()).toEqual([`Alma: "Yes, I'm okay"`]);
    expect(await h.ctx.db.select().from(locations)).toHaveLength(0);
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
