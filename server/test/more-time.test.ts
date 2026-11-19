// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { moreTimeRequests, timeBonuses } from "../src/db/schema.js";
import { minutesFor, minutesLeftToday } from "../src/services/more-time.js";
import { sweep } from "../src/services/sweeper.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();
const SPOTIFY = "com.spotify.music";

async function setup(profile: "child" | "self" = "child") {
  const mum = await signIn(h, "mum@example.org");
  await mum.post("/api/notifications/subscriptions", {
    platform: "web",
    endpoint: "https://fcm.googleapis.com/fcm/send/mum",
    keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
  });
  const { phoneId, device } = await pairPhone(h, mum, { name: "Alma", profile });
  // A second parent in the same household.
  const hid = (await mum.get("/api/me")).json.households[0].id;
  await mum.post(`/api/households/${hid}/invites`, { email: "dad@example.org" });
  const token = decodeURIComponent(/invite#token=(\S+)/.exec(h.mail.outbox.at(-1)!.text)![1]!);
  const dad = await signIn(h, "dad@example.org");
  await dad.post("/api/invites/accept", { token });
  await device.put("/api/device/apps", { apps: [{ packageName: SPOTIFY, label: "Spotify" }] });
  if (profile === "child") {
    await mum.put(`/api/phones/${phoneId}/time-limits/apps/${SPOTIFY}`, { minutes: 60 });
    await mum.put(`/api/phones/${phoneId}/time-limits/total`, { minutes: 120 });
  }
  h.parentPush.sent.length = 0;
  return { mum, dad, phoneId, device };
}

const bonuses = async (device: Awaited<ReturnType<typeof setup>>["device"]) =>
  (await device.get("/api/device/rules")).json.timeLimits.bonuses as { packageName: string; date: string; minutes: number }[];

describe("ask for more time", () => {
  it("the child asks with a reason; the parent gets buttons and answers 15 minutes; the phone gets the bonus", async () => {
    const { mum, phoneId, device } = await setup();
    const r = await device.post("/api/device/more-time-requests", { packageName: SPOTIFY, reason: "  one more episode  " });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ packageName: SPOTIFY, reason: "one more episode", status: "pending", answer: null, day: "2026-11-16" });

    const push = h.parentPush.sent.map((s) => s.msg);
    expect(push).toEqual([
      expect.objectContaining({
        title: "Alma asks for more time",
        body: 'Spotify is used up. "one more episode" Answer here or open the app.',
        url: `/phones/${phoneId}`,
        data: { type: "more-time", phoneId, requestId: r.json.id },
        actions: [
          { id: "15", title: "15 min" },
          { id: "60", title: "1 hour" },
          { id: "day", title: "Rest of the day" },
          { id: "no", title: "No" },
        ],
      }),
    ]);

    const open = await mum.get(`/api/phones/${phoneId}/more-time-requests`);
    expect(open.json.requests).toEqual([
      expect.objectContaining({ id: r.json.id, appLabel: "Spotify", status: "pending", answeredByYou: null }),
    ]);
    expect((await mum.get(`/api/phones/${phoneId}`)).json.openMoreTimeRequests).toBe(1);

    const ok = await mum.post(`/api/phones/${phoneId}/more-time-requests/${r.json.id}/answer`, { answer: "15" });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ status: "approved", answer: "15", grantedMinutes: 15, won: true, answeredByYou: true });
    expect(await bonuses(device)).toEqual([{ packageName: SPOTIFY, date: "2026-11-16", minutes: 15 }]);
    const mine = await device.get("/api/device/more-time-requests");
    expect(mine.json.requests).toEqual([expect.objectContaining({ id: r.json.id, status: "approved", grantedMinutes: 15 })]);
    expect((await mum.get(`/api/phones/${phoneId}`)).json.openMoreTimeRequests).toBe(0);
  });

  it("asks for the daily cap with `*`, and the rest of the day is the time left until local midnight", async () => {
    const { mum, phoneId, device } = await setup();
    const r = await device.post("/api/device/more-time-requests", { packageName: "*" });
    expect(h.parentPush.sent[0]!.msg.body).toBe("The daily limit is used up. Answer here or open the app.");
    expect((await mum.get(`/api/phones/${phoneId}/more-time-requests`)).json.requests[0].appLabel).toBeNull();
    // 12:00 UTC is 13:00 in Copenhagen: eleven hours left.
    const ok = await mum.post(`/api/phones/${phoneId}/more-time-requests/${r.json.id}/answer`, { answer: "day" });
    expect(ok.json).toMatchObject({ status: "approved", answer: "day", grantedMinutes: 660 });
    expect(await bonuses(device)).toEqual([{ packageName: "*", date: "2026-11-16", minutes: 660 }]);
  });

  it("first answer wins: a second parent or a second tap sees the result and changes nothing", async () => {
    const { mum, dad, phoneId, device } = await setup();
    const r = await device.post("/api/device/more-time-requests", { packageName: SPOTIFY });
    const first = await mum.post(`/api/phones/${phoneId}/more-time-requests/${r.json.id}/answer`, { answer: "60" });
    expect(first.json).toMatchObject({ won: true, grantedMinutes: 60 });
    const second = await dad.post(`/api/phones/${phoneId}/more-time-requests/${r.json.id}/answer`, { answer: "no" });
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ won: false, status: "approved", grantedMinutes: 60, answeredByYou: false });
    const again = await mum.post(`/api/phones/${phoneId}/more-time-requests/${r.json.id}/answer`, { answer: "60" });
    expect(again.json).toMatchObject({ won: false, answeredByYou: true });
    expect(await bonuses(device)).toEqual([{ packageName: SPOTIFY, date: "2026-11-16", minutes: 60 }]);
    expect(await h.ctx.db.select().from(timeBonuses)).toHaveLength(1);
  });

  it("no declines, adds no bonus, and the phone sees the answer", async () => {
    const { mum, phoneId, device } = await setup();
    const r = await device.post("/api/device/more-time-requests", { packageName: SPOTIFY });
    const no = await mum.post(`/api/phones/${phoneId}/more-time-requests/${r.json.id}/answer`, { answer: "no" });
    expect(no.json).toMatchObject({ status: "declined", answer: "no", grantedMinutes: null, won: true });
    expect(await bonuses(device)).toEqual([]);
    expect((await device.get("/api/device/more-time-requests")).json.requests[0]).toMatchObject({ status: "declined" });
    // Declined means the child can ask again later.
    expect((await device.post("/api/device/more-time-requests", { packageName: SPOTIFY })).status).toBe(201);
  });

  it("asking twice gives the open request and one push", async () => {
    const { device } = await setup();
    const a = await device.post("/api/device/more-time-requests", { packageName: SPOTIFY });
    const b = await device.post("/api/device/more-time-requests", { packageName: SPOTIFY, reason: "please" });
    expect(b.status).toBe(200);
    expect(b.json.id).toBe(a.json.id);
    expect(h.parentPush.sent).toHaveLength(1);
  });

  it("expires at the phone's midnight, for the child and for a late answer", async () => {
    const { mum, phoneId, device } = await setup();
    const r = await device.post("/api/device/more-time-requests", { packageName: SPOTIFY });
    h.clock.advance(12 * 3_600_000); // 00:00 UTC is 01:00 the next day in Copenhagen
    const late = await mum.post(`/api/phones/${phoneId}/more-time-requests/${r.json.id}/answer`, { answer: "15" });
    expect(late.json).toMatchObject({ status: "expired", won: false });
    expect(await bonuses(device)).toEqual([]);
    expect((await device.get("/api/device/more-time-requests")).json.requests[0].status).toBe("expired");
    expect((await mum.get(`/api/phones/${phoneId}`)).json.openMoreTimeRequests).toBe(0);
  });

  it("the sweeper expires open requests and deletes old ones", async () => {
    const { phoneId, device } = await setup();
    await device.post("/api/device/more-time-requests", { packageName: SPOTIFY });
    h.clock.advance(13 * 3_600_000);
    await sweep(h.ctx);
    const [row] = await h.ctx.db.select().from(moreTimeRequests).where(eq(moreTimeRequests.phoneId, phoneId));
    expect(row!.status).toBe("expired");
    h.clock.advance(31 * 86_400_000);
    await sweep(h.ctx);
    expect(await h.ctx.db.select().from(moreTimeRequests)).toHaveLength(0);
  });

  it("is limited per phone", async () => {
    const { device } = await setup();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      // Each ask needs its own target, or it only returns the open one.
      statuses.push((await device.post("/api/device/more-time-requests", { packageName: i === 0 ? SPOTIFY : "*", reason: String(i) })).status);
    }
    expect(statuses.slice(0, 2)).toEqual([201, 201]);
    expect(statuses.at(-1)).toBe(429);
  });

  it("needs a limit on the target, and refuses what is not allowed", async () => {
    const { mum, phoneId, device } = await setup();
    expect((await device.post("/api/device/more-time-requests", { packageName: "com.example.game" })).status).toBe(409);
    expect((await device.post("/api/device/more-time-requests", { packageName: "not a package" })).status).toBe(400);
    expect((await device.post("/api/device/more-time-requests", { packageName: SPOTIFY, reason: "x".repeat(141) })).status).toBe(400);
    const r = await device.post("/api/device/more-time-requests", { packageName: SPOTIFY });
    // The parent removes the limit meanwhile: there is nothing to extend.
    await mum.del(`/api/phones/${phoneId}/time-limits/apps/${SPOTIFY}`);
    expect((await mum.post(`/api/phones/${phoneId}/more-time-requests/${r.json.id}/answer`, { answer: "15" })).status).toBe(409);
    expect((await mum.post(`/api/phones/${phoneId}/more-time-requests/${r.json.id}/answer`, { answer: "maybe" })).status).toBe(400);
  });

  it("can be switched off per phone, and the switch reaches the phone in the rules", async () => {
    const { mum, phoneId, device } = await setup();
    const rules = (await device.get("/api/device/rules")).json;
    expect(rules).toMatchObject({ askMoreTimeEnabled: true, limitWarningEnabled: true });
    const patched = await mum.patch(`/api/phones/${phoneId}`, { askMoreTimeEnabled: false, limitWarningEnabled: false });
    expect(patched.json).toMatchObject({ askMoreTimeEnabled: false, limitWarningEnabled: false });
    expect((await device.get("/api/device/rules")).json).toMatchObject({ askMoreTimeEnabled: false, limitWarningEnabled: false });
    expect((await device.post("/api/device/more-time-requests", { packageName: SPOTIFY })).status).toBe(403);
    await mum.patch(`/api/phones/${phoneId}`, { askMoreTimeEnabled: true });
    expect((await device.post("/api/device/more-time-requests", { packageName: SPOTIFY })).status).toBe(201);
  });

  it("is not for a Self phone, which has no parent to ask", async () => {
    const { device } = await setup("self");
    expect((await device.post("/api/device/more-time-requests", { packageName: "*" })).status).toBe(409);
  });

  it("a muted phone sends no notification, but the request is still there", async () => {
    const { mum, phoneId, device } = await setup();
    await mum.put(`/api/phones/${phoneId}/notifications`, { enabled: false });
    await device.post("/api/device/more-time-requests", { packageName: SPOTIFY });
    expect(h.parentPush.sent).toHaveLength(0);
    expect((await mum.get(`/api/phones/${phoneId}/more-time-requests`)).json.requests).toHaveLength(1);
  });

  it("only the household's parents can answer", async () => {
    const { phoneId, device } = await setup();
    const stranger = await signIn(h, "stranger@example.org");
    const r = await device.post("/api/device/more-time-requests", { packageName: SPOTIFY });
    expect((await stranger.post(`/api/phones/${phoneId}/more-time-requests/${r.json.id}/answer`, { answer: "15" })).status).toBeGreaterThanOrEqual(403);
    expect((await stranger.get(`/api/phones/${phoneId}/more-time-requests`)).status).toBeGreaterThanOrEqual(403);
  });
});

describe("what a choice gives", () => {
  it("counts the rest of the day in the phone's time zone, rounded up", () => {
    expect(minutesLeftToday("Europe/Copenhagen", new Date("2026-11-16T12:00:00Z"))).toBe(660);
    expect(minutesLeftToday("UTC", new Date("2026-11-16T23:59:30Z"))).toBe(1);
    expect(minutesLeftToday("UTC", new Date("2026-11-16T00:00:00Z"))).toBe(1440);
    expect(minutesFor("15", "UTC", new Date())).toBe(15);
    expect(minutesFor("60", "UTC", new Date())).toBe(60);
    expect(minutesFor("no", "UTC", new Date())).toBeNull();
  });
});
