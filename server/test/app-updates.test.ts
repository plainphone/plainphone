// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { phoneApps, phones } from "../src/db/schema.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

const report = (appUpdates?: Record<string, unknown>) => ({
  appVersion: "0.1.16",
  batteryPct: 80,
  charging: true,
  deviceOwner: true,
  lockIntact: true,
  maintenance: false,
  failedPolicies: [] as string[],
  rulesEtag: null,
  rulesAppliedAt: null,
  dnsHost: null,
  ...(appUpdates ? { appUpdates } : {}),
});

const window = (over: Record<string, unknown> = {}) => ({
  id: "w1",
  trigger: "night",
  openedAt: "2026-11-16T02:10:00Z",
  closedAt: "2026-11-16T02:55:00Z",
  updated: 3,
  caught: [] as string[],
  ...over,
});

async function setup(openMode = false) {
  const mum = await signIn(h, "mum@example.org");
  await mum.post("/api/notifications/subscriptions", {
    platform: "web",
    endpoint: "https://fcm.googleapis.com/fcm/send/mum",
    keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
  });
  const { phoneId, device } = await pairPhone(h, mum, { name: "Alma", profile: "child" });
  await h.ctx.db.update(phones).set({ openMode }).where(eq(phones.id, phoneId));
  await device.put("/api/device/apps", {
    apps: [
      { packageName: "com.google.android.apps.maps", label: "Maps" },
      { packageName: "com.example.game", label: "Game" },
    ],
  });
  return { mum, phoneId, device };
}

describe("app updates in strong mode", () => {
  it("is on by default and the parent can switch the nightly window off", async () => {
    const { mum, phoneId, device } = await setup();
    expect((await device.get("/api/device/rules")).json.appUpdates).toEqual({ automatic: true, requestedAt: null, reportedWindow: null, recordedApps: [] });
    expect((await mum.get(`/api/phones/${phoneId}`)).json).toMatchObject({ appUpdatesEnabled: true, appUpdatesRequestedAt: null });
    const off = await mum.patch(`/api/phones/${phoneId}`, { appUpdatesEnabled: false });
    expect(off.json.appUpdatesEnabled).toBe(false);
    expect((await device.get("/api/device/rules")).json.appUpdates.automatic).toBe(false);
  });

  it("\"Update apps now\" reaches the phone in the rules", async () => {
    const { mum, phoneId, device } = await setup();
    expect((await mum.post(`/api/phones/${phoneId}/app-updates`)).status).toBe(202);
    expect((await device.get("/api/device/rules")).json.appUpdates.requestedAt).toBe(h.clock.now.toISOString());
    expect((await mum.get(`/api/phones/${phoneId}`)).json.appUpdatesRequestedAt).toBe(h.clock.now.toISOString());
  });

  it("refuses \"Update apps now\" for a light-mode phone, which never blocks updates", async () => {
    const { mum, phoneId } = await setup();
    await h.ctx.db.update(phones).set({ mode: "light" }).where(eq(phones.id, phoneId));
    expect((await mum.post(`/api/phones/${phoneId}/app-updates`)).status).toBe(409);
  });

  it("shows the parent the last window the phone reported", async () => {
    const { mum, phoneId, device } = await setup();
    expect((await device.put("/api/device/status", report(window()))).status).toBe(204);
    expect((await mum.get(`/api/phones/${phoneId}`)).json.status.appUpdates).toEqual(window());
    // A window that could not open is recorded too.
    const failed = window({ id: "w2", trigger: "parent", openedAt: null, updated: 0, error: "batteryExemption" });
    expect((await device.put("/api/device/status", report(failed))).status).toBe(204);
    expect((await mum.get(`/api/phones/${phoneId}`)).json.status.appUpdates).toEqual(failed);
  });

  it("turns a new app caught in the window into one request and tells the phone", async () => {
    const { mum, phoneId, device } = await setup();
    const caught = window({ caught: ["com.example.game", "com.example.unlisted"] });
    await device.put("/api/device/status", report(caught));
    const requests = (await mum.get(`/api/phones/${phoneId}/requests`)).json.requests;
    expect(requests.map((r: { packageName: string }) => r.packageName).sort())
      .toEqual(["com.example.game", "com.example.unlisted"]);
    expect(h.parentPush.sent.filter((s) => s.msg.title === "Alma asks for an app")).toHaveLength(2);
    const rules = (await device.get("/api/device/rules")).json;
    expect(rules.appUpdates.reportedWindow).toBe("w1");
    expect(rules.appUpdates.recordedApps).toEqual(["com.example.game", "com.example.unlisted"]);
    expect(rules.apps.hidden).toEqual(expect.arrayContaining(["com.example.game", "com.example.unlisted"]));
    // The same report again changes nothing.
    await device.put("/api/device/status", report(caught));
    expect((await mum.get(`/api/phones/${phoneId}/requests`)).json.requests).toHaveLength(2);
  });

  it("blocks a caught app in open mode until a parent approves it", async () => {
    const { mum, phoneId, device } = await setup(true);
    expect((await device.get("/api/device/rules")).json.apps.allowed).toContain("com.example.game");
    await device.put("/api/device/status", report(window({ caught: ["com.example.game"] })));
    const rules = (await device.get("/api/device/rules")).json;
    expect(rules.apps.blocked).toContain("com.example.game");
    const [request] = (await mum.get(`/api/phones/${phoneId}/requests`)).json.requests;
    await mum.post(`/api/phones/${phoneId}/requests/${request.id}/approve`, {});
    expect((await device.get("/api/device/rules")).json.apps.blocked).not.toContain("com.example.game");
  });

  it("leaves an app the parents allowed before alone", async () => {
    const { mum, phoneId, device } = await setup();
    await h.ctx.db.update(phoneApps).set({ allowed: true }).where(eq(phoneApps.packageName, "com.google.android.apps.maps"));
    await device.put("/api/device/status", report(window({ caught: ["com.google.android.apps.maps"] })));
    expect((await mum.get(`/api/phones/${phoneId}/requests`)).json.requests).toEqual([]);
    expect((await device.get("/api/device/rules")).json.apps.allowed).toContain("com.google.android.apps.maps");
  });

  it("records an app caught later in the same window", async () => {
    const { mum, phoneId, device } = await setup();
    await device.put("/api/device/status", report(window({ caught: ["com.example.game"] })));
    await device.put("/api/device/status", report(window({ caught: ["com.example.game", "com.example.unlisted"] })));
    const requests = (await mum.get(`/api/phones/${phoneId}/requests`)).json.requests;
    expect(requests.map((r: { packageName: string }) => r.packageName).sort())
      .toEqual(["com.example.game", "com.example.unlisted"]);
    expect((await device.get("/api/device/rules")).json.appUpdates.recordedApps)
      .toEqual(["com.example.game", "com.example.unlisted"]);
  });

  it("records an app held back from a window the server never heard about under the next one", async () => {
    const { mum, phoneId, device } = await setup();
    // w1 reached the server before the guard caught the game; the phone carries it over into w2.
    await device.put("/api/device/status", report(window()));
    await device.put("/api/device/status", report(window({ id: "w2", trigger: "parent", caught: ["com.example.game"] })));
    const [request] = (await mum.get(`/api/phones/${phoneId}/requests`)).json.requests;
    expect(request.packageName).toBe("com.example.game");
    const rules = (await device.get("/api/device/rules")).json;
    expect(rules.appUpdates).toMatchObject({ reportedWindow: "w2", recordedApps: ["com.example.game"] });
  });
});
