// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { phones } from "../src/db/schema.js";
import { HttpDnsProvider } from "../src/providers/dns.js";
import { markUnconfirmedDnsDirty } from "../src/services/dns.js";
import { sweep } from "../src/services/sweeper.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

const report = (over: Record<string, unknown> = {}) => ({
  appVersion: "0.4.0",
  batteryPct: 64,
  charging: true,
  deviceOwner: true,
  lockIntact: true,
  maintenance: false,
  failedPolicies: [] as string[],
  rulesEtag: '"abc123"',
  rulesAppliedAt: "2026-11-16T11:59:00Z",
  dnsHost: "k3m2x7q9p4r8t6w2y5z3.dns.plainphone.org",
  ...over,
});

describe("phone update requests", () => {
  it("delivers a parent request in the rules and returns the phone's outcome", async () => {
    const parent = await signIn(h, "parent@example.org");
    const { phoneId, device } = await pairPhone(h, parent);
    const path = `/api/phones/${phoneId}`;
    const outsider = await signIn(h, "outsider@example.org");
    expect((await outsider.post(`${path}/update`)).status).toBe(404);
    const before = await device.get("/api/device/rules");
    const waiting = device.get("/api/device/update-request?after=0");
    expect(before.json.update.requestedAt).toBeNull();
    await device.put("/api/device/push-token", { fcmToken: "update-test" });
    expect((await parent.post(`${path}/update`)).status).toBe(202);
    expect(h.push.sent).toEqual([{ token: "update-test", reason: "rules" }]);
    expect(await waiting).toMatchObject({ status: 200, json: { requestedAtMs: h.clock.now.getTime() } });
    const rules = await device.get("/api/device/rules", { "if-none-match": before.headers.get("etag")! });
    expect(rules.status).toBe(200);
    expect(rules.json.update.requestedAt).toBe(h.clock.now.toISOString());
    const update = {
      state: "failed",
      detail: "download interrupted",
      checkedAt: h.clock.now.toISOString(),
      latestVersion: "0.4.1",
    };
    expect((await device.put("/api/device/status", report({ appVersionCode: 42, update }))).status).toBe(204);
    expect((await parent.get(path)).json.status).toMatchObject({ appVersion: "0.4.0", appVersionCode: 42, update });

    const codedUpdate = { ...update, errorCode: "network" };
    expect((await device.put("/api/device/status", report({ appVersionCode: 42, update: codedUpdate }))).status).toBe(204);
    expect((await parent.get(path)).json.status.update).toEqual(codedUpdate);
  });
});

it("hides an install overrun from an old status snapshot", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent);
  const failedPolicies = ["install window overran: 45s", "another policy failed"];
  expect((await device.put("/api/device/status", report({ failedPolicies }))).status).toBe(204);
  const path = `/api/phones/${phoneId}`;
  expect((await parent.get(path)).json.status.failedPolicies).toEqual(failedPolicies);
  await h.ctx.db.update(phones)
    .set({
      deviceStatus: report({ failedPolicies }),
      statusReportedAt: new Date(h.clock.now.getTime() - 7 * 24 * 60 * 60_000),
    })
    .where(eq(phones.id, phoneId));
  expect((await parent.get(path)).json.status.failedPolicies).toEqual(["another policy failed"]);
});

it("keeps the acknowledged install overrun through later reports until its original expiry", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent);
  const path = `/api/phones/${phoneId}`;
  const notice = "install window overran: 45s";
  const firstReport = h.clock.now.getTime();
  expect((await device.put("/api/device/status", report({ failedPolicies: [notice] }))).status).toBe(204);
  h.clock.now = new Date(firstReport + 6 * 24 * 60 * 60_000);
  expect((await device.put("/api/device/status", report({ failedPolicies: [notice] }))).status).toBe(204);
  expect((await device.put("/api/device/status", report({ failedPolicies: ["another policy failed"] }))).status).toBe(204);
  const { status } = (await parent.get(path)).json;
  expect(status.failedPolicies).toEqual([notice, "another policy failed"]);
  expect(status.reportedAt).toBe(h.clock.now.toISOString());
  h.clock.now = new Date(firstReport + 7 * 24 * 60 * 60_000);
  expect((await parent.get(path)).json.status.failedPolicies).toEqual(["another policy failed"]);
});

it("keeps the install overrun when a negative attestation adds a failure", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent);
  const notice = "install window overran: 45s";
  const failedPolicies = Array.from({ length: 49 }, (_, index) => `failed step ${index}`);
  expect((await device.put("/api/device/status", report({ failedPolicies: [notice] }))).status).toBe(204);
  expect((await device.put("/api/device/status", report({ failedPolicies }))).status).toBe(204);
  await h.ctx.db.update(phones).set({
    attestation: {
      state: "unlocked", deviceLocked: false, verifiedBootState: "unverified",
      securityLevel: "tee", revocationChecked: true, osPatchLevel: null,
    },
  }).where(eq(phones.id, phoneId));

  const { status } = (await parent.get(`/api/phones/${phoneId}`)).json;
  expect(status.lockIntact).toBe(false);
  expect(status.failedPolicies).toEqual([notice, ...failedPolicies, "hardware attestation: unlocked"]);
});

it("gives equal-duration overruns separate expiries without extending retries", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent);
  const path = `/api/phones/${phoneId}`;
  const failedPolicies = ["install window overran: 45s"];
  const day = 24 * 60 * 60_000;
  const firstReport = h.clock.now.getTime();
  expect((await device.put("/api/device/status", report({ failedPolicies, installOverrunSequence: 1 }))).status).toBe(204);
  h.clock.now = new Date(firstReport + 6 * day);
  expect((await device.put("/api/device/status", report({ failedPolicies, installOverrunSequence: 2 }))).status).toBe(204);
  h.clock.now = new Date(firstReport + 7 * day);
  expect((await parent.get(path)).json.status.failedPolicies).toEqual(failedPolicies);
  expect((await device.put("/api/device/status", report())).status).toBe(204);
  expect((await device.put("/api/device/status", report({ failedPolicies, installOverrunSequence: 2 }))).status).toBe(204);
  h.clock.now = new Date(firstReport + 13 * day);
  expect((await parent.get(path)).json.status.failedPolicies).toEqual([]);
});

describe("DNS readiness", () => {
  function useHttpDns() {
    h.ctx.cfg.DNS_PROVIDER = "http";
    h.ctx.dns = new HttpDnsProvider("https://resolver.example.test", "test-token");
    return vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("provisions a clean mock-confirmed phone after switching to HTTP", async () => {
    const parent = await signIn(h, "parent@example.org");
    const { phoneId, device } = await pairPhone(h, parent);
    const path = `/api/phones/${phoneId}/dns`;
    expect((await parent.get(path)).json.synced).toBe(true);
    const request = useHttpDns();

    expect((await parent.get(path)).json.host).toBeNull();
    request.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await sweep(h.ctx);
    expect(request).toHaveBeenCalledTimes(1);
    expect((await parent.get(path)).json).toMatchObject({ host: null, synced: false });

    request.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await sweep(h.ctx);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2]?.[1]?.method).toBe("POST");
    expect((await parent.get(path)).json).toMatchObject({
      host: (await device.get("/api/device/rules")).json.dns.host,
      synced: true,
    });
  });

  it("hides the dashboard host when the mock provider accepts the profile", async () => {
    const parent = await signIn(h, "parent@example.org");
    const { phoneId } = await pairPhone(h, parent);

    expect(h.dns.clients.size).toBe(1);
    const response = await parent.get(`/api/phones/${phoneId}/dns`);
    expect(response.status).toBe(200);
    expect(response.json.host).toBeNull();
  });

  it("marks legacy confirmations dirty at startup", async () => {
    const parent = await signIn(h, "parent@example.org");
    const { phoneId } = await pairPhone(h, parent);
    const path = `/api/phones/${phoneId}/dns`;
    await h.ctx.db.update(phones).set({ dnsConfirmedProvider: null }).where(eq(phones.id, phoneId));
    const request = useHttpDns();

    await markUnconfirmedDnsDirty(h.ctx);
    expect((await parent.get(path)).json).toMatchObject({ host: null, synced: false });
    await sweep(h.ctx);
    expect(request).toHaveBeenCalledTimes(1);
    expect((await parent.get(path)).json.host).toMatch(/\.dns\.plainphone\.org$/);
  });

  it("returns the configured DoT host only to household members after provisioning", async () => {
    const request = useHttpDns();
    const parent = await signIn(h, "parent@example.org");
    request.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const { phoneId, device } = await pairPhone(h, parent);
    const path = `/api/phones/${phoneId}/dns`;

    expect((await parent.get(path)).json.host).toBeNull();
    await sweep(h.ctx);
    const ready = await parent.get(path);
    expect(ready.status).toBe(200);
    expect(ready.json.host).toBe((await device.get("/api/device/rules")).json.dns.host);
    expect(ready.headers.get("cache-control")).toBe("no-store");

    const outsider = await signIn(h, "outsider@example.org");
    expect((await outsider.get(path)).status).toBe(404);
    expect((await new Client(h).get(path)).status).toBe(401);
  });

  it("keeps the real confirmation after a transient sync failure", async () => {
    const request = useHttpDns();
    const parent = await signIn(h, "parent@example.org");
    const { phoneId } = await pairPhone(h, parent);
    const path = `/api/phones/${phoneId}/dns`;
    const { host } = (await parent.get(path)).json;
    expect(host).toMatch(/\.dns\.plainphone\.org$/);

    request.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await parent.put(`${path}/categories/games`, { blocked: false });
    expect((await parent.get(path)).json).toMatchObject({ host, synced: false });
  });

  it("is false until the DNS service accepted the ClientID, and never goes back", async () => {
    const parent = await signIn(h, "parent@example.org");
    h.dns.failNext = 1; // the first sync, right after the phone is claimed
    const { phoneId, device } = await pairPhone(h, parent);

    const before = await device.get("/api/device/rules");
    expect(before.json.dns.ready).toBe(false);
    expect(before.json.dns.host).toMatch(/\.dns\.plainphone\.org$/);
    const summary = (await parent.get(`/api/phones/${phoneId}`)).json;
    expect(summary.dnsReady).toBe(false);
    expect(summary.dnsSynced).toBe(false);
    expect(h.dns.clients.size).toBe(0);

    // The sweeper retries, the mock accepts, and the phone is told it may switch.
    await sweep(h.ctx);
    const after = await device.get("/api/device/rules");
    expect(after.json.dns.ready).toBe(true);
    expect(after.headers.get("etag")).not.toBe(before.headers.get("etag"));
    expect((await parent.get(`/api/phones/${phoneId}`)).json.dnsReady).toBe(true);

    // A later failed sync leaves the phone dirty but still ready: it already uses its DNS.
    h.dns.failNext = 1;
    await parent.put(`/api/phones/${phoneId}/dns/categories/games`, { blocked: false });
    const dirty = (await parent.get(`/api/phones/${phoneId}`)).json;
    expect(dirty.dnsSynced).toBe(false);
    expect(dirty.dnsReady).toBe(true);
    expect((await device.get("/api/device/rules")).json.dns.ready).toBe(true);
  });

  it("is true at once when the first sync works", async () => {
    const parent = await signIn(h, "parent@example.org");
    const { phoneId, device } = await pairPhone(h, parent);
    expect((await device.get("/api/device/rules")).json.dns.ready).toBe(true);
    expect((await parent.get(`/api/phones/${phoneId}`)).json.dnsReady).toBe(true);
  });

  it("keeps the first confirmation time when later syncs succeed", async () => {
    const parent = await signIn(h, "parent@example.org");
    const { phoneId } = await pairPhone(h, parent);
    const first = (await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId)))[0]!.dnsConfirmedAt;
    expect(first).toEqual(h.clock.now);

    h.clock.advance(60 * 60_000);
    await parent.put(`/api/phones/${phoneId}/dns/categories/games`, { blocked: false });
    const later = (await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId)))[0]!.dnsConfirmedAt;
    expect(later).toEqual(first);
  });

  it("syncs phones that were synced before the flag existed", async () => {
    const parent = await signIn(h, "parent@example.org");
    const { phoneId, device } = await pairPhone(h, parent);
    await h.ctx.db.update(phones).set({ dnsDirty: false, dnsConfirmedAt: null }).where(eq(phones.id, phoneId));
    expect((await device.get("/api/device/rules")).json.dns.ready).toBe(false);

    await sweep(h.ctx);
    expect((await device.get("/api/device/rules")).json.dns.ready).toBe(true);
    expect((await parent.get(`/api/phones/${phoneId}`)).json.dnsSynced).toBe(true);
  });
});

describe("PUT /device/status", () => {
  async function setup() {
    const parent = await signIn(h, "parent@example.org");
    const { phoneId, device } = await pairPhone(h, parent);
    return { parent, phoneId, device };
  }

  it("needs a device token", async () => {
    await setup();
    const anon = new Client(h);
    expect((await anon.put("/api/device/status", report())).status).toBe(401);
    const wrong = new Client(h);
    wrong.token = "pp_d_not-a-real-token";
    expect((await wrong.put("/api/device/status", report())).status).toBe(401);
    const parentToken = new Client(h);
    parentToken.token = (await signIn(h, "other@example.org")).token;
    expect((await parentToken.put("/api/device/status", report())).status).toBe(401);
  });

  it("rejects invalid bodies", async () => {
    const { parent, phoneId, device } = await setup();
    const bad: [string, Record<string, unknown>][] = [
      ["battery over 100", report({ batteryPct: 101 })],
      ["battery below 0", report({ batteryPct: -1 })],
      ["battery not whole", report({ batteryPct: 50.5 })],
      ["51 failed policies", report({ failedPolicies: Array.from({ length: 51 }, (_, i) => `policy-${i}`) })],
      ["empty policy name", report({ failedPolicies: [""] })],
      ["policy name over 200", report({ failedPolicies: ["x".repeat(201)] })],
      ["empty app version", report({ appVersion: "" })],
      ["app version over 40", report({ appVersion: "v".repeat(41) })],
      ["etag over 100", report({ rulesEtag: "e".repeat(101) })],
      ["dns host over 253", report({ dnsHost: "h".repeat(254) })],
      ["applied 10 minutes ahead", report({ rulesAppliedAt: new Date(h.clock.now.getTime() + 10 * 60_000).toISOString() })],
      ["applied time without a zone", report({ rulesAppliedAt: "2026-11-16T11:59:00" })],
      ["lockIntact as text", report({ lockIntact: "yes" })],
    ];
    for (const [name, body] of bad) {
      const r = await device.put("/api/device/status", body);
      expect(r.status, name).toBe(400);
    }
    const { lockIntact: _l, ...missing } = report();
    expect((await device.put("/api/device/status", missing)).status).toBe(400);

    // Nothing was stored.
    expect((await parent.get(`/api/phones/${phoneId}`)).json.status).toBeNull();
  });

  it("accepts a report and shows it to the parent", async () => {
    const { parent, phoneId, device } = await setup();
    expect((await parent.get(`/api/phones/${phoneId}`)).json.status).toBeNull();

    const r = await device.put("/api/device/status", report());
    expect(r.status).toBe(204);
    expect(r.json).toBeNull();

    const expected = {
      appVersion: "0.4.0",
      batteryPct: 64,
      charging: true,
      deviceOwner: true,
      lockIntact: true,
      maintenance: false,
      failedPolicies: [],
      rulesEtag: '"abc123"',
      rulesAppliedAt: "2026-11-16T11:59:00.000Z",
      dnsHost: "k3m2x7q9p4r8t6w2y5z3.dns.plainphone.org",
      reportedAt: "2026-11-16T12:00:00.000Z",
    };
    expect((await parent.get(`/api/phones/${phoneId}`)).json.status).toEqual(expected);
    const list = await parent.get("/api/phones");
    expect(list.json.phones[0].status).toEqual(expected);
  });

  it("takes the nullable fields as null and a time zone offset", async () => {
    const { parent, phoneId, device } = await setup();
    const r = await device.put(
      "/api/device/status",
      report({
        batteryPct: null,
        charging: null,
        rulesEtag: null,
        rulesAppliedAt: "2026-11-16T12:30:00+01:00", // 11:30 UTC
        dnsHost: null,
        lockIntact: false,
        failedPolicies: ["DISALLOW_SAFE_BOOT", "setUserControlDisabledPackages"],
        extra: "ignored",
      }),
    );
    expect(r.status).toBe(204);
    const status = (await parent.get(`/api/phones/${phoneId}`)).json.status;
    expect(status).toMatchObject({
      batteryPct: null,
      charging: null,
      rulesEtag: null,
      rulesAppliedAt: "2026-11-16T11:30:00.000Z",
      dnsHost: null,
      lockIntact: false,
      failedPolicies: ["DISALLOW_SAFE_BOOT", "setUserControlDisabledPackages"],
    });
    expect(status).not.toHaveProperty("extra");

    // A time a few minutes ahead is clock skew, not an error.
    const skew = new Date(h.clock.now.getTime() + 4 * 60_000).toISOString();
    expect((await device.put("/api/device/status", report({ rulesAppliedAt: skew }))).status).toBe(204);
  });

  it("lets the second report replace the first", async () => {
    const { parent, phoneId, device } = await setup();
    await device.put("/api/device/status", report({ failedPolicies: ["a", "b"], lockIntact: false }));

    h.clock.advance(5 * 60_000);
    await device.put(
      "/api/device/status",
      report({ batteryPct: 12, charging: false, maintenance: true, failedPolicies: [], lockIntact: false }),
    );
    const status = (await parent.get(`/api/phones/${phoneId}`)).json.status;
    expect(status.batteryPct).toBe(12);
    expect(status.charging).toBe(false);
    expect(status.maintenance).toBe(true);
    expect(status.failedPolicies).toEqual([]);
    expect(status.reportedAt).toBe("2026-11-16T12:05:00.000Z");
  });

  it("only touches the phone that owns the token", async () => {
    const { parent, phoneId, device } = await setup();
    const other = await pairPhone(h, parent, { name: "Bo" });
    await device.put("/api/device/status", report());
    expect((await parent.get(`/api/phones/${phoneId}`)).json.status).not.toBeNull();
    expect((await parent.get(`/api/phones/${other.phoneId}`)).json.status).toBeNull();
  });
});

it("keeps acknowledged notices for seven days without extending expiry on retry", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent);
  const path = `/api/phones/${phoneId}`;
  const firstReport = h.clock.now.getTime();
  const notices = {
    parallelAppsRemoved: true,
    parallelAppsRemovedId: "4e2dfc0a-44b6-43f4-a9b2-20e2372840ae",
    lateGoogleAccountId: "133d1c12-3432-47ed-9ebb-967029aae50f",
  };
  expect((await device.put("/api/device/status", report(notices))).status).toBe(204);
  h.clock.now = new Date(firstReport + 6 * 24 * 60 * 60_000);
  expect((await device.put("/api/device/status", report(notices))).status).toBe(204);
  expect((await device.put("/api/device/status", report())).status).toBe(204);
  const { status } = (await parent.get(path)).json;
  expect(status).toMatchObject({ parallelAppsRemoved: true, lateGoogleAccount: true, lockIntact: true });
  expect(status).not.toHaveProperty("lateGoogleAccountId");
  h.clock.now = new Date(firstReport + 7 * 24 * 60 * 60_000);
  expect((await parent.get(path)).json.status).not.toHaveProperty("parallelAppsRemoved");
  expect((await parent.get(path)).json.status).not.toHaveProperty("lateGoogleAccount");
});
