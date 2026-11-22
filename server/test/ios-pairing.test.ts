// SPDX-License-Identifier: Apache-2.0
//
// iPhone phase 1 preparation (docs/ios/architecture.md): pairing behind IOS_PAIRING_ENABLED, the
// iOS rules document, app selections and iPhone status reports.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { iosSelections, phoneApps, phones, schedules, timeBonuses, timeLimits } from "../src/db/schema.js";
import { MAX_IOS_SELECTION_BYTES } from "../src/lib/ios.js";
import { ANDROID_ONLY_RULE_KEYS, IOS_RULE_KEYS } from "../src/services/ios-rules.js";
import { localDate, TOTAL } from "../src/services/limits.js";
import { Client, pairPhone, signIn, useHarness, type Harness } from "./harness.js";

const h = useHarness();

function iosPairing(on: boolean) {
  h.ctx.cfg.IOS_PAIRING_ENABLED = on;
}

/** The iPhone starts, the parent claims the code, the iPhone collects its token. */
async function pairIphone(hh: Harness, parent: Client, profile: "child" | "self" = "child") {
  const device = new Client(hh);
  const start = await device.post("/api/device/pairings", { platform: "ios", profile, deviceInfo: { model: "iPhone" } });
  expect(start.status).toBe(201);
  const claim = await parent.post("/api/phones/claim", { code: start.json.code, name: "Test iPhone", profile });
  expect(claim.status).toBe(201);
  const poll = await device.get(`/api/device/pairings/${start.json.pairingId}`, { "x-poll-secret": start.json.pollSecret });
  expect(poll.status).toBe(200);
  device.token = poll.json.deviceToken;
  return { phoneId: claim.json.id as string, device, claim: claim.json };
}

const b64 = (bytes: number) => Buffer.alloc(bytes, 7).toString("base64");

const iosStatus = (over: Record<string, unknown> = {}) => ({
  appVersion: "1.0.0",
  batteryPct: 80,
  charging: false,
  deviceOwner: false,
  lockIntact: true,
  maintenance: false,
  failedPolicies: [],
  rulesEtag: null,
  rulesAppliedAt: null,
  dnsHost: null,
  ios: { iosVersion: "26.1", authorizationStatus: "approved", effectiveStores: ["base"], ...over },
});

describe("iPhone pairing flag", () => {
  it("answers an iPhone with a clear 'not yet' while the flag is off", async () => {
    const device = new Client(h);
    const r = await device.post("/api/device/pairings", { platform: "ios", profile: "child" });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: expect.any(String), code: "ios_pairing_not_yet" });
    // Android pairing is untouched.
    expect((await device.post("/api/device/pairings", { mode: "light" })).status).toBe(201);
  });

  it("tells the dashboard whether to offer 'Add an iPhone'", async () => {
    const parent = await signIn(h, "parent@example.org");
    expect((await parent.get("/api/me")).json.iosPairing).toBe(false);
    iosPairing(true);
    expect((await parent.get("/api/me")).json.iosPairing).toBe(true);
  });

  it("pairs an iPhone with the flag on and stores its platform and tier", async () => {
    iosPairing(true);
    const parent = await signIn(h, "parent@example.org");
    const device = new Client(h);
    const start = await device.post("/api/device/pairings", { platform: "ios", mode: "strong", profile: "child" });
    expect(start.json.platform).toBe("ios");
    const lookup = await parent.post("/api/phones/pairing-profile", { code: start.json.code });
    expect(lookup.json).toEqual({ profile: "child", mode: "light", platform: "ios" });

    const { phoneId, claim } = await (async () => {
      const claimed = await parent.post("/api/phones/claim", { code: start.json.code, name: "Test iPhone", profile: "child" });
      return { phoneId: claimed.json.id as string, claim: claimed.json };
    })();
    expect(claim).toMatchObject({ platform: "ios", tier: "family_controls", mode: "light" });
    expect(claim.capabilities).toMatchObject({ pickAppsOnPhone: "yes", calmHome: "no" });
    const [row] = await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId));
    expect(row).toMatchObject({ platform: "ios", iosTier: "family_controls", mode: "light", filterMethod: "vpn" });
  });

  it("refuses the claim when the flag went off after the iPhone started pairing", async () => {
    iosPairing(true);
    const parent = await signIn(h, "parent@example.org");
    const start = await new Client(h).post("/api/device/pairings", { platform: "ios", profile: "child" });
    iosPairing(false);
    const claim = await parent.post("/api/phones/claim", { code: start.json.code, name: "Test iPhone", profile: "child" });
    expect(claim.status).toBe(403);
    expect(claim.json.code).toBe("ios_pairing_not_yet");
    expect(await h.ctx.db.select().from(phones)).toHaveLength(0);
  });

  it("keeps Android phones Android", async () => {
    iosPairing(true);
    const parent = await signIn(h, "parent@example.org");
    const { phoneId } = await pairPhone(h, parent, { mode: "light" });
    const [row] = await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId));
    expect(row).toMatchObject({ platform: "android", iosTier: null });
  });
});

describe("iOS rules document", () => {
  it("never includes Android-only rules", async () => {
    iosPairing(true);
    const parent = await signIn(h, "parent@example.org");
    const { device, phoneId } = await pairIphone(h, parent);
    // Give the Android side something to leak: an app, a schedule, a per-app limit and a per-app bonus.
    await h.ctx.db.update(phones).set({ lockSystemLanguage: true, suggestDeviceContacts: true }).where(eq(phones.id, phoneId));
    const [phone] = await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId));
    const today = localDate(phone!.timezone, h.clock.now);
    await h.ctx.db.insert(phoneApps).values({ phoneId, packageName: "com.example.game", label: "Game", allowed: true });
    await h.ctx.db.insert(schedules).values({
      phoneId, kind: "school", days: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 900, allowedPackages: ["com.example.game"],
    });
    await h.ctx.db.insert(timeLimits).values([{ phoneId, packageName: TOTAL, minutes: 90 }, { phoneId, packageName: "com.example.game", minutes: 30 }]);
    await h.ctx.db.insert(timeBonuses).values([
      { phoneId, packageName: TOTAL, day: today, minutes: 15 },
      { phoneId, packageName: "com.example.game", day: today, minutes: 10 },
    ]);
    const r = await device.get("/api/device/rules");
    expect(r.status).toBe(200);
    const doc = r.json as Record<string, any>;
    // The data really reached the projections, cut down to what an iPhone can act on.
    expect(doc.schedules).toEqual([expect.objectContaining({ kind: "school", days: [1, 2, 3, 4, 5] })]);
    // The whole-phone limit and its "more time" stay; the per-app limit and bonus wait for app tokens.
    expect(doc.timeLimits).toEqual({ total: { minutes: 90, days: {} }, bonuses: [{ date: today, minutes: 15 }] });
    expect(JSON.stringify(doc)).not.toContain("com.example.game");
    for (const key of ANDROID_ONLY_RULE_KEYS) expect(doc, key).not.toHaveProperty(key);
    const allowed = new Set([...Object.keys(IOS_RULE_KEYS), "platform", "tier", "capabilities", "iosApps"]);
    for (const key of Object.keys(doc)) expect(allowed.has(key), key).toBe(true);
    expect(JSON.stringify(doc)).not.toMatch(/packageName|allowedPackages|filterMethod|privateDnsReady|fcm/i);
    expect(doc).toMatchObject({ platform: "ios", tier: "family_controls", iosApps: { open: false, selection: null } });
    // Left out because Family Controls cannot do them at all.
    expect(doc).not.toHaveProperty("lockSystemLanguage");
    // Kept: features an iPhone does fully or in part.
    expect(doc).toHaveProperty("sos");
    expect(doc).toHaveProperty("location");
    expect(doc).toHaveProperty("release", false);
  });

  it("serves Android phones exactly the Android document", async () => {
    const parent = await signIn(h, "parent@example.org");
    const { device } = await pairPhone(h, parent);
    const doc = (await device.get("/api/device/rules")).json;
    expect(doc).toHaveProperty("apps");
    expect(doc).toHaveProperty("mode", "strong");
    expect(doc).not.toHaveProperty("platform");
    expect(doc).not.toHaveProperty("iosApps");
  });

  it("places every key of the Android document", async () => {
    const parent = await signIn(h, "parent@example.org");
    const { device } = await pairPhone(h, parent, { profile: "self", mode: "light" });
    const doc = (await device.get("/api/device/rules")).json as Record<string, unknown>;
    const placed = new Set<string>([...Object.keys(IOS_RULE_KEYS), ...ANDROID_ONLY_RULE_KEYS]);
    for (const key of Object.keys(doc)) expect(placed.has(key), `${key} is neither iOS nor Android-only`).toBe(true);
  });
});

describe("iPhone app selections", () => {
  it("stores the parent's pick, bumps the rules and hands the bytes to the phone", async () => {
    iosPairing(true);
    const parent = await signIn(h, "parent@example.org");
    const { device, phoneId } = await pairIphone(h, parent);
    const before = await device.get("/api/device/rules");
    const selection = b64(300);
    const put = await parent.put(`/api/phones/${phoneId}/ios-selection`, { selection });
    expect(put.status).toBe(200);
    expect(put.json).toEqual({ source: "parent", updatedAt: h.clock.now.toISOString() });
    const after = await device.get("/api/device/rules", { "if-none-match": before.headers.get("etag")! });
    expect(after.status).toBe(200);
    expect(after.json.iosApps.selection).toMatchObject({ source: "parent", revision: expect.any(String) });
    expect(after.json.rulesRevision).toBeGreaterThan(before.json.rulesRevision);
    expect((await device.get("/api/device/ios-selection")).json).toMatchObject({ selection, source: "parent" });
    expect((await parent.get(`/api/phones/${phoneId}/ios-selection`)).json).toMatchObject({ selection, source: "parent" });
  });

  it("records a pick made on the iPhone after the parent PIN", async () => {
    iosPairing(true);
    const parent = await signIn(h, "parent@example.org");
    const { device, phoneId } = await pairIphone(h, parent);
    const put = await device.put("/api/device/ios-selection", { selection: b64(90) });
    expect(put.status).toBe(200);
    expect(put.json.source).toBe("phone");
    const [row] = await h.ctx.db.select().from(iosSelections).where(eq(iosSelections.phoneId, phoneId));
    expect(row).toMatchObject({ source: "phone", updatedBy: null });
  });

  it("refuses selections that are too large or not base64", async () => {
    iosPairing(true);
    const parent = await signIn(h, "parent@example.org");
    const { device, phoneId } = await pairIphone(h, parent);
    expect((await device.put("/api/device/ios-selection", { selection: b64(MAX_IOS_SELECTION_BYTES) })).status).toBe(200);
    const big = await device.put("/api/device/ios-selection", { selection: b64(MAX_IOS_SELECTION_BYTES + 3) });
    expect([400, 413]).toContain(big.status);
    const huge = await parent.put(`/api/phones/${phoneId}/ios-selection`, { selection: b64(MAX_IOS_SELECTION_BYTES * 2) });
    expect(huge.status).toBe(413);
    expect((await device.put("/api/device/ios-selection", { selection: "not base64!" })).status).toBe(400);
  });

  it("keeps selections inside the household", async () => {
    iosPairing(true);
    const parent = await signIn(h, "parent@example.org");
    const stranger = await signIn(h, "stranger@example.org");
    const { phoneId } = await pairIphone(h, parent);
    await parent.put(`/api/phones/${phoneId}/ios-selection`, { selection: b64(60) });
    expect((await stranger.get(`/api/phones/${phoneId}/ios-selection`)).status).toBe(404);
    expect((await stranger.put(`/api/phones/${phoneId}/ios-selection`, { selection: b64(60) })).status).toBe(404);
    // Another family's iPhone only ever sees its own selection.
    const other = await pairIphone(h, stranger);
    expect((await other.device.get("/api/device/ios-selection")).json.selection).toBeNull();
  });

  it("is iPhone-only: Android phones have no selection", async () => {
    const parent = await signIn(h, "parent@example.org");
    const { device, phoneId } = await pairPhone(h, parent);
    expect((await parent.put(`/api/phones/${phoneId}/ios-selection`, { selection: b64(60) })).status).toBe(409);
    expect((await parent.get(`/api/phones/${phoneId}/ios-selection`)).status).toBe(404);
    const put = await device.put("/api/device/ios-selection", { selection: b64(60) });
    expect(put.status).toBe(409);
    expect(put.json.code).toBe("not_supported");
    expect((await device.get("/api/device/ios-selection")).status).toBe(404);
  });
});

describe("iPhone status", () => {
  it("takes the iPhone's fields and judges its lock by Family Controls", async () => {
    iosPairing(true);
    const parent = await signIn(h, "parent@example.org");
    const { device, phoneId } = await pairIphone(h, parent);
    expect((await device.put("/api/device/status", iosStatus())).status).toBe(204);
    let summary = (await parent.get(`/api/phones/${phoneId}`)).json;
    expect(summary.status).toMatchObject({ lockIntact: true, ios: { iosVersion: "26.1", authorizationStatus: "approved" } });

    // Authorization revoked in Settings: never intact, whatever the phone says.
    expect((await device.put("/api/device/status", iosStatus({ authorizationStatus: "denied" }))).status).toBe(204);
    summary = (await parent.get(`/api/phones/${phoneId}`)).json;
    expect(summary.status.lockIntact).toBe(false);
  });

  it("counts the base lock alone while school time, bedtime and the daily limit are not enforced (phase 1)", async () => {
    iosPairing(true);
    const parent = await signIn(h, "parent@example.org");
    const { device, phoneId } = await pairIphone(h, parent);
    await h.ctx.db.insert(schedules).values([
      { phoneId, kind: "school", days: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 870, allowedPackages: [] },
      { phoneId, kind: "bedtime", days: [1, 2, 3, 4, 5, 6, 7], startMinute: 1260, endMinute: 420, allowedPackages: [] },
    ]);
    await h.ctx.db.insert(timeLimits).values({ phoneId, packageName: TOTAL, minutes: 90 });
    // They stay in the rules document, so phase 2 only switches the phone on.
    const doc = (await device.get("/api/device/rules")).json;
    expect(doc.schedules).toHaveLength(2);
    expect(doc.timeLimits.total).toEqual({ minutes: 90, days: {} });
    // The phone reports only the base store and nothing failed: the lock is intact, and the
    // dashboard has no iPhone line for these rows.
    expect((await device.put("/api/device/status", iosStatus())).status).toBe(204);
    const summary = (await parent.get(`/api/phones/${phoneId}`)).json;
    expect(summary.status).toMatchObject({ lockIntact: true, failedPolicies: [] });
    expect(summary.capabilities).toMatchObject({ schoolTime: "yes", bedtimeApps: "yes", timeLimits: "yes" });
  });

  it("leaves Android phones with schedules judged as before", async () => {
    const parent = await signIn(h, "parent@example.org");
    const { device, phoneId } = await pairPhone(h, parent);
    await h.ctx.db.insert(schedules).values({ phoneId, kind: "school", days: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 870, allowedPackages: [] });
    const { ios: _ios, ...android } = iosStatus();
    expect((await device.put("/api/device/status", { ...android, deviceOwner: true })).status).toBe(204);
    expect((await parent.get(`/api/phones/${phoneId}`)).json.status.lockIntact).toBe(true);
    // An Android phone's own failures still reach the dashboard.
    const failed = { ...android, deviceOwner: true, lockIntact: false, failedPolicies: ["school time could not be applied"] };
    expect((await device.put("/api/device/status", failed)).status).toBe(204);
    expect((await parent.get(`/api/phones/${phoneId}`)).json.status)
      .toMatchObject({ lockIntact: false, failedPolicies: ["school time could not be applied"] });
  });

  it("accepts fields a newer iPhone app adds", async () => {
    iosPairing(true);
    const parent = await signIn(h, "parent@example.org");
    const { device } = await pairIphone(h, parent);
    // The phone is the authority for what happened: a newer report is recorded, not refused.
    expect((await device.put("/api/device/status", iosStatus({ somethingNew: true }))).status).toBe(204);
  });

  it("records a case Apple adds later and never counts it as an intact lock", async () => {
    iosPairing(true);
    const parent = await signIn(h, "parent@example.org");
    const { device, phoneId } = await pairIphone(h, parent);
    const report = iosStatus({ iosVersion: "27.0 beta 2", authorizationStatus: "approvedWithLimits", locationAuth: "approximate" });
    expect((await device.put("/api/device/status", report)).status).toBe(204);
    const summary = (await parent.get(`/api/phones/${phoneId}`)).json;
    expect(summary.status).toMatchObject({ lockIntact: false, ios: { iosVersion: "27.0 beta 2", authorizationStatus: "approvedWithLimits" } });
  });
});
