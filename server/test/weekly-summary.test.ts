// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { householdMembers, householdSummaries, households, phoneRequests, phones, phoneUsageDays } from "../src/db/schema.js";
import { weeklySummaryMail } from "../src/lib/summary-mail.js";
import { toSummaryLocale } from "../src/lib/summary-text.js";
import { alertClass, batchedIntoSummary } from "../src/services/alert-policy.js";
import { sweep } from "../src/services/sweeper.js";
import { type SummaryData, sweepSummaries } from "../src/services/weekly-summary.js";
import { type Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

const EP = "https://fcm.googleapis.com/fcm/send/";
const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
const subscribe = (c: Client, id: string) =>
  c.post("/api/notifications/subscriptions", { platform: "web", endpoint: EP + id, keys, label: "Chrome" });

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

/** Pushes that are alerts, not the summary itself. */
const alerts = () => h.parentPush.sent.filter((s) => s.msg.tag !== "weekly-summary");

const SUNDAY_1800_CET = "2026-11-22T17:00:00Z";
const MONDAY = "2026-11-16T12:00:00Z";
const at = (iso: string) => {
  h.clock.now = new Date(iso);
};

/** A household with one parent (push on), set old enough that a week can be summed up. */
async function setup(name = "Phone A") {
  const mum = await signIn(h, "mum@example.org");
  await subscribe(mum, "mum");
  const { phoneId, device } = await pairPhone(h, mum, { name });
  const [phone] = await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId));
  const householdId = phone!.householdId;
  await h.ctx.db.update(households).set({ createdAt: new Date("2026-11-01T00:00:00Z") }).where(eq(households.id, householdId));
  return { mum, phoneId, device, householdId };
}

const summariesOf = async (householdId: string) =>
  h.ctx.db.select().from(householdSummaries).where(eq(householdSummaries.householdId, householdId));

describe("summary numbers", () => {
  it("sums use per day, takes the highest reading of a day and the top apps over the week", async () => {
    const { phoneId, device, householdId } = await setup();
    // Monday: use grows during the day. A later, lower reading (a restart of the count) must not lower it.
    at(MONDAY);
    await device.put("/api/device/status", status({ timeUsed: { "*": 60, "com.example.game": 40, "com.example.chat": 20 } }));
    at("2026-11-16T15:00:00Z");
    await device.put("/api/device/status", status({ timeUsed: { "*": 90, "com.example.game": 60, "com.example.chat": 20 } }));
    at("2026-11-16T16:00:00Z");
    await device.put("/api/device/status", status({ timeUsed: { "*": 10, "com.example.game": 5 } }));
    at("2026-11-17T12:00:00Z");
    await device.put("/api/device/status", status({ timeUsed: { "*": 120, "com.example.game": 100, "com.example.chat": 10 } }));
    // Wednesday: only the total is known (the app has no row).
    at("2026-11-18T12:00:00Z");
    await device.put("/api/device/status", status({ timeUsed: { "*": 30 } }));

    at("2026-11-22T17:00:00Z");
    await sweepSummaries(h.ctx);
    const [row] = await summariesOf(householdId);
    const data = row!.data as SummaryData;
    expect(data.phones).toHaveLength(1);
    const usage = data.phones[0]!.usage!;
    expect(usage.days).toEqual([
      { day: "2026-11-16", minutes: 90 },
      { day: "2026-11-17", minutes: 120 },
      { day: "2026-11-18", minutes: 30 },
    ]);
    // 240 minutes over the 3 days with a report, not over 7: 80 a day.
    expect(usage.averageMinutes).toBe(80);
    expect(usage.topApps).toEqual([
      { packageName: "com.example.game", label: "com.example.game", minutes: 160 },
      { packageName: "com.example.chat", label: "com.example.chat", minutes: 30 },
    ]);
    expect(await h.ctx.db.select().from(phoneUsageDays).where(eq(phoneUsageDays.phoneId, phoneId))).toHaveLength(3 + 2 + 2);
  });

  it("counts requests asked and answered inside the week only", async () => {
    const { phoneId, householdId } = await setup();
    const day = (d: string) => new Date(`2026-11-${d}Z`);
    await h.ctx.db.insert(phoneRequests).values([
      { phoneId, kind: "app", packageName: "com.example.a", createdAt: day("17T10:00:00") },
      { phoneId, kind: "app", packageName: "com.example.b", createdAt: day("18T10:00:00"), status: "approved", decidedAt: day("18T11:00:00") },
      { phoneId, kind: "contact", contactName: "Contact", contactNumber: "+4500000000", createdAt: day("19T10:00:00"), status: "rejected", decidedAt: day("20T09:00:00") },
      // Before the week: asked and answered earlier, so neither counts.
      { phoneId, kind: "app", packageName: "com.example.c", createdAt: day("10T10:00:00"), status: "approved", decidedAt: day("10T11:00:00") },
      // Asked before the week but answered inside it: only the answer counts.
      { phoneId, kind: "app", packageName: "com.example.d", createdAt: day("14T10:00:00"), status: "approved", decidedAt: day("21T10:00:00") },
    ]);
    at(SUNDAY_1800_CET);
    await sweepSummaries(h.ctx);
    const data = (await summariesOf(householdId))[0]!.data as SummaryData;
    expect(data.phones[0]!.requests).toEqual({ asked: 3, approved: 2, rejected: 1, byKind: { app: 2, contact: 1 } });
  });

  it("counts rule changes by category, whether applied at once or after a wait", async () => {
    const { mum, phoneId, householdId } = await setup();
    at("2026-11-17T10:00:00Z");
    expect((await mum.put(`/api/phones/${phoneId}/time-limits/total`, { minutes: 120 })).status).toBeLessThan(300);
    expect((await mum.put(`/api/phones/${phoneId}/time-limits/total`, { minutes: 90 })).status).toBeLessThan(300);
    expect((await mum.post(`/api/phones/${phoneId}/contacts`, { name: "Contact", number: "+4511111111" })).status).toBeLessThan(300);
    at(SUNDAY_1800_CET);
    await sweepSummaries(h.ctx);
    const data = (await summariesOf(householdId))[0]!.data as SummaryData;
    expect(data.phones[0]!.changes).toEqual({ total: 3, byCategory: { time: 2, contacts: 1 } });
  });

  it("leaves a phone out when its summary is switched off, and keeps no use for it", async () => {
    const { mum, phoneId, device, householdId } = await setup();
    const off = await mum.patch(`/api/phones/${phoneId}`, { weeklySummaryEnabled: false });
    expect(off.json.weeklySummaryEnabled).toBe(false);
    expect((await device.get("/api/device/rules")).json.weeklySummaryEnabled).toBe(false);
    at(MONDAY);
    await device.put("/api/device/status", status({ timeUsed: { "*": 60 } }));
    expect(await h.ctx.db.select().from(phoneUsageDays)).toHaveLength(0);
    at(SUNDAY_1800_CET);
    await sweepSummaries(h.ctx);
    expect(((await summariesOf(householdId))[0]!.data as SummaryData).phones).toEqual([]);
    // No phone to talk about: nothing is mailed.
    expect(h.mail.outbox.filter((m) => m.subject === "Your week with Plainphone")).toHaveLength(0);
  });
});

describe("alert policy", () => {
  it("holds back an offline alert for the summary by default, and still sends protection news at once", async () => {
    const { phoneId, device, householdId } = await setup();
    expect(alertClass({ type: "offline", phoneId, phoneName: "x", hours: 12, lastSeenAt: new Date(), timezone: "UTC" })).toBe("can-wait");
    // Thursday: too long after last Sunday for that week to be built late.
    at("2026-11-19T12:00:00Z");
    await device.get("/api/device/rules");
    at("2026-11-20T01:00:00Z");
    await sweep(h.ctx);
    expect(alerts()).toHaveLength(0);
    expect(h.mail.outbox.filter((m) => m.subject.includes("has not been in touch"))).toHaveLength(0);
    // Protection removed is "act now": it is sent although the toggle is on.
    await device.put("/api/device/status", status());
    await device.put("/api/device/status", status({ lockIntact: false }));
    expect(alerts().map((s) => s.msg.title)).toEqual(["Protection removed on Phone A"]);
    at(SUNDAY_1800_CET);
    await device.put("/api/device/status", status());
    await sweepSummaries(h.ctx);
    const data = (await summariesOf(householdId))[0]!.data as SummaryData;
    expect(data.phones[0]!.events).toEqual({ protection: 1, offline: 1, checkin: 0 });
  });

  it("sends the offline alert at once when 'Only alert me when I must act' is off", async () => {
    const { mum, householdId } = await setup();
    expect((await mum.patch(`/api/households/${householdId}/summary-settings`, { actNowOnly: false })).status).toBe(200);
    const { device } = await pairPhone(h, mum, { name: "Phone B" });
    await device.get("/api/device/rules");
    h.clock.advance(13 * 3_600_000);
    await sweep(h.ctx);
    expect(alerts().map((s) => s.msg.title)).toEqual(["Phone B has not been in touch for 13 hours"]);
  });

  it("does not hold anything back when the summary is off or cannot be delivered", async () => {
    const { mum, phoneId, householdId } = await setup();
    const event = { type: "offline", phoneId, phoneName: "x", hours: 12, lastSeenAt: new Date(), timezone: "UTC" } as const;
    expect(await batchedIntoSummary(h.ctx, householdId, event)).toBe(true);
    await mum.patch(`/api/households/${householdId}/summary-settings`, { enabled: false });
    expect(await batchedIntoSummary(h.ctx, householdId, event)).toBe(false);
    await mum.patch(`/api/households/${householdId}/summary-settings`, { enabled: true, byMail: false, byPush: false });
    expect(await batchedIntoSummary(h.ctx, householdId, event)).toBe(false);
  });

  it("never batches SOS, requests or the answers to a ring", async () => {
    const { householdId, phoneId } = await setup();
    const sos = { type: "sos", id: "a", phoneId, phoneName: "x", kind: "help" } as const;
    expect(alertClass(sos)).toBe("act-now");
    expect(await batchedIntoSummary(h.ctx, householdId, sos)).toBe(false);
    expect(await batchedIntoSummary(h.ctx, householdId, { ...sos, kind: "urgent" })).toBe(false);
    expect(alertClass({ type: "request", phoneId, phoneName: "x", what: "y", kind: "app" })).toBe("act-now");
    expect(alertClass({ type: "approval", phoneName: "x" })).toBe("act-now");
    expect(alertClass({ type: "safety", phoneId, phoneName: "x", what: "here" })).toBe("act-now");
    expect(alertClass({ type: "protection", phoneId, phoneName: "x", reason: "lock" })).toBe("act-now");
  });
});

describe("scheduling and delivery", () => {
  it("builds and delivers once at the chosen time, by mail and push, and never twice", async () => {
    const { householdId } = await setup();
    at("2026-11-22T16:59:00Z");
    expect(await sweepSummaries(h.ctx)).toEqual({ built: 0, delivered: 0 });
    at(SUNDAY_1800_CET);
    expect(await sweepSummaries(h.ctx)).toEqual({ built: 1, delivered: 1 });
    const mails = h.mail.outbox.filter((m) => m.subject === "Your week with Plainphone");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe("mum@example.org");
    expect(mails[0]!.text).toContain("Phone A");
    const pushes = h.parentPush.sent.filter((s) => s.msg.tag === "weekly-summary");
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.msg.url).toMatch(/^\/summary\?week=/);
    // Sweeps in the minutes and hours after change nothing.
    for (const later of ["2026-11-22T17:01:00Z", "2026-11-22T20:00:00Z", "2026-11-23T17:00:00Z"]) {
      at(later);
      expect(await sweepSummaries(h.ctx)).toEqual({ built: 0, delivered: 0 });
    }
    expect(h.mail.outbox.filter((m) => m.subject === "Your week with Plainphone")).toHaveLength(1);
    expect(await summariesOf(householdId)).toHaveLength(1);
    // The next week brings the next one.
    at("2026-11-29T17:00:00Z");
    expect(await sweepSummaries(h.ctx)).toEqual({ built: 1, delivered: 1 });
  });

  it("delivers a summary that was built but not yet sent after a restart, and skips one already claimed", async () => {
    const { householdId } = await setup();
    at(SUNDAY_1800_CET);
    await h.ctx.db.insert(householdSummaries).values({
      householdId, weekEnd: "2026-11-22", periodStart: new Date("2026-11-15T17:00:00Z"), periodEnd: new Date(SUNDAY_1800_CET),
      data: { version: 1, phones: [{ phoneId: "x", name: "Phone A", usage: null,
        requests: { asked: 0, approved: 0, rejected: 0, byKind: {} }, changes: { total: 0, byCategory: {} },
        events: { protection: 0, offline: 0, checkin: 0 } }] },
    });
    expect(await sweepSummaries(h.ctx)).toEqual({ built: 0, delivered: 1 });
    expect(await sweepSummaries(h.ctx)).toEqual({ built: 0, delivered: 0 });
    expect(h.mail.outbox.filter((m) => m.subject === "Your week with Plainphone")).toHaveLength(1);
    // A row claimed before a crash is not sent again.
    await h.ctx.db.update(householdSummaries).set({ deliveredAt: new Date() });
    expect(await sweepSummaries(h.ctx)).toEqual({ built: 0, delivered: 0 });
  });

  it("follows the household's time zone and keeps 18:00 across the spring change", async () => {
    const { mum, householdId } = await setup();
    // Clocks go forward in Copenhagen on 2026-03-29: Sunday 18:00 is then 16:00 UTC, not 17:00.
    at("2026-03-29T15:59:00Z");
    await h.ctx.db.update(households).set({ createdAt: new Date("2026-03-01T00:00:00Z") }).where(eq(households.id, householdId));
    expect((await sweepSummaries(h.ctx)).built).toBe(0);
    at("2026-03-29T16:00:00Z");
    expect((await sweepSummaries(h.ctx)).built).toBe(1);
    const [row] = await summariesOf(householdId);
    expect(row!.periodStart.toISOString()).toBe("2026-03-22T17:00:00.000Z");
    expect(row!.periodEnd.toISOString()).toBe("2026-03-29T16:00:00.000Z");
    // Another zone, another moment: New York's Sunday 18:00 in November is 23:00 UTC.
    await mum.patch(`/api/households/${householdId}/summary-settings`, { timeZone: "America/New_York" });
    await h.ctx.db.delete(householdSummaries);
    at("2026-11-22T22:59:00Z");
    expect((await sweepSummaries(h.ctx)).built).toBe(0);
    at("2026-11-22T23:00:00Z");
    expect((await sweepSummaries(h.ctx)).built).toBe(1);
  });

  it("honours the toggles: off, mail only and push only", async () => {
    const { mum, householdId } = await setup();
    const api = `/api/households/${householdId}/summary-settings`;
    const summaryMails = () => h.mail.outbox.filter((m) => m.subject === "Your week with Plainphone").length;
    const summaryPushes = () => h.parentPush.sent.filter((s) => s.msg.tag === "weekly-summary").length;

    await mum.patch(api, { enabled: false });
    at(SUNDAY_1800_CET);
    expect(await sweepSummaries(h.ctx)).toEqual({ built: 0, delivered: 0 });
    expect(await summariesOf(householdId)).toHaveLength(0);

    await mum.patch(api, { enabled: true, byPush: false });
    await sweepSummaries(h.ctx);
    expect([summaryMails(), summaryPushes()]).toEqual([1, 0]);

    await h.ctx.db.delete(householdSummaries);
    await mum.patch(api, { byMail: false, byPush: true });
    await sweepSummaries(h.ctx);
    expect([summaryMails(), summaryPushes()]).toEqual([1, 1]);
  });

  it("does not send a second summary when the day is moved within the week", async () => {
    const { mum, householdId } = await setup();
    at(SUNDAY_1800_CET);
    await sweepSummaries(h.ctx);
    // Moved to Tuesday: Tuesday 18:00 is only two days after the last one.
    await mum.patch(`/api/households/${householdId}/summary-settings`, { day: 2 });
    at("2026-11-24T17:00:00Z");
    expect((await sweepSummaries(h.ctx)).built).toBe(0);
    at("2026-12-01T17:00:00Z");
    expect((await sweepSummaries(h.ctx)).built).toBe(1);
  });

  it("waits for a household that is only a day old, and gives up on a summary missed for days", async () => {
    const { householdId } = await setup();
    await h.ctx.db.update(households).set({ createdAt: new Date("2026-11-21T12:00:00Z") }).where(eq(households.id, householdId));
    at(SUNDAY_1800_CET);
    expect((await sweepSummaries(h.ctx)).built).toBe(0);
    await h.ctx.db.update(households).set({ createdAt: new Date("2026-11-01T12:00:00Z") }).where(eq(households.id, householdId));
    at("2026-11-26T12:00:00Z");
    expect((await sweepSummaries(h.ctx)).built).toBe(0);
  });
});

describe("summary API", () => {
  it("reads and changes the settings, with defaults Sunday 18:00 and everything on", async () => {
    const { mum, householdId } = await setup();
    const api = `/api/households/${householdId}/summary-settings`;
    expect((await mum.get(api)).json).toEqual({
      enabled: true, byMail: true, byPush: true, actNowOnly: true,
      day: 0, hour: 18, minute: 0, timeZone: "Europe/Copenhagen", mailEnabled: true,
    });
    const r = await mum.patch(api, { day: 5, hour: 7, minute: 30, timeZone: "Europe/Stockholm" });
    expect(r.json).toMatchObject({ day: 5, hour: 7, minute: 30, timeZone: "Europe/Stockholm" });
    expect((await mum.patch(api, { day: 7 })).status).toBe(400);
    expect((await mum.patch(api, { hour: 24 })).status).toBe(400);
    expect((await mum.patch(api, { timeZone: "Mars/Base" })).status).toBe(400);
  });

  it("is only for members, and lists the last 8 weeks newest first", async () => {
    const { mum, householdId } = await setup();
    const stranger = await signIn(h, "stranger@example.org");
    expect((await stranger.get(`/api/households/${householdId}/summaries`)).status).toBe(404);
    expect((await stranger.patch(`/api/households/${householdId}/summary-settings`, { enabled: false })).status).toBe(404);
    for (let week = 0; week < 10; week++) {
      const end = new Date(Date.parse(SUNDAY_1800_CET) + week * 7 * 86_400_000);
      await h.ctx.db.insert(householdSummaries).values({
        householdId, weekEnd: end.toISOString().slice(0, 10), periodStart: new Date(end.getTime() - 7 * 86_400_000),
        periodEnd: end, data: { version: 1, phones: [] }, deliveredAt: end,
      });
    }
    const list = (await mum.get(`/api/households/${householdId}/summaries`)).json.summaries as { weekEnd: string }[];
    expect(list).toHaveLength(8);
    expect(list[0]!.weekEnd).toBe("2027-01-24");
    expect(list.map((s) => s.weekEnd)).toEqual([...list.map((s) => s.weekEnd)].sort().reverse());
  });
});

describe("summary mail", () => {
  const data: SummaryData = {
    version: 1,
    phones: [{
      phoneId: "p", name: "Phone A",
      usage: { days: [{ day: "2026-11-16", minutes: 135 }], averageMinutes: 135, topApps: [{ packageName: "a", label: "Video app", minutes: 75 }] },
      requests: { asked: 3, approved: 2, rejected: 1, byKind: { app: 3 } },
      changes: { total: 3, byCategory: { time: 2, apps: 1 } },
      events: { protection: 1, offline: 2, checkin: 0 },
    }],
  };

  it("states the numbers in the reader's language, in the shared layout with a text version and dark mode", () => {
    const en = weeklySummaryMail("a@example.org", "en", "https://app.example.test", "sid", data);
    expect(en.text).toContain("Screen time: 2 h 15 min a day on average.");
    expect(en.text).toContain("Most used: Video app (1 h 15 min).");
    expect(en.text).toContain("Requests: 3 asked, 3 answered.");
    expect(en.text).toContain("Rules changed 3 times (time limits 2, apps 1).");
    expect(en.text).toContain("Protection was removed once.");
    expect(en.text).toContain("Out of contact 2 times.");
    expect(en.text).toContain("https://app.example.test/summary?week=sid");
    expect(en.html).toContain("prefers-color-scheme: dark");
    expect(en.html).toContain('lang="en"');
    const da = weeklySummaryMail("a@example.org", "da", "https://app.example.test", "sid", data);
    expect(da.text).toContain("Skærmtid: 2 t. 15 min. om dagen i gennemsnit.");
    expect(da.text).toContain("Reglerne blev ændret 3 gange (tidsgrænser 2, apps 1).");
    const de = weeklySummaryMail("a@example.org", "de", "https://app.example.test", "sid", data);
    expect(de.text).toContain("Bildschirmzeit: durchschnittlich 2 h 15 min pro Tag.");
    expect(de.html).toContain("https://plainphone.org/de/privacy/");
  });

  it("has every sentence in all five languages and no blanks", () => {
    for (const locale of ["en", "da", "sv", "nb", "de"] as const) {
      const quiet: SummaryData = { version: 1, phones: [{
        phoneId: "p", name: "Phone A", usage: null, requests: { asked: 0, approved: 0, rejected: 0, byKind: {} },
        changes: { total: 0, byCategory: {} }, events: { protection: 0, offline: 0, checkin: 0 },
      }] };
      for (const d of [data, quiet]) {
        const mail = weeklySummaryMail("a@example.org", locale, "https://app.example.test", "sid", d);
        expect(mail.subject.length).toBeGreaterThan(5);
        expect(mail.text).not.toMatch(/undefined|NaN|\[object/);
        expect(mail.html).toContain(`lang="${locale}"`);
      }
    }
    expect(toSummaryLocale("nb-NO")).toBe("nb");
    expect(toSummaryLocale("no")).toBe("nb");
    expect(toSummaryLocale("fr")).toBe("en");
    expect(toSummaryLocale(undefined)).toBe("en");
  });

  it("sends each parent the mail in their own language", async () => {
    const { householdId } = await setup();
    const dad = await signIn(h, "dad@example.org", "da");
    const dadId = (await dad.get("/api/me")).json.user.id as string;
    await h.ctx.db.insert(householdMembers).values({ householdId, userId: dadId, role: "parent" });
    at(SUNDAY_1800_CET);
    await sweepSummaries(h.ctx);
    const sent = h.mail.outbox.filter((m) => m.subject === "Your week with Plainphone" || m.subject === "Din uge med Plainphone");
    expect(sent.map((m) => [m.to, m.subject]).sort()).toEqual([
      ["dad@example.org", "Din uge med Plainphone"],
      ["mum@example.org", "Your week with Plainphone"],
    ]);
  });
});
