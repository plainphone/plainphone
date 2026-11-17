// SPDX-License-Identifier: Apache-2.0
//
// Round 3 "pp-let": light-mode status, time limits and the app catalog.

import { readdirSync, readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { phoneApps, phones } from "../src/db/schema.js";
import { catalogDir, catalogFile, loadCatalogs, PLAY_URL, STARTER_PACKS } from "../src/services/catalog.js";
import { addDays, limitLoosens, localDate } from "../src/services/limits.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

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

const rules = async (device: Client) => (await device.get("/api/device/rules")).json;

const report = (over: Record<string, unknown> = {}) => ({
  appVersion: "0.5.0",
  batteryPct: 64,
  charging: false,
  deviceOwner: false,
  lockIntact: true,
  maintenance: false,
  failedPolicies: [] as string[],
  rulesEtag: null,
  rulesAppliedAt: null,
  dnsHost: null,
  ...over,
});

const allOn = {
  deviceOwner: false,
  deviceAdmin: true,
  accessibility: true,
  usageAccess: true,
  vpn: true,
  alwaysOnVpn: false,
  phoneRole: true,
  smsRole: true,
  notifications: true,
  batteryUnrestricted: true,
  privateDnsOk: true,
};

describe("rules document", () => {
  it("always has timeLimits and apps.toInstall, empty when nothing is set", async () => {
    const { device } = await setup();
    const r = await rules(device);
    expect(r.timeLimits).toEqual({ total: null, apps: [], bonuses: [] });
    expect(r.apps.toInstall).toEqual([]);
  });

  it("sends limits, and bonuses only for today and tomorrow in the phone's time zone", async () => {
    const { parent, phoneId, device } = await setup();
    await parent.put(`/api/phones/${phoneId}/time-limits/total`, { minutes: 120, days: { "7": 180, "6": 180 } });
    await parent.put(`/api/phones/${phoneId}/time-limits/apps/com.spotify.music`, { minutes: 60 });
    // 12:00 UTC on Monday 16 November is 13:00 in Copenhagen.
    expect((await parent.post(`/api/phones/${phoneId}/time-limits/bonus`, { packageName: "*", minutes: 15 })).status).toBe(200);
    const r = await rules(device);
    expect(r.timeLimits).toEqual({
      total: { minutes: 120, days: { "6": 180, "7": 180 } },
      apps: [{ packageName: "com.spotify.music", minutes: 60, days: {} }],
      bonuses: [{ packageName: "*", date: "2026-11-16", minutes: 15 }],
    });
    // After local midnight the bonus belongs to yesterday and is no longer sent.
    h.clock.advance(11 * 3_600_000 + 1000); // 23:00:01 UTC = 00:00:01 Tuesday in Copenhagen
    expect((await rules(device)).timeLimits.bonuses).toEqual([]);
  });

  it("lists catalog apps the phone has not installed as toInstall", async () => {
    const { parent, phoneId, device } = await setup();
    expect((await parent.post(`/api/phones/${phoneId}/catalog`, { packageName: "dk.mitid.app.android" })).status).toBe(200);
    let r = await rules(device);
    expect(r.apps.toInstall).toEqual([{ packageName: "dk.mitid.app.android", label: "MitID" }]);
    expect(r.apps.allowed).not.toContain("dk.mitid.app.android");

    // Once installed it is an ordinary allowed app.
    await device.put("/api/device/apps", {
      apps: [
        { packageName: "com.android.dialer", label: "Phone", core: true },
        { packageName: "dk.mitid.app.android", label: "MitID" },
      ],
    });
    r = await rules(device);
    expect(r.apps.toInstall).toEqual([]);
    expect(r.apps.allowed).toContain("dk.mitid.app.android");
  });
});

describe("status with light-mode fields", () => {
  it("still accepts a report without the new fields", async () => {
    const { parent, phoneId, device } = await setup();
    expect((await device.put("/api/device/status", report())).status).toBe(204);
    const s = (await parent.get(`/api/phones/${phoneId}`)).json.status;
    expect(s).not.toHaveProperty("mode");
    expect(s).not.toHaveProperty("protections");
    expect(s).not.toHaveProperty("timeUsed");
  });

  it("stores mode, protections and timeUsed and shows them to the parent", async () => {
    const { parent, phoneId, device } = await setup();
    const used = { "*": 34, "com.spotify.music": 12 };
    expect((await device.put("/api/device/status", report({ mode: "light", protections: allOn, timeUsed: used }))).status).toBe(204);
    const s = (await parent.get(`/api/phones/${phoneId}`)).json.status;
    expect(s).toMatchObject({ mode: "light", protections: allOn, timeUsed: used, lockIntact: true });
    expect((await parent.get(`/api/phones/${phoneId}/time-limits`)).json.used).toEqual(used);
  });

  it("never shows a light-mode lock as intact when a core protection is off", async () => {
    const { parent, phoneId, device } = await setup();
    await device.put("/api/device/status", report({ mode: "light", protections: { ...allOn, vpn: false } }));
    expect((await parent.get(`/api/phones/${phoneId}`)).json.status.lockIntact).toBe(false);
    // Optional protections do not count.
    await device.put("/api/device/status", report({ mode: "light", protections: { ...allOn, alwaysOnVpn: false, notifications: false } }));
    expect((await parent.get(`/api/phones/${phoneId}`)).json.status.lockIntact).toBe(true);
  });

  async function lightPhone() {
    const env = await setup();
    await h.ctx.db.update(phones).set({ mode: "light" }).where(eq(phones.id, env.phoneId));
    return env;
  }
  const intact = async (parent: Client, phoneId: string) => (await parent.get(`/api/phones/${phoneId}`)).json.status.lockIntact;
  const REQUIRED = ["deviceAdmin", "accessibility", "usageAccess", "vpn", "phoneRole", "smsRole"] as const;

  it("needs all six light protections on a light phone, each one off or missing breaks the lock", async () => {
    const { parent, phoneId, device } = await lightPhone();
    await device.put("/api/device/status", report({ mode: "light", protections: allOn }));
    expect(await intact(parent, phoneId)).toBe(true);
    for (const k of REQUIRED) {
      await device.put("/api/device/status", report({ mode: "light", protections: { ...allOn, [k]: false } }));
      expect(await intact(parent, phoneId), `${k} off`).toBe(false);
      const { [k]: _gone, ...without } = allOn;
      await device.put("/api/device/status", report({ mode: "light", protections: without }));
      expect(await intact(parent, phoneId), `${k} missing`).toBe(false);
    }
  });

  it("on a light phone, no protections, a failed policy or maintenance is not intact", async () => {
    const { parent, phoneId, device } = await lightPhone();
    await device.put("/api/device/status", report());
    expect(await intact(parent, phoneId)).toBe(false);
    await device.put("/api/device/status", report({ mode: "light", protections: allOn, failedPolicies: ["vpn-start"] }));
    expect(await intact(parent, phoneId)).toBe(false);
    await device.put("/api/device/status", report({ mode: "light", protections: allOn, maintenance: true }));
    expect(await intact(parent, phoneId)).toBe(false);
  });

  it("a light-paired phone that reports strong and Device Owner is still judged as light", async () => {
    const { parent, phoneId, device } = await lightPhone();
    await device.put("/api/device/status", report({ mode: "strong", deviceOwner: true, protections: { ...allOn, vpn: false } }));
    expect(await intact(parent, phoneId)).toBe(false);
  });

  it("a strong phone reporting strong is not judged by light protections", async () => {
    const { parent, phoneId, device } = await setup();
    await device.put("/api/device/status", report({ mode: "strong", deviceOwner: true, protections: { ...allOn, vpn: false, accessibility: false } }));
    expect(await intact(parent, phoneId)).toBe(true);
  });

  it("rejects unknown protections and bad timeUsed", async () => {
    const { device } = await setup();
    const bad: [string, Record<string, unknown>][] = [
      ["unknown protection", report({ protections: { ...allOn, rooted: false } })],
      ["protection not boolean", report({ protections: { vpn: "yes" } })],
      ["unknown mode", report({ mode: "medium" })],
      ["minutes over a day", report({ timeUsed: { "*": 1441 } })],
      ["negative minutes", report({ timeUsed: { "*": -1 } })],
      ["bad package", report({ timeUsed: { "not a package": 3 } })],
      ["201 entries", report({ timeUsed: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`com.app.a${i}`, 1])) })],
    ];
    for (const [name, b] of bad) expect((await device.put("/api/device/status", b)).status, name).toBe(400);
    const ok = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`com.app.a${i}`, 1]));
    expect((await device.put("/api/device/status", report({ timeUsed: ok }))).status).toBe(204);
  });

  it("leaves the phone's mode alone when a light phone reports Device Owner", async () => {
    const { phoneId, device } = await setup();
    await device.put("/api/device/status", report({ mode: "strong", deviceOwner: true }));
    const [p] = await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId));
    expect(p!.mode).toBe("strong"); // paired as strong; the report does not change it either way
  });
});

describe("time limits", () => {
  it("returns limits with app labels, today's bonuses and use", async () => {
    const { parent, phoneId } = await setup();
    await parent.put(`/api/phones/${phoneId}/time-limits/apps/com.spotify.music`, { minutes: 45, days: { "6": 90 } });
    await parent.post(`/api/phones/${phoneId}/time-limits/bonus`, { packageName: "com.spotify.music", minutes: 15 });
    const r = await parent.get(`/api/phones/${phoneId}/time-limits`);
    expect(r.json).toEqual({
      total: null,
      apps: [{ packageName: "com.spotify.music", label: "Spotify", limit: { minutes: 45, days: { "6": 90 } } }],
      bonuses: [{ packageName: "com.spotify.music", date: "2026-11-16", minutes: 15 }],
      used: null,
    });
  });

  it("refuses limits on core and unknown apps, and bad limits", async () => {
    const { parent, phoneId } = await setup();
    expect((await parent.put(`/api/phones/${phoneId}/time-limits/apps/com.android.dialer`, { minutes: 30 })).status).toBe(400);
    expect((await parent.put(`/api/phones/${phoneId}/time-limits/apps/com.unknown.app`, { minutes: 30 })).status).toBe(404);
    expect((await parent.post(`/api/phones/${phoneId}/time-limits/bonus`, { packageName: "com.android.dialer", minutes: 15 })).status).toBe(400);
    for (const b of [{ minutes: 1441 }, { minutes: -1 }, { minutes: 30, days: { "8": 10 } }, { minutes: 30, days: { "1": 2000 } }, {}]) {
      expect((await parent.put(`/api/phones/${phoneId}/time-limits/total`, b)).status, JSON.stringify(b)).toBe(400);
    }
    for (const minutes of [4, 241, 10.5]) {
      expect((await parent.post(`/api/phones/${phoneId}/time-limits/bonus`, { packageName: "*", minutes })).status).toBe(400);
    }
  });

  it("removes limits", async () => {
    const { parent, phoneId, device } = await setup();
    await parent.put(`/api/phones/${phoneId}/time-limits/total`, { minutes: 60 });
    await parent.put(`/api/phones/${phoneId}/time-limits/apps/com.spotify.music`, { minutes: 30 });
    expect((await parent.del(`/api/phones/${phoneId}/time-limits/total`)).json.status).toBe("applied");
    expect((await parent.del(`/api/phones/${phoneId}/time-limits/apps/com.spotify.music`)).json.status).toBe("applied");
    expect((await rules(device)).timeLimits).toEqual({ total: null, apps: [], bonuses: [] });
  });

  it("wakes the phone when a limit changes", async () => {
    const { parent, phoneId, device } = await setup();
    await device.put("/api/device/push-token", { fcmToken: "fcm-1" });
    await parent.put(`/api/phones/${phoneId}/time-limits/total`, { minutes: 60 });
    expect(h.push.sent).toEqual([{ token: "fcm-1", reason: "rules" }]);
  });

  it("on a Self phone: lowering and adding apply at once, raising, removing and bonuses wait", async () => {
    const { parent, phoneId, device } = await setup("self");
    const total = `/api/phones/${phoneId}/time-limits/total`;
    expect((await parent.put(total, { minutes: 120 })).json.status).toBe("applied"); // adding
    expect((await parent.put(total, { minutes: 90 })).json.status).toBe("applied"); // lowering
    const weekend = await parent.put(total, { minutes: 90, days: { "6": 120 } }); // more on Saturday
    expect(weekend.status).toBe(202);
    expect(weekend.json.change.keyType).toBe("delay");
    expect((await parent.del(total)).json.status).toBe("pending");
    expect((await parent.post(`/api/phones/${phoneId}/time-limits/bonus`, { packageName: "*", minutes: 15 })).json.status).toBe(
      "pending",
    );
    expect((await rules(device)).timeLimits).toEqual({ total: { minutes: 90, days: {} }, apps: [], bonuses: [] });
    // After the delay they apply in order: the Saturday raise, then the removal.
    h.clock.advance(24 * 3_600_000);
    expect((await rules(device)).timeLimits.total).toBeNull();
  });

  it("on a Self phone, a delayed bonus counts for the day it takes effect", async () => {
    const { parent, phoneId, device } = await setup("self");
    await parent.put(`/api/phones/${phoneId}/time-limits/total`, { minutes: 60 });
    const r = await parent.post(`/api/phones/${phoneId}/time-limits/bonus`, { packageName: "*", minutes: 30 });
    expect(r.json.status).toBe("pending");
    h.clock.advance(24 * 3_600_000); // Tuesday 17 November, 13:00 in Copenhagen
    expect((await rules(device)).timeLimits.bonuses).toEqual([{ packageName: "*", date: "2026-11-17", minutes: 30 }]);
  });

  it("refuses a bonus where there is no limit", async () => {
    const { parent, phoneId } = await setup();
    expect((await parent.post(`/api/phones/${phoneId}/time-limits/bonus`, { packageName: "*", minutes: 15 })).status).toBe(400);
    expect(
      (await parent.post(`/api/phones/${phoneId}/time-limits/bonus`, { packageName: "com.spotify.music", minutes: 15 })).status,
    ).toBe(400);
  });

  it("does not apply a delayed limit to an app that became core meanwhile", async () => {
    const { parent, phoneId, device } = await setup("self");
    await parent.put(`/api/phones/${phoneId}/time-limits/apps/com.spotify.music`, { minutes: 30 });
    expect((await parent.put(`/api/phones/${phoneId}/time-limits/apps/com.spotify.music`, { minutes: 90 })).json.status).toBe("pending");
    await h.ctx.db.update(phoneApps).set({ core: true }).where(eq(phoneApps.packageName, "com.spotify.music"));
    h.clock.advance(24 * 3_600_000);
    expect((await rules(device)).timeLimits.apps).toEqual([{ packageName: "com.spotify.music", minutes: 30, days: {} }]);
  });

  it("shows use only from a report made today", async () => {
    const { parent, phoneId, device } = await setup();
    await device.put("/api/device/status", report({ timeUsed: { "*": 20 } }));
    expect((await parent.get(`/api/phones/${phoneId}/time-limits`)).json.used).toEqual({ "*": 20 });
    h.clock.advance(12 * 3_600_000); // past midnight in Copenhagen
    expect((await parent.get(`/api/phones/${phoneId}/time-limits`)).json.used).toBeNull();
  });

  it("classifies limit changes per weekday", () => {
    const l = (minutes: number, days = {}) => ({ minutes, days });
    expect(limitLoosens(null, l(60))).toBe(false);
    expect(limitLoosens(l(60), null)).toBe(true);
    expect(limitLoosens(null, null)).toBe(false);
    expect(limitLoosens(l(60), l(30))).toBe(false);
    expect(limitLoosens(l(60), l(61))).toBe(true);
    expect(limitLoosens(l(60, { "7": 120 }), l(60))).toBe(false); // Sunday goes down
    expect(limitLoosens(l(60), l(30, { "3": 61 }))).toBe(true); // Wednesday goes up
    expect(limitLoosens(l(60, { "6": 90 }), l(90, { "1": 60, "2": 60, "3": 60, "4": 60, "5": 60, "7": 60 }))).toBe(false);
  });

  it("computes local dates across time zones", () => {
    expect(localDate("Europe/Copenhagen", new Date("2026-11-16T23:30:00Z"))).toBe("2026-11-17");
    expect(localDate("America/New_York", new Date("2026-11-16T03:00:00Z"))).toBe("2026-11-15");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("app catalog", () => {
  it("serves the country list and files without a session", async () => {
    const anon = new Client(h);
    const list = await anon.get("/api/catalog");
    expect(list.status).toBe(200);
    expect(list.json).toContainEqual({ country: "dk", name: { en: "Denmark", da: "Danmark" } });
    const dk = await anon.get("/api/catalog/dk");
    expect(dk.status).toBe(200);
    expect(dk.json).toEqual(JSON.parse(readFileSync(`${catalogDir}/dk.json`, "utf8")));
    expect((await anon.get("/api/catalog/xx")).status).toBe(404);
  });

  it("shows each catalog app's state on a phone", async () => {
    const { parent, phoneId, device } = await setup();
    await device.put("/api/device/apps", {
      apps: [
        { packageName: "com.spotify.music", label: "Spotify" },
        { packageName: "dk.dr.radio", label: "DR LYD" },
      ],
    });
    await parent.put(`/api/phones/${phoneId}/apps/dk.dr.radio`, { allowed: false });
    await parent.post(`/api/phones/${phoneId}/catalog`, { packageName: "dk.mitid.app.android" });
    const r = (await parent.get(`/api/phones/${phoneId}/catalog`)).json;
    expect(r.country).toBe("dk");
    expect(r.categories.map((c: any) => c.id)).toContain("public");
    const state = Object.fromEntries(r.apps.map((a: any) => [a.packageName, a.state]));
    expect(state["com.spotify.music"]).toBe("installed-allowed");
    expect(state["dk.dr.radio"]).toBe("installed-hidden");
    expect(state["dk.mitid.app.android"]).toBe("requested");
    expect(state["dk.danskebank.mobilepay"]).toBe("none");

    // Adding an installed, hidden app shows it.
    await parent.post(`/api/phones/${phoneId}/catalog`, { packageName: "dk.dr.radio" });
    expect((await rules(device)).apps.allowed).toContain("dk.dr.radio");

    // Removing hides it and takes it off the install list.
    expect((await parent.del(`/api/phones/${phoneId}/catalog/dk.mitid.app.android`)).json.status).toBe("applied");
    const after = (await parent.get(`/api/phones/${phoneId}/catalog`)).json;
    expect(after.apps.find((a: any) => a.packageName === "dk.mitid.app.android").state).toBe("none");
    expect((await rules(device)).apps.toInstall).toEqual([]);
    const [row] = await h.ctx.db.select().from(phoneApps).where(eq(phoneApps.packageName, "dk.mitid.app.android"));
    expect(row).toMatchObject({ allowed: false, requested: false, installed: false });
  });

  it("only adds apps from the phone's own country catalog", async () => {
    const { parent, phoneId } = await setup();
    expect((await parent.post(`/api/phones/${phoneId}/catalog`, { packageName: "com.zhiliaoapp.musically" })).status).toBe(404);
    await h.ctx.db.update(phones).set({ timezone: "Europe/Berlin" }).where(eq(phones.id, phoneId));
    expect((await parent.post(`/api/phones/${phoneId}/catalog`, { packageName: "dk.mitid.app.android" })).status).toBe(404);
    expect((await parent.get(`/api/phones/${phoneId}/catalog`)).json).toEqual({ country: null, categories: [], apps: [] });
  });

  it("on a Self phone: adding waits for the key, removing applies at once", async () => {
    const { parent, phoneId, device } = await setup("self");
    const add = await parent.post(`/api/phones/${phoneId}/catalog`, { packageName: "dk.mitid.app.android" });
    expect(add.status).toBe(202);
    expect(add.json.change.op).toEqual({ type: "catalog.add", packageName: "dk.mitid.app.android", label: "MitID" });
    expect((await rules(device)).apps.toInstall).toEqual([]);
    expect((await parent.del(`/api/phones/${phoneId}/catalog/com.spotify.music`)).json.status).toBe("applied");
    expect((await rules(device)).apps.hidden).toContain("com.spotify.music");
  });

  it("is not reachable for another household's phone", async () => {
    const { phoneId } = await setup();
    const stranger = await signIn(h, "stranger@example.org");
    expect((await stranger.get(`/api/phones/${phoneId}/catalog`)).status).toBe(404);
    expect((await stranger.get(`/api/phones/${phoneId}/time-limits`)).status).toBe(404);
    expect((await stranger.put(`/api/phones/${phoneId}/time-limits/total`, { minutes: 1 })).status).toBe(404);
  });
});

describe("catalog files", () => {
  const files = readdirSync(catalogDir).filter((f) => f.endsWith(".json"));

  it("exist and load", () => {
    expect(files).toContain("dk.json");
    expect(loadCatalogs().size).toBe(files.length);
  });

  for (const file of files) {
    it(`${file} has the right shape`, () => {
      const raw = JSON.parse(readFileSync(`${catalogDir}/${file}`, "utf8"));
      const parsed = catalogFile.safeParse(raw);
      expect(parsed.error?.issues ?? []).toEqual([]);
      const c = parsed.data!;
      expect(file).toBe(`${c.country}.json`);
      const packages = c.apps.map((a) => a.packageName);
      expect(new Set(packages).size).toBe(packages.length);
      const ids = new Set(c.categories.map((x) => x.id));
      for (const a of c.apps) {
        expect(a.packageName).toMatch(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/);
        expect(ids.has(a.category), a.packageName).toBe(true);
        expect(a.source).toBe(PLAY_URL + a.packageName);
        expect(a.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(a.verifiedAt))).toBe(false);
        expect(a.playTitle.length).toBeGreaterThan(0);
      }
    });
  }

  it("rejects a file that breaks the rules", () => {
    const good = JSON.parse(readFileSync(`${catalogDir}/dk.json`, "utf8"));
    const app = good.apps[0];
    const broken = [
      { ...good, apps: [...good.apps, app] },
      { ...good, apps: [{ ...app, category: "nope" }] },
      { ...good, apps: [{ ...app, source: "https://example.com" }] },
      { ...good, apps: [{ ...app, verifiedAt: "yesterday" }] },
      { ...good, apps: [{ ...app, packageName: "not a package" }] },
    ];
    for (const b of broken) expect(catalogFile.safeParse(b).success).toBe(false);
  });

  it("derives the starter pack from starter: true", () => {
    const dk = JSON.parse(readFileSync(`${catalogDir}/dk.json`, "utf8"));
    expect(STARTER_PACKS.dk).toEqual(dk.apps.filter((a: any) => a.starter).map((a: any) => a.packageName));
    expect(STARTER_PACKS.dk).toContain("dk.mitid.app.android");
  });
});
