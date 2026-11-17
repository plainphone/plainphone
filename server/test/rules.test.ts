// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { locations } from "../src/db/schema.js";
import { sweep } from "../src/services/sweeper.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

async function setup(profile: "child" | "self" = "child") {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile });
  await device.put("/api/device/apps", {
    apps: [
      { packageName: "com.android.dialer", label: "Phone", core: true },
      { packageName: "com.spotify.music", label: "Spotify" },
      { packageName: "com.zhiliaoapp.musically", label: "TikTok" },
    ],
  });
  return { parent, phoneId, device };
}

describe("rules delivery", () => {
  it("serves rules with an ETag and 304 until something changes", async () => {
    const { parent, phoneId, device } = await setup();
    const first = await device.get("/api/device/rules");
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"[\w-]+"$/);
    expect(first.json.apps).toEqual({
      allowed: ["com.android.dialer", "com.spotify.music"], // core + Danish starter pack
      hidden: ["com.zhiliaoapp.musically"],
      toInstall: [],
    });
    expect(first.json.dns.host).toMatch(/\.dns\.plainphone\.org$/);
    expect(first.json.pollSeconds).toBe(60);

    expect((await device.get("/api/device/rules", { "if-none-match": etag })).status).toBe(304);
    expect((await device.get("/api/device/rules", { "if-none-match": `W/${etag}` })).status).toBe(304);

    await parent.put(`/api/phones/${phoneId}/apps/com.zhiliaoapp.musically`, { allowed: true });
    const after = await device.get("/api/device/rules", { "if-none-match": etag });
    expect(after.status).toBe(200);
    expect(after.json.apps.allowed).toContain("com.zhiliaoapp.musically");
  });

  it("wakes the phone by push when it has a token", async () => {
    const { parent, phoneId, device } = await setup();
    await device.put("/api/device/push-token", { fcmToken: "fcm-123" });
    await parent.put(`/api/phones/${phoneId}/apps/com.spotify.music`, { allowed: false });
    expect(h.push.sent).toEqual([{ token: "fcm-123", reason: "rules" }]);
  });

  it("marks apps that disappear from the phone as not installed", async () => {
    const { parent, phoneId, device } = await setup();
    await device.put("/api/device/apps", { apps: [{ packageName: "com.android.dialer", label: "Phone", core: true }] });
    const apps = await parent.get(`/api/phones/${phoneId}/apps`);
    expect(apps.json.apps.map((a: any) => a.packageName)).toEqual(["com.android.dialer"]);
  });
});

describe("rules (child profile)", () => {
  it("toggles apps but never hides core apps", async () => {
    const { parent, phoneId } = await setup();
    expect((await parent.put(`/api/phones/${phoneId}/apps/com.spotify.music`, { allowed: false })).json).toEqual({
      status: "applied",
    });
    expect((await parent.put(`/api/phones/${phoneId}/apps/com.android.dialer`, { allowed: false })).status).toBe(400);
    expect((await parent.put(`/api/phones/${phoneId}/apps/com.unknown.app`, { allowed: true })).status).toBe(404);
  });

  it("manages approved contacts in E.164", async () => {
    const { parent, phoneId, device } = await setup();
    expect((await parent.post(`/api/phones/${phoneId}/contacts`, { name: "Mor", number: "+45 12 34 56 78" })).status).toBe(
      200,
    );
    expect((await parent.post(`/api/phones/${phoneId}/contacts`, { name: "Bad", number: "12345678" })).status).toBe(400);
    const list = await parent.get(`/api/phones/${phoneId}/contacts`);
    expect(list.json.contacts).toEqual([{ id: expect.any(String), name: "Mor", number: "+4512345678" }]);
    expect((await device.get("/api/device/rules")).json.contacts).toEqual([{ name: "Mor", number: "+4512345678" }]);
    expect((await parent.del(`/api/phones/${phoneId}/contacts/${list.json.contacts[0].id}`)).status).toBe(200);
    expect((await parent.get(`/api/phones/${phoneId}/contacts`)).json.contacts).toEqual([]);
  });

  it("syncs the web filter to the DNS service and retries when it fails", async () => {
    const { parent, phoneId } = await setup();
    const clientId = (await parent.get(`/api/phones/${phoneId}/dns`)).json.host.split(".")[0];

    await parent.put(`/api/phones/${phoneId}/dns/categories/games`, { blocked: false });
    await parent.post(`/api/phones/${phoneId}/dns/allow`, { domain: "Example.COM." });
    await parent.post(`/api/phones/${phoneId}/dns/block`, { domain: "*.tiktok.com" });
    let dns = h.dns.clients.get(clientId)!;
    expect(dns.blockedCategories).not.toContain("games");
    expect(dns.allowDomains).toEqual(["example.com"]);
    expect(dns.blockDomains).toEqual(["tiktok.com"]);

    // Blocking a domain that was allowed moves it to the block list.
    await parent.post(`/api/phones/${phoneId}/dns/block`, { domain: "example.com" });
    dns = h.dns.clients.get(clientId)!;
    expect(dns.allowDomains).toEqual([]);
    expect(dns.blockDomains).toEqual(["tiktok.com", "example.com"]);

    h.dns.failNext = 1;
    await parent.put(`/api/phones/${phoneId}/dns/categories/games`, { blocked: true });
    expect((await parent.get(`/api/phones/${phoneId}/dns`)).json.synced).toBe(false);
    expect(h.dns.clients.get(clientId)!.blockedCategories).not.toContain("games");
    await sweep(h.ctx);
    expect((await parent.get(`/api/phones/${phoneId}/dns`)).json.synced).toBe(true);
    expect(h.dns.clients.get(clientId)!.blockedCategories).toContain("games");

    expect((await parent.put(`/api/phones/${phoneId}/dns/categories/news`, { blocked: true })).status).toBe(404);
    expect((await parent.post(`/api/phones/${phoneId}/dns/allow`, { domain: "not a domain" })).status).toBe(400);
  });

  it("stores school time and sends it as local times", async () => {
    const { parent, phoneId, device } = await setup();
    const r = await parent.post(`/api/phones/${phoneId}/schedules`, {
      kind: "school",
      days: [5, 1, 2, 3, 4, 1],
      startMinute: 8 * 60,
      endMinute: 14 * 60 + 30,
      allowedPackages: ["com.google.android.apps.maps"],
    });
    expect(r.status).toBe(200);
    const rules = await device.get("/api/device/rules");
    expect(rules.json.timezone).toBe("Europe/Copenhagen");
    expect(rules.json.schedules).toEqual([
      {
        id: expect.any(String),
        kind: "school",
        days: [1, 2, 3, 4, 5],
        start: "08:00",
        end: "14:30",
        allowedPackages: ["com.google.android.apps.maps"],
      },
    ]);
    expect(
      (await parent.post(`/api/phones/${phoneId}/schedules`, { kind: "school", days: [1], startMinute: 60, endMinute: 60 }))
        .status,
    ).toBe(400);
  });
});

describe("location (D7)", () => {
  it("keeps only the newest position and serves Find requests", async () => {
    const { parent, phoneId, device } = await setup();
    const loc = (lat: number, at: Date) =>
      device.put("/api/device/location", { lat, lon: 12.5, accuracyM: 20, recordedAt: at.toISOString() });

    expect((await parent.post(`/api/phones/${phoneId}/locate`)).status).toBe(202);
    expect((await device.get("/api/device/rules")).json.location.requestedAt).not.toBeNull();

    const t0 = h.clock.now;
    expect((await loc(55.6, t0)).status).toBe(204);
    expect((await loc(55.7, new Date(t0.getTime() - 60_000))).status).toBe(204); // older fix, ignored
    const got = await parent.get(`/api/phones/${phoneId}/location`);
    expect(got.json.location.lat).toBe(55.6);
    expect(got.json.requestedAt).toBeNull();

    h.clock.advance(5 * 60_000);
    await loc(55.8, h.clock.now);
    const rows = await h.ctx.db.select().from(locations).where(eq(locations.phoneId, phoneId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lat).toBe(55.8);

    // Turning location off deletes the position and refuses new ones.
    await parent.patch(`/api/phones/${phoneId}`, { locationEnabled: false });
    expect(await h.ctx.db.select().from(locations)).toHaveLength(0);
    expect((await loc(55.9, h.clock.now)).status).toBe(409);
  });

  it("is off by default on a Self phone", async () => {
    const { parent, phoneId } = await setup("self");
    expect((await parent.get(`/api/phones/${phoneId}`)).json.locationEnabled).toBe(false);
    expect((await parent.post(`/api/phones/${phoneId}/locate`)).status).toBe(409);
  });
});
