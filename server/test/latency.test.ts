// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { householdMembers, latencySamples, phones, pushSubscriptions, sosEvents } from "../src/db/schema.js";
import { latencyStats, sweepLatency } from "../src/services/latency.js";
import { wakePhone } from "../src/services/phones.js";
import { sweep } from "../src/services/sweeper.js";
import { Client, pairPhone, PUBLIC_URL, signIn, useHarness, waitForSosRetryBackoff } from "./harness.js";

const h = useHarness();
const HOUR = 3_600_000;

async function parentWithPhone() {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
  const me = (await parent.get("/api/me")).json.user.id;
  await h.ctx.db.insert(pushSubscriptions).values({ userId: me, platform: "web", endpoint: "https://example.test/one" });
  return { parent, phoneId, device };
}

const samples = () => h.ctx.db.select().from(latencySamples);

afterEach(async () => {
  // Deliveries and timings run in the background: let them finish before the next test empties the tables.
  await vi.waitFor(async () => {
    const events = await h.ctx.db.select().from(sosEvents);
    expect(events.every((e) => e.notificationClaimedAt || e.notificationLeaseUntil?.getTime() === h.clock.now.getTime() + 60_000)).toBe(true);
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  vi.restoreAllMocks();
});

describe("timing what the child phone sends", () => {
  it("times an SOS from the press with the phone's monotonic clock, once, without the phone's identity", async () => {
    const { device } = await parentWithPhone();
    const id = randomUUID();
    const report = { id, kind: "urgent", sentAt: new Date(h.clock.now.getTime() - 9_000).toISOString() };
    expect((await device.call("POST", "/api/device/sos", report, { "x-plainphone-elapsed-ms": "1234" })).status).toBe(200);
    // A retry of the same report is not a second sample.
    await device.call("POST", "/api/device/sos", report, { "x-plainphone-elapsed-ms": "5000" });
    await vi.waitFor(async () => expect((await samples()).filter((s) => s.path === "phone-server")).toHaveLength(1));
    const [upload] = (await samples()).filter((s) => s.path === "phone-server");
    expect(upload).toMatchObject({ kind: "sos", ms: 1234, provider: null, phoneId: null, receipt: null });
    // Rounded to the hour, too coarse to point at the event.
    expect(upload!.hour.toISOString()).toBe("2026-11-16T12:00:00.000Z");
  });

  it("falls back to the phone's wall clock and ignores nonsense", async () => {
    const { device } = await parentWithPhone();
    await device.post("/api/device/sos", { id: randomUUID(), kind: "help", sentAt: new Date(h.clock.now.getTime() - 2_500).toISOString() });
    // A phone clock ahead of the server gives a negative time: not recorded.
    await device.post("/api/device/sos", { id: randomUUID(), kind: "help", sentAt: new Date(h.clock.now.getTime() + 60_000).toISOString() });
    await device.call("POST", "/api/device/sos", { id: randomUUID(), kind: "help" }, { "x-plainphone-elapsed-ms": "-4" });
    await vi.waitFor(async () => expect((await samples()).filter((s) => s.path === "server-parent" && s.ms !== null).length).toBeGreaterThan(0));
    expect((await samples()).filter((s) => s.path === "phone-server").map((s) => s.ms)).toEqual([2500]);
  });
});

describe("timing the push to the parents", () => {
  it("records the send time and the device's receipts, and only the first of each", async () => {
    const { device } = await parentWithPhone();
    await device.post("/api/device/sos", { id: randomUUID(), kind: "urgent" });
    await vi.waitFor(async () => expect((await samples()).find((s) => s.path === "server-parent")?.ms).toBe(0));
    const push = h.parentPush.sent[0]!;
    expect(push.priority).toBe("alarm");
    const receipt = push.msg.receipt!;
    expect(receipt).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const anon = new Client(h);
    h.clock.advance(1_500);
    expect((await anon.post("/api/push-receipt", { receipt })).status).toBe(204);
    h.clock.advance(1_000);
    await anon.post("/api/push-receipt", { receipt });
    h.clock.advance(4_000);
    await anon.post("/api/push-receipt", { receipt, event: "opened" });
    // An unknown id answers the same and changes nothing.
    expect((await anon.post("/api/push-receipt", { receipt: "a".repeat(22) })).status).toBe(204);
    expect((await anon.post("/api/push-receipt", { receipt: "short" })).status).toBe(400);
    const [row] = (await samples()).filter((s) => s.path === "server-parent");
    expect(row).toMatchObject({ provider: "web", kind: "alarm", ms: 0, deliveredMs: 1500, openedMs: 6500 });
  });

  it("measures from the SOS reaching the server, so a retry counts its wait", async () => {
    const { device } = await parentWithPhone();
    const send = vi.spyOn(h.parentPush, "send").mockResolvedValueOnce("failed");
    vi.spyOn(h.mail, "send").mockRejectedValueOnce(new Error("unavailable"));
    const id = randomUUID();
    await device.post("/api/device/sos", { id, kind: "help" });
    await waitForSosRetryBackoff(h, id);
    expect(send).toHaveBeenCalledTimes(1);
    // A failed push leaves no sample behind.
    await vi.waitFor(async () => expect((await samples()).filter((s) => s.path === "server-parent")).toHaveLength(0));
    h.clock.advance(60_000);
    await sweep(h.ctx);
    await vi.waitFor(async () => expect((await samples()).find((s) => s.path === "server-parent")?.ms).toBe(60_000));
    expect((await samples()).find((s) => s.path === "server-parent")?.kind).toBe("prompt");
  });

  it("sends an SOS to every parent, by push and mail, at the same time", async () => {
    const { phoneId, device } = await parentWithPhone();
    const second = await signIn(h, "second@example.org");
    const other = (await second.get("/api/me")).json.user.id;
    const [phone] = await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId));
    await h.ctx.db.insert(householdMembers).values({ householdId: phone!.householdId, userId: other, role: "parent" });
    await h.ctx.db.insert(pushSubscriptions).values({ userId: other, platform: "web", endpoint: "https://example.test/two" });
    // Every channel blocks until all four have started: a sequential fan-out never gets there.
    let release!: () => void;
    const allStarted = new Promise<void>((resolve) => { release = resolve; });
    let started = 0;
    const gate = async () => { if (++started === 4) release(); await allStarted; };
    const real = h.parentPush.send.bind(h.parentPush);
    vi.spyOn(h.parentPush, "send").mockImplementation(async (t, m, o) => { await gate(); return real(t, m, o); });
    vi.spyOn(h.mail, "send").mockImplementation(async (m) => { await gate(); h.mail.outbox.push(m); });
    await device.post("/api/device/sos", { id: randomUUID(), kind: "urgent" });
    await vi.waitFor(() => expect(h.parentPush.sent).toHaveLength(2), { timeout: 3_000 });
    expect(started).toBe(4);
  });
});

describe("timing wakeups of the child phone", () => {
  it("times a wakeup until the next rules fetch, then forgets the phone", async () => {
    const { phoneId, device } = await parentWithPhone();
    await device.get("/api/device/rules");
    // Setting up the phone woke it too; start from a clean slate.
    await vi.waitFor(async () => expect((await samples()).every((s) => s.ms !== null)).toBe(true));
    await h.ctx.db.delete(latencySamples);
    // No push registration yet: the wakeup waits for polling.
    await wakePhone(h.ctx, phoneId, "locate");
    h.clock.advance(5_000);
    await wakePhone(h.ctx, phoneId, "rules");
    await vi.waitFor(async () => expect(await samples()).toHaveLength(1));
    h.clock.advance(25_000);
    await device.get("/api/device/rules");
    await vi.waitFor(async () => expect((await samples())[0]?.ms).toBe(30_000));
    expect((await samples())[0]).toMatchObject({ path: "server-child", provider: "poll", kind: "locate", phoneId: null, anchorAt: null });
  });

  it("drops a wake-up the phone only answered after it was off for a long time", async () => {
    const { phoneId, device } = await parentWithPhone();
    await vi.waitFor(async () => expect((await samples()).every((s) => s.ms !== null)).toBe(true));
    await h.ctx.db.delete(latencySamples);
    await wakePhone(h.ctx, phoneId, "rules");
    await vi.waitFor(async () => expect(await samples()).toHaveLength(1));
    h.clock.advance(20 * HOUR);
    await device.get("/api/device/rules");
    await vi.waitFor(async () => expect(await samples()).toEqual([]));
    // The next wake-up is timed again.
    await wakePhone(h.ctx, phoneId, "rules");
    h.clock.advance(4_000);
    await device.get("/api/device/rules");
    await vi.waitFor(async () => expect((await samples()).map((s) => s.ms)).toEqual([4_000]));
  });

  it("names the transport the phone registered", async () => {
    const { phoneId, device } = await parentWithPhone();
    h.ctx.push = { ...h.push, name: "fcm", fcmAvailable: true, validateFcmToken: async () => "sent", wake: async () => undefined };
    expect((await device.put("/api/device/push-token", { fcmToken: "token" })).status).toBe(204);
    await wakePhone(h.ctx, phoneId, "rules");
    await vi.waitFor(async () => expect((await samples())[0]?.provider).toBe("fcm"));
  });
});

describe("the stats", () => {
  const at = (hoursAgo: number) => new Date(Math.floor((h.clock.now.getTime() - hoursAgo * HOUR) / HOUR) * HOUR);

  it("gives p50 and p95 per path for the last 7 days, and hides thin paths", async () => {
    const rows = [];
    for (const ms of [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]) {
      rows.push({ path: "server-parent" as const, provider: "fcm", kind: "alarm", hour: at(2), ms, deliveredMs: ms });
      rows.push({ path: "server-child" as const, provider: "poll", kind: "rules", hour: at(30), ms: ms * 100 });
    }
    // Older than the window, and a path with too few samples.
    rows.push({ path: "server-child" as const, provider: "poll", kind: "rules", hour: at(8 * 24), ms: 9_999_999 });
    for (const ms of [1, 2, 3, 4]) rows.push({ path: "phone-server" as const, provider: null, kind: "sos", hour: at(1), ms });
    await h.ctx.db.insert(latencySamples).values(rows);
    expect(await latencyStats(h.ctx)).toEqual([
      { path: "server-parent", provider: "fcm", kind: null, p50Ms: 550, p95Ms: 955 },
      { path: "parent-device", provider: "fcm", kind: null, p50Ms: 1100, p95Ms: 1910 },
      { path: "server-child", provider: "poll", kind: null, p50Ms: 55_000, p95Ms: 95_500 },
    ]);
    const res = await new Client(h).get("/api/latency");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ enabled: true, windowDays: 7, minSamples: 5 });
    expect(res.json.paths).toHaveLength(3);
  });

  it("sweeps old rows, receipt ids and wakeups that were never answered", async () => {
    await h.ctx.db.insert(latencySamples).values([
      { path: "server-parent", provider: "web", kind: "alarm", hour: at(9 * 24), ms: 1 },
      { path: "server-parent", provider: "web", kind: "alarm", hour: at(30), ms: 2, receipt: "b".repeat(22), anchorAt: at(30) },
      { path: "server-parent", provider: "web", kind: "alarm", hour: at(1), ms: 3, receipt: "c".repeat(22), anchorAt: at(1) },
      { path: "server-child", provider: "fcm", kind: "rules", hour: at(30), anchorAt: at(30) },
    ]);
    await sweepLatency(h.ctx);
    const left = (await samples()).sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0));
    expect(left.map((s) => [s.ms, s.receipt])).toEqual([[2, null], [3, "c".repeat(22)]]);
  });

  it("records and shows nothing when switched off", async () => {
    h.ctx.cfg = loadConfig({ DATABASE_URL: "unused", PUBLIC_URL, NODE_ENV: "test", LATENCY_STATS: "off" });
    const { device } = await parentWithPhone();
    await device.call("POST", "/api/device/sos", { id: randomUUID(), kind: "urgent" }, { "x-plainphone-elapsed-ms": "10" });
    await vi.waitFor(() => expect(h.parentPush.sent).toHaveLength(1));
    expect(h.parentPush.sent[0]!.msg.receipt).toBeUndefined();
    expect(await samples()).toEqual([]);
    expect((await new Client(h).get("/api/latency")).json).toMatchObject({ enabled: false, paths: [] });
  });
});
