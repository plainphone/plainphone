// SPDX-License-Identifier: Apache-2.0
//
// Regression tests for the server hardening audit (docs/audits/2026-11-20-server.md).

import { format } from "node:util";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { phones, users } from "../src/db/schema.js";
import { RateLimiter } from "../src/lib/http.js";
import { errorSummary } from "../src/lib/log.js";
import type { DnsClientConfig } from "../src/providers/dns.js";
import { syncDns } from "../src/services/dns.js";
import { sweep } from "../src/services/sweeper.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

afterEach(() => {
  vi.restoreAllMocks();
});

const logged = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((args) => format(...args)).join("\n");

describe("request size and rate limiter memory", () => {
  const huge = JSON.stringify({ email: "a@example.org", padding: "x".repeat(2 * 1024 * 1024) });
  const post = (path: string) =>
    h.app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: huge });

  it("refuses large bodies on routes that need no sign-in", async () => {
    expect((await post("/api/auth/request")).status).toBe(413);
    expect((await post("/api/device/pairings")).status).toBe(413);
    expect((await post("/api/device/enroll")).status).toBe(413);
  });

  it("leaves the larger limit to the routes that set their own", async () => {
    // Not 413: the request gets as far as the session check.
    expect((await post(`/api/phones/${crypto.randomUUID()}/contact-suggestions`)).status).toBe(401);
  });

  it("keeps a bounded number of keys and still limits a known key", () => {
    const limiter = new RateLimiter(3, 60_000, 100);
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) expect(limiter.take("phone", now)).toBe(true);
    for (let i = 0; i < 1000; i++) limiter.take(`made-up-${i}`, now);
    expect(limiter.size).toBeLessThanOrEqual(100);
    expect(limiter.take("fresh", now)).toBe(true);
    expect(limiter.take("fresh", now)).toBe(true);
    expect(limiter.take("fresh", now)).toBe(true);
    expect(limiter.take("fresh", now)).toBe(false);
  });
});

describe("server log", () => {
  it("keeps a failed query's parameters out of the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.app.get("/test/duplicate-user", async () => {
      await h.ctx.db.insert(users).values({ email: "taken@example.org" });
      await h.ctx.db.insert(users).values({ email: "taken@example.org" });
      return new Response(null, { status: 204 });
    });
    const res = await h.app.request("/test/duplicate-user");
    expect(res.status).toBe(500);
    expect(logged(log)).toContain("23505");
    expect(logged(log)).not.toContain("taken@example.org");
  });

  it("replaces addresses in other error messages", () => {
    const summary = errorSummary(new Error("550 5.1.1 <someone@example.org>: Recipient address rejected"));
    expect(summary).toContain("Recipient address rejected");
    expect(summary).not.toContain("someone@example.org");
  });
});

describe("DNS sync", () => {
  it("stops retrying dirty phones once the DNS service looks down", async () => {
    const parent = await signIn(h, "parent@example.org");
    for (const name of ["A", "B", "C", "D", "E"]) await pairPhone(h, parent, { name });
    await h.ctx.db.update(phones).set({ dnsDirty: true });
    h.dns.failNext = 100;
    const upsert = vi.spyOn(h.dns, "upsertClient");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await sweep(h.ctx);
    expect(upsert).toHaveBeenCalledTimes(3);
  });

  it("does not mark a phone clean when an older sync lands after a newer one", async () => {
    const parent = await signIn(h, "parent@example.org");
    const { phoneId, device } = await pairPhone(h, parent);
    const clientId = (await device.get("/api/device/rules")).json.dns.host.split(".")[0];
    const upsert = h.dns.upsertClient.bind(h.dns);
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    h.dns.upsertClient = async (config: DnsClientConfig) => {
      if (first) {
        first = false;
        entered();
        await gate;
      }
      return upsert(config);
    };

    // An older sync (as from the sweeper) is slow; a parent's change syncs past it.
    const older = syncDns(h.ctx, phoneId);
    await reached;
    expect((await parent.post(`/api/phones/${phoneId}/dns/block`, { domain: "example.com" })).status).toBe(200);
    expect(h.dns.clients.get(clientId)!.blockDomains).toEqual(["example.com"]);
    release();
    await older;
    // The older upsert overwrote the service with the old list: the phone must stay dirty.
    expect(h.dns.clients.get(clientId)!.blockDomains).toEqual([]);
    const [row] = await h.ctx.db.select({ dirty: phones.dnsDirty }).from(phones).where(eq(phones.id, phoneId));
    expect(row!.dirty).toBe(true);

    await sweep(h.ctx);
    expect(h.dns.clients.get(clientId)!.blockDomains).toEqual(["example.com"]);
  });
});

describe("protection alerts", () => {
  it("sends the urgent push without waiting for a slow mail server", async () => {
    const mum = await signIn(h, "mum@example.org");
    await mum.post("/api/notifications/subscriptions", {
      platform: "web",
      endpoint: "https://fcm.googleapis.com/fcm/send/mum",
      keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
    });
    const { device } = await pairPhone(h, mum);
    let release!: () => void;
    const stuck = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(h.mail, "send").mockImplementation(() => stuck);

    const report = device.put("/api/device/status", {
      appVersion: "0.1.3", batteryPct: 80, charging: false, deviceOwner: true, lockIntact: false,
      maintenance: false, failedPolicies: [], rulesEtag: null, rulesAppliedAt: null, dnsHost: null,
    });
    await vi.waitFor(() => expect(h.parentPush.sent).toHaveLength(1));
    release();
    expect((await report).status).toBe(204);
  });
});
