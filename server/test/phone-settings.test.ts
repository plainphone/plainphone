// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { phoneSettings } from "../src/db/schema.js";
import { SETTING_KEYS } from "../src/lib/phone-settings.js";
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
    ],
  });
  return { parent, phoneId, device };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const rules = async (device: Setup["device"]) => (await device.get("/api/device/rules")).json;
const setting = (s: Setup, key: string, body: unknown) => s.parent.put(`/api/phones/${s.phoneId}/settings/${key}`, body);

describe("phone settings (child profile)", () => {
  it("lists every setting as free to begin with, and sends nothing to the phone", async () => {
    const s = await setup();
    const r = await s.parent.get(`/api/phones/${s.phoneId}/settings`);
    expect(r.status).toBe(200);
    expect(Object.keys(r.json.settings).sort()).toEqual([...SETTING_KEYS].sort());
    for (const key of SETTING_KEYS) expect(r.json.settings[key]).toEqual({ mode: "free" });
    const doc = await rules(s.device);
    expect(doc.settings).toEqual({});
    expect(doc.home).toEqual({ layout: "list", theme: "system", palette: "sage", apps: [] });
  });

  it("applies at once, shows in the rules in alphabetical order and changes the ETag", async () => {
    const s = await setup();
    await s.device.put("/api/device/push-token", { fcmToken: "fcm-1" });
    const before = await s.device.get("/api/device/rules");

    expect((await setting(s, "wifi", { mode: "locked" })).json).toEqual({ status: "applied" });
    expect((await setting(s, "screenTimeout", { mode: "preset", value: 60 })).json).toEqual({ status: "applied" });
    expect((await setting(s, "camera", { mode: "locked", value: "off" })).status).toBe(200);
    expect(h.push.sent.filter((p) => p.reason === "rules")).toHaveLength(3);

    const after = await s.device.get("/api/device/rules", { "if-none-match": before.headers.get("etag")! });
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(before.headers.get("etag"));
    expect(after.json.settings).toEqual({
      camera: { mode: "locked", value: "off" },
      screenTimeout: { mode: "preset", value: 60 },
      wifi: { mode: "locked" },
    });
    expect(Object.keys(after.json.settings)).toEqual(["camera", "screenTimeout", "wifi"]);

    const listed = (await s.parent.get(`/api/phones/${s.phoneId}/settings`)).json.settings;
    expect(listed.camera).toEqual({ mode: "locked", value: "off" });
    expect(listed.wifi).toEqual({ mode: "locked" });
    expect(listed.bluetooth).toEqual({ mode: "free" });

    // The ETag is the same as long as nothing changes, and free puts the setting back.
    expect((await s.device.get("/api/device/rules", { "if-none-match": after.headers.get("etag")! })).status).toBe(304);
    expect((await setting(s, "camera", { mode: "free" })).json).toEqual({ status: "applied" });
    const freed = await rules(s.device);
    expect(Object.keys(freed.settings)).toEqual(["screenTimeout", "wifi"]);
    expect((await s.parent.get(`/api/phones/${s.phoneId}/settings`)).json.settings.camera).toEqual({ mode: "free" });
  });

  it("replaces a setting's value and keeps the others", async () => {
    const s = await setup();
    await setting(s, "brightness", { mode: "preset", value: 40 });
    await setting(s, "bluetooth", { mode: "locked", value: "noNewDevices" });
    await setting(s, "brightness", { mode: "locked", value: "auto" });
    expect((await rules(s.device)).settings).toEqual({
      bluetooth: { mode: "locked", value: "noNewDevices" },
      brightness: { mode: "locked", value: "auto" },
    });
    // Freeing something that was never set is fine, and so is doing it twice.
    expect((await setting(s, "nfc", { mode: "free" })).status).toBe(200);
    expect((await setting(s, "bluetooth", { mode: "free" })).status).toBe(200);
    expect((await setting(s, "bluetooth", { mode: "free" })).status).toBe(200);
    expect(Object.keys((await rules(s.device)).settings)).toEqual(["brightness"]);
  });

  it("rejects modes, values and keys a setting does not support", async () => {
    const s = await setup();
    const bad = async (key: string, body: unknown, status = 400) => {
      const r = await setting(s, key, body);
      expect([key, body, r.status]).toEqual([key, body, status]);
    };
    await bad("bluetooth", { mode: "preset", value: "off" }); // cannot be set once
    await bad("bluetooth", { mode: "locked", value: "on" });
    await bad("bluetooth", { mode: "locked" }); // value missing
    await bad("wifi", { mode: "locked", value: "off" }); // takes no value
    await bad("camera", { mode: "free", value: "off" });
    await bad("screenTimeout", { mode: "preset", value: 45 });
    await bad("screenTimeout", { mode: "preset", value: "60" });
    await bad("brightness", { mode: "preset", value: 5 });
    await bad("brightness", { mode: "preset", value: 101 });
    await bad("volume", { mode: "preset", value: "muted" });
    await bad("volume", { mode: "locked", value: 30 });
    await bad("location", { mode: "locked", value: "sometimes" });
    await bad("wallpaper", { mode: "locked", value: "mine" });
    await bad("wifi", { mode: "other" });
    await bad("wifi", {});
    await bad("doesNotExist", { mode: "locked" }, 404);
    await bad("toString", { mode: "locked" }, 404);
    expect((await rules(s.device)).settings).toEqual({});

    const r = await setting(s, "screenTimeout", { mode: "preset", value: 45 });
    expect(r.json.error).toBe("invalid input");
    expect(r.json.issues[0].message).toMatch(/screenTimeout/);
  });

  it("keeps settings to the household of the parent", async () => {
    const s = await setup();
    const stranger = await signIn(h, "stranger@example.org");
    expect((await stranger.get(`/api/phones/${s.phoneId}/settings`)).status).toBe(404);
    expect((await stranger.put(`/api/phones/${s.phoneId}/settings/wifi`, { mode: "locked" })).status).toBe(404);
    expect((await stranger.get(`/api/phones/${s.phoneId}/home`)).status).toBe(404);
    expect((await stranger.put(`/api/phones/${s.phoneId}/home`, { layout: "list", theme: "system", palette: "sage", apps: [] })).status).toBe(404);
    expect((await s.parent.get(`/api/phones/${s.phoneId}/settings`)).status).toBe(200);
  });

  it("drops the settings together with the phone", async () => {
    const s = await setup();
    await setting(s, "wifi", { mode: "locked" });
    expect(await h.ctx.db.select().from(phoneSettings)).toHaveLength(1);
    expect((await s.parent.del(`/api/phones/${s.phoneId}`)).status).toBe(200);
    expect((await s.parent.get(`/api/phones/${s.phoneId}/settings`)).status).toBe(404);
    expect(await h.ctx.db.select().from(phoneSettings)).toHaveLength(0);
  });
});

describe("phone settings (Self profile)", () => {
  it("applies locking at once, and sends leaving a lock through the key", async () => {
    const s = await setup("self");
    expect((await setting(s, "camera", { mode: "locked", value: "off" })).status).toBe(200);
    expect((await rules(s.device)).settings.camera).toEqual({ mode: "locked", value: "off" });

    const free = await setting(s, "camera", { mode: "free" });
    expect(free.status).toBe(202);
    expect(free.json.status).toBe("pending");
    expect(free.json.change.op).toEqual({ type: "setting.set", key: "camera", setting: { mode: "free" } });
    expect(new Date(free.json.change.effectiveAt).getTime() - h.clock.now.getTime()).toBe(24 * 3_600_000);

    // Still locked, and the phone sees the countdown.
    let doc = await rules(s.device);
    expect(doc.settings.camera).toEqual({ mode: "locked", value: "off" });
    expect(doc.pendingChanges).toHaveLength(1);
    expect((await s.parent.get(`/api/phones/${s.phoneId}/settings`)).json.settings.camera.mode).toBe("locked");

    h.clock.advance(24 * 3_600_000);
    expect((await sweep(h.ctx)).applied).toBe(1);
    doc = await rules(s.device);
    expect(doc.settings.camera).toBeUndefined();
    expect(doc.pendingChanges).toHaveLength(0);
  });

  it("sends locked to preset, and a new value for a lock, through the key", async () => {
    const s = await setup("self");
    await setting(s, "screenTimeout", { mode: "locked", value: 60 });
    expect((await setting(s, "screenTimeout", { mode: "locked", value: 300 })).status).toBe(202);
    expect((await setting(s, "screenTimeout", { mode: "preset", value: 60 })).status).toBe(202);
    // Setting the same lock again changes nothing.
    expect((await setting(s, "screenTimeout", { mode: "locked", value: 60 })).status).toBe(200);
    expect((await rules(s.device)).settings.screenTimeout).toEqual({ mode: "locked", value: 60 });
    expect((await s.parent.get(`/api/phones/${s.phoneId}/changes`)).json.changes).toHaveLength(2);
  });

  it("applies preset changes and locking at once", async () => {
    const s = await setup("self");
    expect((await setting(s, "volume", { mode: "preset", value: 30 })).status).toBe(200);
    expect((await setting(s, "volume", { mode: "preset", value: 90 })).status).toBe(200);
    expect((await setting(s, "volume", { mode: "locked", value: "muted" })).status).toBe(200);
    expect((await rules(s.device)).settings.volume).toEqual({ mode: "locked", value: "muted" });
    await setting(s, "brightness", { mode: "preset", value: 50 });
    expect((await setting(s, "brightness", { mode: "free" })).status).toBe(200);
    expect(Object.keys((await rules(s.device)).settings)).toEqual(["volume"]);
  });

  it("lets Bluetooth go from noNewDevices to off at once, but not back", async () => {
    const s = await setup("self");
    await setting(s, "bluetooth", { mode: "locked", value: "noNewDevices" });
    expect((await setting(s, "bluetooth", { mode: "locked", value: "off" })).status).toBe(200);
    expect((await rules(s.device)).settings.bluetooth).toEqual({ mode: "locked", value: "off" });
    const back = await setting(s, "bluetooth", { mode: "locked", value: "noNewDevices" });
    expect(back.status).toBe(202);
    expect((await rules(s.device)).settings.bluetooth).toEqual({ mode: "locked", value: "off" });
  });

  it("does not let a loosening setting change slip in through a pending change", async () => {
    const s = await setup("self");
    await setting(s, "wifi", { mode: "locked" });
    const pending = await setting(s, "wifi", { mode: "free" });
    expect((await s.parent.post(`/api/changes/${pending.json.change.id}/cancel`)).status).toBe(204);
    h.clock.advance(25 * 3_600_000);
    await sweep(h.ctx);
    expect((await rules(s.device)).settings.wifi).toEqual({ mode: "locked" });
  });
});

describe("home screen", () => {
  const home = { layout: "grid", theme: "dark", palette: "sand", apps: ["com.spotify.music", "dk.dr.radio"] };

  it("starts with the defaults and round-trips what the parent chooses", async () => {
    const s = await setup();
    await s.device.put("/api/device/push-token", { fcmToken: "fcm-2" });
    const before = await s.device.get("/api/device/rules");
    expect((await s.parent.get(`/api/phones/${s.phoneId}/home`)).json).toEqual({
      layout: "list",
      theme: "system",
      palette: "sage",
      apps: [],
    });

    const put = await s.parent.put(`/api/phones/${s.phoneId}/home`, home);
    expect(put.status).toBe(200);
    expect(put.json).toEqual({ status: "applied" });
    expect((await s.parent.get(`/api/phones/${s.phoneId}/home`)).json).toEqual(home);
    expect(h.push.sent).toEqual([{ token: "fcm-2", reason: "rules" }]);

    const after = await s.device.get("/api/device/rules", { "if-none-match": before.headers.get("etag")! });
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(before.headers.get("etag"));
    // The order of the apps is the order on the front page.
    expect(after.json.home).toEqual(home);
    expect(after.json.settings).toEqual({});

    // Changing the home screen leaves the settings alone, and the other way round.
    await setting(s, "wifi", { mode: "locked" });
    expect((await rules(s.device)).home).toEqual(home);
    await s.parent.put(`/api/phones/${s.phoneId}/home`, { ...home, apps: [] });
    expect((await rules(s.device)).settings).toEqual({ wifi: { mode: "locked" } });
  });

  it("rejects what the home screen cannot show", async () => {
    const s = await setup();
    const bad = async (body: unknown) => expect((await s.parent.put(`/api/phones/${s.phoneId}/home`, body)).status).toBe(400);
    await bad({ ...home, layout: "tiles" });
    await bad({ ...home, theme: "auto" });
    await bad({ ...home, palette: "red" });
    await bad({ ...home, apps: ["com.spotify.music", "com.spotify.music"] });
    await bad({ ...home, apps: ["not a package"] });
    await bad({ ...home, apps: Array.from({ length: 9 }, (_, i) => `com.example.app${i}`) });
    await bad({ layout: "list" });
    expect((await s.parent.get(`/api/phones/${s.phoneId}/home`)).json.layout).toBe("list");
    const eight = Array.from({ length: 8 }, (_, i) => `com.example.app${i}`);
    expect((await s.parent.put(`/api/phones/${s.phoneId}/home`, { ...home, apps: eight })).status).toBe(200);
  });

  it("never waits for the key on a Self phone", async () => {
    const s = await setup("self");
    const put = await s.parent.put(`/api/phones/${s.phoneId}/home`, home);
    expect(put.status).toBe(200);
    expect(put.json).toEqual({ status: "applied" });
    expect((await rules(s.device)).home).toEqual(home);
    // Going back to the defaults is not a loosening either.
    const reset = await s.parent.put(`/api/phones/${s.phoneId}/home`, { layout: "list", theme: "system", palette: "sage", apps: [] });
    expect(reset.status).toBe(200);
    expect((await rules(s.device)).pendingChanges).toHaveLength(0);
  });
});
