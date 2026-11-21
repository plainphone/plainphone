// SPDX-License-Identifier: Apache-2.0
//
// GET /api/metrics: the operator's delivery-speed numbers in Prometheus text (docs/latency.md).
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { latencySamples, sosEvents } from "../src/db/schema.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();
const TOKEN = "t".repeat(32);
const HOUR = 3_600_000;
const auth = (token = TOKEN) => ({ authorization: `Bearer ${token}` });

/** The pinned clock is 2026-11-16T12:00Z; `ago` is whole hours back. */
const at = (ago: number) => new Date(h.clock.now.getTime() - ago * HOUR);
async function add(path: "phone-server" | "server-parent" | "server-child", provider: string | null, kind: string, ago: number, ms: number, deliveredMs?: number) {
  await h.ctx.db.insert(latencySamples).values({ path, provider, kind, hour: at(ago), ms, deliveredMs });
}

/** `name{labels} value` lines of one metric as `labels => value`. */
function metric(text: string, name: string) {
  const out = new Map<string, number>();
  for (const line of text.split("\n")) {
    const m = new RegExp(`^${name}\\{(.*)\\} (\\S+)$`).exec(line);
    if (m) out.set(m[1]!, Number(m[2]));
  }
  return out;
}
const anon = () => new Client(h);

beforeEach(() => { h.ctx.cfg.METRICS_TOKEN = TOKEN; });
afterEach(async () => {
  await vi.waitFor(async () => {
    const events = await h.ctx.db.select().from(sosEvents);
    expect(events.every((e) => e.notificationClaimedAt || e.notificationLeaseUntil?.getTime() === h.clock.now.getTime() + 60_000)).toBe(true);
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  vi.restoreAllMocks();
});

describe("who may read it", () => {
  it("answers 404 while METRICS_TOKEN is not set, even with a token", async () => {
    h.ctx.cfg.METRICS_TOKEN = undefined;
    expect((await anon().get("/api/metrics", auth())).status).toBe(404);
    expect((await anon().get("/api/metrics")).status).toBe(404);
  });

  it("needs the bearer token", async () => {
    expect((await anon().get("/api/metrics")).status).toBe(401);
    expect((await anon().get("/api/metrics", auth("x".repeat(32)))).status).toBe(401);
    expect((await anon().get("/api/metrics", auth("short"))).status).toBe(401);
    // A parent's own session is not an operator's token.
    const parent = await signIn(h, "parent@example.org");
    expect((await parent.get("/api/metrics")).status).toBe(401);
    const ok = await anon().get("/api/metrics", auth());
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toMatch(/^text\/plain/);
  });

  it("drops a too short token from the config and says so", () => {
    const cfg = loadConfig({ DATABASE_URL: "x", METRICS_TOKEN: "short" });
    expect(cfg.METRICS_TOKEN).toBeUndefined();
    expect(cfg.configWarnings.other).toContain("metrics: invalid METRICS_TOKEN");
    expect(loadConfig({ DATABASE_URL: "x", METRICS_TOKEN: "k".repeat(24) }).METRICS_TOKEN).toBe("k".repeat(24));
  });
});

describe("the numbers", () => {
  // Fixtures where a wrong window, a wrong grouping or a wrong percentile all give other numbers.
  async function fixtures() {
    for (const ms of [1000, 2000, 3000, 4000, 5000]) await add("phone-server", null, "sos", 0, ms);
    await add("phone-server", null, "sos", 5, 100_000); // in 24 h, not in 1 h
    await add("phone-server", null, "sos", 30, 777_777); // older than both
    await add("phone-server", null, "quick", 0, 50);
    for (const ms of [100, 200, 300]) await add("server-parent", "fcm", "alarm", 0, ms, 1000);
    await add("server-parent", "web", "prompt", 0, 100, 200);
    await add("server-child", "poll", "rules", 2, 90_000);
  }
  const key = (path: string, provider: string | null, kind: string | null, window: string, quantile?: string) =>
    [`path="${path}"`, provider ? `provider="${provider}"` : null, kind ? `kind="${kind}"` : null, `window="${window}"`, quantile ? `quantile="${quantile}"` : null]
      .filter(Boolean).join(",");

  it("gives p50, p95 and the count per path, provider and window", async () => {
    await fixtures();
    const text = (await anon().get("/api/metrics", auth())).json as string;
    const ms = metric(text, "plainphone_latency_ms");
    const n = metric(text, "plainphone_latency_samples");
    // 1 h: the five fresh samples only.
    expect(ms.get(key("phone-server", null, "sos", "1h", "0.5"))).toBe(3000);
    expect(ms.get(key("phone-server", null, "sos", "1h", "0.95"))).toBe(4800);
    expect(n.get(key("phone-server", null, "sos", "1h"))).toBe(5);
    // 24 h: the one from five hours ago joins, the one from 30 hours ago does not.
    expect(ms.get(key("phone-server", null, "sos", "24h", "0.5"))).toBe(3500);
    expect(ms.get(key("phone-server", null, "sos", "24h", "0.95"))).toBe(76_250);
    expect(n.get(key("phone-server", null, "sos", "24h"))).toBe(6);
    // Kinds are separate paths.
    expect(n.get(key("phone-server", null, "quick", "1h"))).toBe(1);
    // Push providers, with Web Push under its own name.
    expect(ms.get(key("server-parent", "fcm", null, "1h", "0.5"))).toBe(200);
    expect(ms.get(key("server-parent", "webpush", null, "1h", "0.5"))).toBe(100);
    // Send time plus the device's confirmation, only where a receipt came back.
    expect(ms.get(key("parent-device", "fcm", null, "1h", "0.5"))).toBe(1200);
    expect(ms.get(key("parent-device", "webpush", null, "24h", "0.95"))).toBe(300);
    // A sample two hours old is in 24 h only.
    expect(ms.get(key("server-child", "poll", null, "1h", "0.5"))).toBeUndefined();
    expect(ms.get(key("server-child", "poll", null, "24h", "0.5"))).toBe(90_000);
    expect(text).not.toContain("777777");
  });

  it("shows nothing for an empty server but the failure counters at 0", async () => {
    const text = (await anon().get("/api/metrics", auth())).json as string;
    expect(metric(text, "plainphone_latency_ms").size).toBe(0);
    expect([...metric(text, "plainphone_push_failures_total")]).toEqual([['provider="apns"', 0], ['provider="fcm"', 0], ['provider="unifiedpush"', 0], ['provider="webpush"', 0]]);
  });

  it("counts failed pushes per provider", async () => {
    const parent = await signIn(h, "parent@example.org");
    const { device } = await pairPhone(h, parent, { profile: "child" });
    const me = (await parent.get("/api/me")).json.user.id;
    const { pushSubscriptions } = await import("../src/db/schema.js");
    const { sessions } = await import("../src/db/schema.js");
    const [session] = await h.ctx.db.select().from(sessions);
    await h.ctx.db.insert(pushSubscriptions).values([
      { userId: me, platform: "web", endpoint: "https://example.test/one" },
      { userId: me, platform: "fcm", endpoint: "fcm-token-one", sessionId: session!.id },
    ]);
    h.ctx.parentPush = { name: "native-test", webPublicKey: "k", enabled: () => true, send: async () => "failed" };
    await device.post("/api/device/sos", { id: randomUUID(), kind: "help" });
    await vi.waitFor(async () => {
      const text = (await anon().get("/api/metrics", auth())).json as string;
      expect(metric(text, "plainphone_push_failures_total").get('provider="webpush"')).toBe(1);
    });
    const text = (await anon().get("/api/metrics", auth())).json as string;
    expect(metric(text, "plainphone_push_failures_total").get('provider="fcm"')).toBe(1);
    expect(metric(text, "plainphone_push_failures_total").get('provider="apns"')).toBe(0);
    expect(metric(text, "plainphone_push_failures_total").get('provider="unifiedpush"')).toBe(0);
  });

  it("counts a failed wake-up of the child phone under the transport it used", async () => {
    const parent = await signIn(h, "parent@example.org");
    const { phoneId } = await pairPhone(h, parent, { profile: "child" });
    const { phones } = await import("../src/db/schema.js");
    const { wakePhone } = await import("../src/services/phones.js");
    const { eq } = await import("drizzle-orm");
    const wake = vi.fn<(...a: unknown[]) => Promise<void | "gone" | "failed">>();
    h.ctx.push = { ...h.push, name: "fcm", fcmAvailable: true, validateFcmToken: async () => "sent", wake: wake as never };
    const failures = async () => metric((await anon().get("/api/metrics", auth())).json as string, "plainphone_push_failures_total");

    await h.ctx.db.update(phones).set({ pushWakeups: true, unifiedPushEndpoint: "https://push.example.org/one" }).where(eq(phones.id, phoneId));
    wake.mockResolvedValue("failed");
    await wakePhone(h.ctx, phoneId, "rules");
    expect((await failures()).get('provider="unifiedpush"')).toBe(1);
    // A thrown error (a timeout, say) is a failure too; a gone endpoint is not.
    wake.mockRejectedValue(new Error("timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await wakePhone(h.ctx, phoneId, "rules");
    expect((await failures()).get('provider="unifiedpush"')).toBe(2);
    wake.mockResolvedValue("gone");
    await wakePhone(h.ctx, phoneId, "rules");
    expect((await failures()).get('provider="unifiedpush"')).toBe(2);
    expect((await failures()).get('provider="fcm"')).toBe(0);

    await h.ctx.db.update(phones).set({ unifiedPushEndpoint: null, fcmToken: "token", fcmValidationKey: "v1:" }).where(eq(phones.id, phoneId));
    wake.mockResolvedValue("failed");
    await wakePhone(h.ctx, phoneId, "rules");
    expect((await failures()).get('provider="fcm"')).toBe(1);
  });
});

describe("what it leaves out", () => {
  it("holds no household, phone, user, endpoint or receipt, and only low-cardinality labels", async () => {
    const parent = await signIn(h, "parent@example.org");
    const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
    const me = (await parent.get("/api/me")).json.user;
    const { pushSubscriptions, phones } = await import("../src/db/schema.js");
    await h.ctx.db.insert(pushSubscriptions).values({ userId: me.id, platform: "web", endpoint: "https://example.test/one" });
    for (let i = 0; i < 5; i++) await device.post("/api/device/sos", { id: randomUUID(), kind: "urgent", sentAt: new Date(h.clock.now.getTime() - 1500).toISOString() });
    await vi.waitFor(async () => expect((await h.ctx.db.select().from(latencySamples)).filter((s) => s.path === "server-parent" && s.ms !== null)).toHaveLength(5));
    // A wake-up still waiting for its phone holds the phone's id; it must not leak.
    await h.ctx.db.insert(latencySamples).values({ path: "server-child", provider: "fcm", kind: "rules", hour: at(0), anchorAt: at(0), phoneId });
    const receipts = (await h.ctx.db.select().from(latencySamples)).map((s) => s.receipt).filter((r): r is string => Boolean(r));
    expect(receipts.length).toBeGreaterThan(0);
    const [phone] = await h.ctx.db.select().from(phones);

    const text = (await anon().get("/api/metrics", auth())).json as string;
    expect(metric(text, "plainphone_latency_ms").size).toBeGreaterThan(0);
    for (const secret of [phoneId, phone!.householdId, me.id, me.email, "example.test", ...receipts, TOKEN]) {
      expect(text).not.toContain(secret);
    }
    const names = new Set(text.split("\n").filter((l) => l && !l.startsWith("#")).flatMap((l) => [...l.matchAll(/(\w+)="/g)].map((m) => m[1])));
    expect([...names].sort()).toEqual(["kind", "path", "provider", "quantile", "window"]);
    // Every line is a comment or a metric with a number.
    for (const line of text.trimEnd().split("\n")) expect(line).toMatch(/^(#.*|plainphone_\w+\{[^}]*\} \d+)$/);
  });

  it("is empty of timings, and counts no failures, when the server has LATENCY_STATS=off", async () => {
    await add("phone-server", null, "sos", 0, 1000);
    const { countPushFailure } = await import("../src/services/latency-metrics.js");
    h.ctx.cfg.LATENCY_STATS = "off";
    try {
      countPushFailure(h.ctx, "fcm");
      const text = (await anon().get("/api/metrics", auth())).json as string;
      expect(metric(text, "plainphone_latency_ms").size).toBe(0);
      expect(metric(text, "plainphone_push_failures_total").get('provider="fcm"')).toBe(0);
    } finally {
      h.ctx.cfg.LATENCY_STATS = "on";
    }
  });
});
