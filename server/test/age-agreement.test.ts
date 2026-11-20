// SPDX-License-Identifier: Apache-2.0
// Age presets, the review reminder and the family agreement (docs/age-presets.md,
// docs/family-agreement.md). The harness clock is fixed; every date here is set explicitly.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dnsSettings, phones, schedules, sessions, timeLimits } from "../src/db/schema.js";
import { sweep } from "../src/services/sweeper.js";
import { type Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

const EP = "https://fcm.googleapis.com/fcm/send/";
const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
const subscribe = (c: Client, id: string) =>
  c.post("/api/notifications/subscriptions", { platform: "web", endpoint: EP + id, keys, label: "Chrome" });

async function setup(email = "parent@example.org", profile: "child" | "self" = "child") {
  const parent = await signIn(h, email);
  const { phoneId, device } = await pairPhone(h, parent, { profile, name: "Sam" });
  return { parent, phoneId, device };
}

/** Moves the clock and keeps the parents' sessions valid across the jump. */
async function travelTo(iso: string) {
  h.clock.now = new Date(iso);
  await h.ctx.db.update(sessions).set({ expiresAt: new Date("2035-01-01T00:00:00Z") });
}

const reviewPushes = () => h.parentPush.sent.filter((s) => s.msg.tag?.startsWith("review-"));
const rules = async (device: Client) => (await device.get("/api/device/rules")).json;

describe("age presets", () => {
  it("lists the table once for every client", async () => {
    const { parent } = await setup();
    const { presets } = (await parent.get("/api/age-presets")).json;
    expect(presets.map((p: { id: string }) => p.id)).toEqual(["8-9", "10-11", "12-13", "14plus"]);
    expect(presets[0]).toMatchObject({ dailyMinutes: { weekday: 60, weekend: 90 }, school: { startMinute: 480, endMinute: 870 } });
  });

  it("leaves a phone untouched until a preset is applied", async () => {
    const { parent, phoneId } = await setup();
    const phone = (await parent.get(`/api/phones/${phoneId}`)).json;
    expect(phone).toMatchObject({ agePreset: null, reviewEnabled: false, reviewDueAt: null, reviewDue: false });
    expect(await h.ctx.db.select().from(timeLimits).where(eq(timeLimits.phoneId, phoneId))).toHaveLength(0);
    expect(await h.ctx.db.select().from(schedules).where(eq(schedules.phoneId, phoneId))).toHaveLength(0);
  });

  it("sets the existing rules and nothing is locked afterwards", async () => {
    const { parent, phoneId, device } = await setup();
    const r = await parent.post(`/api/phones/${phoneId}/age-preset`, { preset: "10-11" });
    expect(r.status).toBe(200);
    expect(r.json.agePreset).toBe("10-11");

    const [limit] = await h.ctx.db.select().from(timeLimits).where(eq(timeLimits.phoneId, phoneId));
    expect(limit).toMatchObject({ packageName: "*", minutes: 90, days: { "6": 120, "7": 120 } });
    const rows = await h.ctx.db.select().from(schedules).where(eq(schedules.phoneId, phoneId));
    expect(rows.map((s) => [s.kind, s.days, s.startMinute, s.endMinute]).sort()).toEqual([
      ["bedtime", [1, 2, 3, 4, 5, 6, 7], 1230, 420],
      ["school", [1, 2, 3, 4, 5], 480, 870],
    ]);
    const [dns] = await h.ctx.db.select().from(dnsSettings).where(eq(dnsSettings.phoneId, phoneId));
    expect([...dns!.blockedCategories].sort()).toEqual(["adult", "dating", "gambling", "social"]);

    // The parents can still change every value afterwards, and the preset is only a note of where they started.
    const edit = await parent.put(`/api/phones/${phoneId}/time-limits/total`, { minutes: 45 });
    expect(edit.status).toBeLessThan(300);
    expect((await h.ctx.db.select().from(timeLimits).where(eq(timeLimits.phoneId, phoneId)))[0]!.minutes).toBe(45);
  });

  it("moving to an older preset replaces the windows and unblocks what the preset leaves open", async () => {
    const { parent, phoneId } = await setup();
    await parent.post(`/api/phones/${phoneId}/age-preset`, { preset: "8-9" });
    await parent.post(`/api/phones/${phoneId}/age-preset`, { preset: "14plus" });
    const rows = await h.ctx.db.select().from(schedules).where(eq(schedules.phoneId, phoneId));
    // 14+ has no school window; bedtime is updated in place, not duplicated.
    expect(rows.map((s) => s.kind)).toEqual(["bedtime"]);
    expect(rows[0]!.startMinute).toBe(22 * 60);
    const [dns] = await h.ctx.db.select().from(dnsSettings).where(eq(dnsSettings.phoneId, phoneId));
    expect([...dns!.blockedCategories].sort()).toEqual(["adult", "gambling"]);
  });

  it("with modes on, fills in the normal rules and leaves the school and night slots alone", async () => {
    const { parent, phoneId, device } = await setup();
    await parent.post(`/api/phones/${phoneId}/schedules`, { kind: "school", days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 780, allowedPackages: [] });
    await parent.post(`/api/phones/${phoneId}/schedules`, { kind: "bedtime", days: [1, 2, 3, 4, 5, 6, 7], startMinute: 1380, endMinute: 360 });
    expect((await parent.patch(`/api/phones/${phoneId}`, { modesEnabled: true })).status).toBe(200);
    const view = async () => (await parent.get(`/api/phones/${phoneId}/modes`)).json;
    const before = await view();
    const windowsBefore = (await rules(device)).schedules;

    const r = await parent.post(`/api/phones/${phoneId}/age-preset`, { preset: "10-11" });
    expect(r.status).toBe(200);
    expect(r.json.agePreset).toBe("10-11");

    // The slots, the modes and the windows the phone gets are exactly as they were.
    expect((await view()).slots).toEqual(before.slots);
    expect((await view()).modes).toEqual(before.modes);
    expect((await rules(device)).schedules).toEqual(windowsBefore);
    // The stored windows, which come back when modes go off, are not rewritten either.
    const rows = await h.ctx.db.select().from(schedules).where(eq(schedules.phoneId, phoneId));
    expect(rows.map((s) => [s.kind, s.startMinute, s.endMinute]).sort()).toEqual([["bedtime", 1380, 360], ["school", 540, 780]]);

    // The normal rules (the default mode's) are filled in.
    const [limit] = await h.ctx.db.select().from(timeLimits).where(eq(timeLimits.phoneId, phoneId));
    expect(limit).toMatchObject({ packageName: "*", minutes: 90, days: { "6": 120, "7": 120 } });
    const [dns] = await h.ctx.db.select().from(dnsSettings).where(eq(dnsSettings.phoneId, phoneId));
    expect([...dns!.blockedCategories].sort()).toEqual(["adult", "dating", "gambling", "social"]);
  });

  it("is only for Child phones, and only for the household's own", async () => {
    const self = await setup("self@example.org", "self");
    expect((await self.parent.post(`/api/phones/${self.phoneId}/age-preset`, { preset: "8-9" })).status).toBe(404);
    expect((await self.parent.get(`/api/phones/${self.phoneId}/review`)).status).toBe(404);

    const a = await setup("a@example.org");
    const b = await signIn(h, "b@example.org");
    expect((await b.post(`/api/phones/${a.phoneId}/age-preset`, { preset: "8-9" })).status).toBe(404);
    expect((await b.put(`/api/phones/${a.phoneId}/review`, { enabled: true })).status).toBe(404);
    expect((await b.post(`/api/phones/${a.phoneId}/review/done`, {})).status).toBe(404);
    expect((await b.get(`/api/phones/${a.phoneId}/agreement`)).status).toBe(404);
    expect((await b.put(`/api/phones/${a.phoneId}/agreement`, { lines: ["Hello"] })).status).toBe(404);
    const [row] = await h.ctx.db.select().from(phones).where(eq(phones.id, a.phoneId));
    expect(row).toMatchObject({ agePreset: null, reviewEnabled: false, agreementLines: [] });
  });

  it("rejects an unknown preset", async () => {
    const { parent, phoneId } = await setup();
    expect((await parent.post(`/api/phones/${phoneId}/age-preset`, { preset: "5-6" })).status).toBe(400);
  });
});

describe("review date", () => {
  it("starts the clock three months out when turned on, and can be moved", async () => {
    const { parent, phoneId } = await setup();
    // 16 November 2026, 12:00 UTC (13:00 in Copenhagen).
    const on = (await parent.put(`/api/phones/${phoneId}/review`, { enabled: true })).json.review;
    expect(on).toMatchObject({ enabled: true, intervalMonths: 3, dueAt: "2027-02-16T08:00:00.000Z", due: false });

    const every6 = (await parent.put(`/api/phones/${phoneId}/review`, { intervalMonths: 6 })).json.review;
    expect(every6.dueAt).toBe("2027-05-16T07:00:00.000Z");

    const moved = (await parent.put(`/api/phones/${phoneId}/review`, { dueDate: "2026-12-24" })).json.review;
    expect(moved.dueAt).toBe("2026-12-24T08:00:00.000Z");

    expect((await parent.put(`/api/phones/${phoneId}/review`, { dueDate: "2026-11-15" })).status).toBe(400);
    expect((await parent.put(`/api/phones/${phoneId}/review`, { dueDate: "2026-02-30" })).status).toBe(400);
    expect((await parent.put(`/api/phones/${phoneId}/review`, { intervalMonths: 4 })).status).toBe(400);

    const off = (await parent.put(`/api/phones/${phoneId}/review`, { enabled: false })).json.review;
    expect(off).toMatchObject({ enabled: false, dueAt: null, due: false, suggestions: [] });
  });

  it("reminds once per date, by push and mail, with suggestions from the current rules", async () => {
    const { parent, phoneId } = await setup();
    await subscribe(parent, "p");
    await parent.post(`/api/phones/${phoneId}/age-preset`, { preset: "8-9" });
    await parent.put(`/api/phones/${phoneId}/review`, { enabled: true });
    h.mail.outbox.length = 0;

    await sweep(h.ctx);
    expect(reviewPushes()).toHaveLength(0);

    await travelTo("2027-02-16T08:00:00Z");
    await sweep(h.ctx);
    await sweep(h.ctx);
    expect(reviewPushes()).toHaveLength(1);
    expect(reviewPushes()[0]!.msg.title).toBe("Time to review Sam's rules");
    const mails = h.mail.outbox.filter((m) => m.subject === "Time to review the rules for Sam");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain("More time a day: from 1 h to 1 h 30 min.");
    expect(mails[0]!.text).toContain("released one day");

    const state = (await parent.get(`/api/phones/${phoneId}/age`)).json.review;
    expect(state).toMatchObject({ enabled: true, due: true });
    expect(state.suggestions[0]).toEqual({ kind: "time", from: 60, to: 90 });

    // Sending the same settings again is not a new date: no second reminder for the one already sent.
    await parent.put(`/api/phones/${phoneId}/review`, { enabled: true });
    await sweep(h.ctx);
    expect(reviewPushes()).toHaveLength(1);

    // "We looked at the rules" moves the date, and the next date is reminded again.
    const done = (await parent.post(`/api/phones/${phoneId}/review/done`, {})).json.review;
    expect(done).toMatchObject({ due: false, dueAt: "2027-05-16T07:00:00.000Z" });
    await travelTo("2027-05-16T07:00:00Z");
    await sweep(h.ctx);
    expect(reviewPushes()).toHaveLength(2);
  });

  it("follows the household's channel switches and stays quiet when the reminder is off", async () => {
    const { parent, phoneId } = await setup();
    await subscribe(parent, "p");
    const { id } = (await parent.get("/api/me")).json.households[0];
    await parent.patch(`/api/households/${id}/summary-settings`, { byMail: false, byPush: false });
    await parent.put(`/api/phones/${phoneId}/review`, { enabled: true });
    h.mail.outbox.length = 0;
    await travelTo("2027-03-01T00:00:00Z");
    await sweep(h.ctx);
    expect(reviewPushes()).toHaveLength(0);
    expect(h.mail.outbox.filter((m) => m.subject.startsWith("Time to review"))).toHaveLength(0);
    // The dashboard still shows that the date has come.
    expect((await parent.get(`/api/phones/${phoneId}`)).json.reviewDue).toBe(true);

    await parent.put(`/api/phones/${phoneId}/review`, { enabled: false });
    await parent.patch(`/api/households/${id}/summary-settings`, { byPush: true });
    await travelTo("2028-03-01T00:00:00Z");
    await sweep(h.ctx);
    expect(reviewPushes()).toHaveLength(0);
  });

  it("does not remind about a phone that is being released", async () => {
    const { parent, phoneId } = await setup();
    await subscribe(parent, "p");
    await parent.put(`/api/phones/${phoneId}/review`, { enabled: true });
    await h.ctx.db.update(phones).set({ releaseRequestedAt: h.clock.now }).where(eq(phones.id, phoneId));
    await travelTo("2027-03-01T00:00:00Z");
    await sweep(h.ctx);
    expect(reviewPushes()).toHaveLength(0);
  });
});

describe("family agreement", () => {
  it("is empty and absent from the rules until the family writes it", async () => {
    const { parent, phoneId, device } = await setup();
    expect((await parent.get(`/api/phones/${phoneId}/agreement`)).json).toEqual({
      lines: [], adultLines: [], enabled: true, onHome: false, updatedAt: null,
    });
    expect((await rules(device)).ageAgreement).toBeUndefined();
  });

  it("syncs through the rules, with the switches, and bumps the revision", async () => {
    const { parent, phoneId, device } = await setup();
    const r = await parent.put(`/api/phones/${phoneId}/agreement`, {
      lines: ["  We put phones away at dinner ", "", "Ask before downloading"],
      adultLines: ["Parents leave the phone in the hall at dinner too"],
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ lines: ["We put phones away at dinner", "Ask before downloading"], enabled: true, onHome: false });
    expect((await rules(device)).ageAgreement).toEqual({
      lines: ["We put phones away at dinner", "Ask before downloading"],
      adultLines: ["Parents leave the phone in the hall at dinner too"],
      onHome: false,
      updatedAt: "2026-11-16T12:00:00.000Z",
    });

    await parent.put(`/api/phones/${phoneId}/agreement`, { onHome: true });
    expect((await rules(device)).ageAgreement.onHome).toBe(true);

    // Off means the phone gets nothing, but the words are kept for when it is turned on again.
    await parent.put(`/api/phones/${phoneId}/agreement`, { enabled: false });
    expect((await rules(device)).ageAgreement).toBeUndefined();
    expect((await parent.get(`/api/phones/${phoneId}/agreement`)).json.lines).toHaveLength(2);
    await parent.put(`/api/phones/${phoneId}/agreement`, { enabled: true });
    expect((await rules(device)).ageAgreement.lines).toHaveLength(2);

    // Emptying both lists removes it from the rules even while the switch is on.
    await parent.put(`/api/phones/${phoneId}/agreement`, { lines: [], adultLines: [] });
    expect((await rules(device)).ageAgreement).toBeUndefined();
  });

  it("limits how much text there is, and strips control characters", async () => {
    const { parent, phoneId } = await setup();
    const tooMany = Array.from({ length: 9 }, (_, i) => `Rule ${i}`);
    expect((await parent.put(`/api/phones/${phoneId}/agreement`, { lines: tooMany })).status).toBe(400);
    expect((await parent.put(`/api/phones/${phoneId}/agreement`, { lines: ["x".repeat(141)] })).status).toBe(400);
    expect((await parent.put(`/api/phones/${phoneId}/agreement`, { adultLines: Array.from({ length: 6 }, () => "a") })).status).toBe(400);
    const ok = await parent.put(`/api/phones/${phoneId}/agreement`, { lines: ["One\u0000 two\nthree"] });
    expect(ok.json.lines).toEqual(["One two three"]);
  });

  it("is shown on the child's phone only, and never leaves the household", async () => {
    const a = await setup("a@example.org");
    const b = await setup("b@example.org");
    await a.parent.put(`/api/phones/${a.phoneId}/agreement`, { lines: ["Our rule"] });
    expect((await rules(b.device)).ageAgreement).toBeUndefined();
    const [row] = await h.ctx.db.select().from(phones).where(eq(phones.id, b.phoneId));
    expect(row!.agreementLines).toEqual([]);
  });
});
