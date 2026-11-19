// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { phoneApps } from "../src/db/schema.js";
import { categoryPackages } from "../src/lib/open-mode.js";
import { sweep } from "../src/services/sweeper.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

async function phone(profile: "self" | "child") {
  const me = await signIn(h, `${profile}-open@example.org`);
  const { phoneId, device } = await pairPhone(h, me, { name: "Test phone", profile });
  await device.put("/api/device/apps", {
    apps: [
      { packageName: "com.android.dialer", label: "Phone", core: true },
      { packageName: "com.spotify.music", label: "Spotify" },
      { packageName: "com.example.notes", label: "Notes" },
      { packageName: "com.instagram.android", label: "Instagram" },
    ],
  });
  return { me, phoneId, device, base: `/api/phones/${phoneId}` };
}

const apps = async (device: Awaited<ReturnType<typeof phone>>["device"]) => (await device.get("/api/device/rules")).json.apps;

describe("open mode", () => {
  it("is on for a new Myself phone and off for a child phone", async () => {
    const self = await phone("self");
    expect((await self.me.get(self.base)).json.openMode).toBe(true);
    expect((await apps(self.device)).open).toBe(true);
    const child = await phone("child");
    expect((await child.me.get(child.base)).json.openMode).toBe(false);
    expect((await apps(child.device)).open).toBe(false);
  });

  it("allows every installed app by default, including ones that are not on any list", async () => {
    const { device } = await phone("self");
    const rules = await apps(device);
    // Notes is not in the Danish starter pack: in allow-list mode it would be hidden.
    expect(rules.allowed).toEqual(expect.arrayContaining(["com.spotify.music", "com.example.notes", "com.android.dialer"]));
    // The known social apps are on the block list, also the ones that are not installed.
    expect(rules.blocked).toEqual(expect.arrayContaining(["com.instagram.android", "com.zhiliaoapp.musically"]));
    expect(rules.hidden).toEqual(["com.instagram.android"]);
    expect(rules.allowed).not.toContain("com.instagram.android");
    // An app installed later is not listed anywhere: the phone allows it because `open` is true.
    expect(rules.blocked).not.toContain("com.example.later");
  });

  it("blocks a single app at once, and unblocking it waits for the key", async () => {
    const { me, device, base } = await phone("self");
    const block = await me.put(`${base}/apps/com.example.notes`, { allowed: false });
    expect(block.json.status).toBe("applied");
    expect((await apps(device)).blocked).toContain("com.example.notes");
    expect((await apps(device)).hidden).toContain("com.example.notes");
    expect((await me.get(`${base}/open-mode`)).json.blockedApps).toEqual([{ packageName: "com.example.notes", label: "Notes" }]);

    const unblock = await me.put(`${base}/apps/com.example.notes`, { allowed: true });
    expect(unblock.status).toBe(202);
    expect((await apps(device)).blocked).toContain("com.example.notes");
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    expect((await apps(device)).blocked).not.toContain("com.example.notes");
    expect((await apps(device)).allowed).toContain("com.example.notes");
  });

  it("maps a category to its apps and its web filter category in one action", async () => {
    const { me, device, base } = await phone("self");
    // Allowing social media loosens, so it goes through the key.
    const allow = await me.put(`${base}/open-mode/categories/social`, { blocked: false });
    expect(allow.status).toBe(202);
    expect((await me.get(`${base}/dns`)).json.blockedCategories).toContain("social");
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    expect((await me.get(`${base}/dns`)).json.blockedCategories).not.toContain("social");
    expect((await apps(device)).blocked).not.toContain("com.instagram.android");
    expect((await apps(device)).allowed).toContain("com.instagram.android");
    // The other categories are untouched.
    expect((await apps(device)).blocked).toEqual(categoryPackages(["gambling"]));

    // Blocking it again tightens: applied at once, apps and DNS together.
    const block = await me.put(`${base}/open-mode/categories/social`, { blocked: true });
    expect(block.json.status).toBe("applied");
    expect((await me.get(`${base}/dns`)).json.blockedCategories).toContain("social");
    expect((await apps(device)).blocked).toEqual(expect.arrayContaining(categoryPackages(["social"])));
    const state = (await me.get(`${base}/open-mode`)).json;
    expect(state.categories).toEqual([
      { category: "social", blocked: true, hasApps: true },
      { category: "gambling", blocked: true, hasApps: true },
      { category: "adult", blocked: true, hasApps: false },
    ]);
  });

  it("treats adult as a web filter category only", async () => {
    const { me, device, base } = await phone("self");
    const before = (await apps(device)).blocked;
    h.clock.advance(0);
    expect((await me.put(`${base}/open-mode/categories/adult`, { blocked: false })).status).toBe(202);
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    expect((await me.get(`${base}/dns`)).json.blockedCategories).not.toContain("adult");
    expect((await apps(device)).blocked).toEqual(before);
    expect((await me.put(`${base}/open-mode/categories/adult`, { blocked: true })).json.status).toBe("applied");
    expect((await me.get(`${base}/dns`)).json.blockedCategories).toContain("adult");
    expect((await me.put(`${base}/open-mode/categories/nope`, { blocked: true })).status).toBe(404);
  });

  it("turns off at once and on only through the key", async () => {
    const { me, device, base } = await phone("self");
    const off = await me.put(`${base}/open-mode`, { enabled: false });
    expect(off.json.status).toBe("applied");
    expect((await apps(device)).open).toBe(false);
    // Back to the allow-list: Notes is not in the starter pack, so it is hidden again.
    expect((await apps(device)).hidden).toContain("com.example.notes");

    const on = await me.put(`${base}/open-mode`, { enabled: true });
    expect(on.status).toBe(202);
    expect((await apps(device)).open).toBe(false);
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    expect((await apps(device)).open).toBe(true);
    expect((await apps(device)).allowed).toContain("com.example.notes");
  });

  it("waits for the key to turn off when the allow-list would show a category-blocked app", async () => {
    const { me, phoneId, device, base } = await phone("self");
    // Instagram was allowed in allow-list mode earlier and is now blocked only by its category.
    await h.ctx.db.update(phoneApps).set({ allowed: true })
      .where(and(eq(phoneApps.phoneId, phoneId), eq(phoneApps.packageName, "com.instagram.android")));
    const off = await me.put(`${base}/open-mode`, { enabled: false });
    expect(off.status).toBe(202);
    expect((await apps(device)).open).toBe(true);
    expect((await apps(device)).hidden).toContain("com.instagram.android");
  });

  it("applies every change at once on a child phone", async () => {
    const { me, device, base } = await phone("child");
    const on = await me.put(`${base}/open-mode`, { enabled: true });
    expect(on.json.status).toBe("applied");
    expect((await apps(device)).open).toBe(true);
    expect((await me.put(`${base}/open-mode/categories/social`, { blocked: true })).json.status).toBe("applied");
    expect((await apps(device)).blocked).toEqual(expect.arrayContaining(categoryPackages(["social"])));
    expect((await me.put(`${base}/open-mode/categories/social`, { blocked: false })).json.status).toBe("applied");
    expect((await apps(device)).blocked).toEqual([]);
  });

  it("never lists a core app on the block list", async () => {
    const { me, device, base } = await phone("self");
    expect((await me.put(`${base}/apps/com.android.dialer`, { allowed: false })).status).toBe(400);
    expect((await apps(device)).blocked).not.toContain("com.android.dialer");
  });
});
