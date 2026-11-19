// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  checkSetting,
  DEFAULT_HOME,
  fullHome,
  fullSettings,
  homeInput,
  isSettingKey,
  rulesSettings,
  SETTING_KEYS,
  settingBody,
  settingLoosens,
  settingModes,
  settingTakesValue,
} from "../src/lib/phone-settings.js";

describe("phone settings catalog", () => {
  it("knows exactly the keys of docs/phone-settings.md", () => {
    expect([...SETTING_KEYS].sort()).toEqual(
      [
        "airplaneMode",
        "bluetooth",
        "brightness",
        "camera",
        "language",
        "location",
        "mobileNetworks",
        "nfc",
        "roaming",
        "screenCapture",
        "screenTimeout",
        "tethering",
        "volume",
        "wallpaper",
        "wifi",
      ].sort(),
    );
    expect(isSettingKey("camera")).toBe(true);
    expect(isSettingKey("toString")).toBe(false);
    expect(isSettingKey("hasOwnProperty")).toBe(false);
    expect(isSettingKey("nope")).toBe(false);
  });

  it("offers each setting the modes of the table", () => {
    expect(settingModes("bluetooth")).toEqual(["free", "locked"]);
    expect(settingModes("location")).toEqual(["free", "preset", "locked"]);
    expect(settingModes("screenTimeout")).toEqual(["free", "preset", "locked"]);
    expect(settingModes("brightness")).toEqual(["free", "preset", "locked"]);
    expect(settingModes("volume")).toEqual(["free", "preset", "locked"]);
    for (const key of ["wifi", "mobileNetworks", "roaming", "camera", "screenCapture", "wallpaper", "language", "tethering", "nfc", "airplaneMode"] as const) {
      expect(settingModes(key)).toEqual(["free", "locked"]);
    }
    expect(settingTakesValue("wifi", "locked")).toBe(false);
    expect(settingTakesValue("language", "locked")).toBe(false);
    expect(settingTakesValue("camera", "locked")).toBe(true);
    expect(settingTakesValue("camera", "free")).toBe(false);
  });

  it("accepts the values of the table and rejects the rest", () => {
    const ok = (key: Parameters<typeof checkSetting>[0], mode: "free" | "preset" | "locked", value?: string | number) =>
      checkSetting(key, { mode, value }).ok;

    expect(ok("bluetooth", "locked", "off")).toBe(true);
    expect(ok("bluetooth", "locked", "noNewDevices")).toBe(true);
    expect(ok("bluetooth", "locked", "on")).toBe(false);
    expect(ok("bluetooth", "preset", "off")).toBe(false); // cannot be "set once"
    expect(ok("bluetooth", "locked")).toBe(false); // value missing

    expect(ok("wifi", "locked")).toBe(true);
    expect(ok("wifi", "locked", "off")).toBe(false); // no value
    expect(ok("language", "locked")).toBe(true);

    expect(ok("location", "preset", "on")).toBe(true);
    expect(ok("location", "locked", "off")).toBe(true);
    expect(ok("location", "locked", "maybe")).toBe(false);

    for (const s of [15, 30, 60, 120, 300, 600]) expect(ok("screenTimeout", "preset", s)).toBe(true);
    expect(ok("screenTimeout", "locked", 45)).toBe(false);
    expect(ok("screenTimeout", "locked", "60")).toBe(false);

    expect(ok("brightness", "preset", "auto")).toBe(true);
    expect(ok("brightness", "locked", 10)).toBe(true);
    expect(ok("brightness", "locked", 100)).toBe(true);
    expect(ok("brightness", "locked", 9)).toBe(false);
    expect(ok("brightness", "locked", 101)).toBe(false);
    expect(ok("brightness", "locked", 55.5)).toBe(false);

    expect(ok("volume", "preset", 0)).toBe(true);
    expect(ok("volume", "preset", 100)).toBe(true);
    expect(ok("volume", "preset", 101)).toBe(false);
    expect(ok("volume", "preset", "muted")).toBe(false);
    expect(ok("volume", "locked", "muted")).toBe(true);
    expect(ok("volume", "locked", 50)).toBe(false);

    expect(ok("wallpaper", "locked", "plainphone")).toBe(true);
    expect(ok("wallpaper", "locked", "other")).toBe(false);
    for (const key of ["camera", "screenCapture", "roaming", "tethering", "nfc", "airplaneMode"] as const) {
      expect(ok(key, "locked", "off")).toBe(true);
      expect(ok(key, "locked", "on")).toBe(false);
    }

    expect(ok("camera", "free")).toBe(true);
    expect(ok("camera", "free", "off")).toBe(false);
  });

  it("normalises a state and parses request bodies", () => {
    expect(checkSetting("camera", { mode: "free", value: null })).toEqual({ ok: true, setting: { mode: "free" } });
    expect(settingBody("screenTimeout").parse({ mode: "preset", value: 60 })).toEqual({ mode: "preset", value: 60 });
    expect(settingBody("wifi").parse({ mode: "locked", value: null })).toEqual({ mode: "locked" });
    expect(settingBody("wifi").safeParse({ mode: "preset" }).success).toBe(false);
    expect(settingBody("wifi").safeParse({ mode: "other" }).success).toBe(false);
    expect(settingBody("wifi").safeParse({}).success).toBe(false);
  });
});

describe("settingLoosens (Self profile)", () => {
  const free = { mode: "free" as const };
  const locked = (value?: string | number) => (value === undefined ? { mode: "locked" as const } : { mode: "locked" as const, value });
  const preset = (value: string | number) => ({ mode: "preset" as const, value });

  it("lets a user lock a setting, or change a preset, at once", () => {
    expect(settingLoosens("camera", undefined, locked("off"))).toBe(false);
    expect(settingLoosens("camera", free, locked("off"))).toBe(false);
    expect(settingLoosens("screenTimeout", free, preset(60))).toBe(false);
    expect(settingLoosens("screenTimeout", preset(60), preset(300))).toBe(false);
    expect(settingLoosens("screenTimeout", preset(60), free)).toBe(false);
    expect(settingLoosens("screenTimeout", preset(60), locked(60))).toBe(false);
    expect(settingLoosens("camera", free, free)).toBe(false);
  });

  it("makes leaving locked go through the key", () => {
    expect(settingLoosens("camera", locked("off"), free)).toBe(true);
    expect(settingLoosens("wifi", locked(), free)).toBe(true);
    expect(settingLoosens("screenTimeout", locked(60), preset(60))).toBe(true);
    expect(settingLoosens("location", locked("on"), preset("on"))).toBe(true);
  });

  it("makes changing the value of a locked setting go through the key", () => {
    expect(settingLoosens("screenTimeout", locked(60), locked(120))).toBe(true);
    expect(settingLoosens("screenTimeout", locked(120), locked(60))).toBe(true);
    expect(settingLoosens("brightness", locked(40), locked("auto"))).toBe(true);
    expect(settingLoosens("location", locked("on"), locked("off"))).toBe(true);
    // Setting the same thing again changes nothing.
    expect(settingLoosens("screenTimeout", locked(60), locked(60))).toBe(false);
    expect(settingLoosens("wifi", locked(), locked())).toBe(false);
  });

  it("lets Bluetooth go from noNewDevices to off at once, but not back", () => {
    expect(settingLoosens("bluetooth", locked("noNewDevices"), locked("off"))).toBe(false);
    expect(settingLoosens("bluetooth", locked("off"), locked("noNewDevices"))).toBe(true);
    expect(settingLoosens("bluetooth", locked("noNewDevices"), free)).toBe(true);
    expect(settingLoosens("bluetooth", locked("off"), free)).toBe(true);
    expect(settingLoosens("bluetooth", free, locked("noNewDevices"))).toBe(false);
  });
});

describe("stored settings and home screen", () => {
  it("fills in free for every key and keeps only the others in the rules", () => {
    const stored = { wifi: { mode: "locked" as const }, camera: { mode: "locked" as const, value: "off" }, screenTimeout: { mode: "preset" as const, value: 60 } };
    const all = fullSettings(stored);
    expect(Object.keys(all).sort()).toEqual([...SETTING_KEYS].sort());
    expect(all.bluetooth).toEqual({ mode: "free" });
    expect(all.camera).toEqual({ mode: "locked", value: "off" });
    // Alphabetical, whatever order they were stored in.
    expect(Object.keys(rulesSettings(stored))).toEqual(["camera", "screenTimeout", "wifi"]);
    expect(rulesSettings({})).toEqual({});
    expect(rulesSettings(undefined)).toEqual({});
  });

  it("validates the home screen", () => {
    const home = { layout: "grid", theme: "dark", palette: "sand", apps: ["com.spotify.music", "dk.dr.radio"] };
    expect(homeInput.parse(home)).toEqual(home);
    expect(homeInput.safeParse({ ...home, layout: "tiles" }).success).toBe(false);
    expect(homeInput.safeParse({ ...home, theme: "auto" }).success).toBe(false);
    expect(homeInput.safeParse({ ...home, palette: "red" }).success).toBe(false);
    expect(homeInput.safeParse({ ...home, apps: ["not a package"] }).success).toBe(false);
    expect(homeInput.safeParse({ ...home, apps: ["com.spotify.music", "com.spotify.music"] }).success).toBe(false);
    const eight = Array.from({ length: 8 }, (_, i) => `com.example.app${i}`);
    expect(homeInput.safeParse({ ...home, apps: eight }).success).toBe(true);
    expect(homeInput.safeParse({ ...home, apps: [...eight, "com.example.nine"] }).success).toBe(false);
    expect(homeInput.safeParse({ layout: "list" }).success).toBe(false);
  });

  it("fills in the home defaults", () => {
    expect(DEFAULT_HOME).toEqual({ layout: "list", theme: "system", palette: "grey", apps: [], showFreePromise: true });
    expect(fullHome({})).toEqual(DEFAULT_HOME);
    expect(fullHome(null)).toEqual(DEFAULT_HOME);
    expect(fullHome({ palette: "sand" })).toEqual({ ...DEFAULT_HOME, palette: "sand" });
    expect(fullHome({ palette: "red" })).toEqual(DEFAULT_HOME);
    // The default must not be shared between callers.
    fullHome({}).apps.push("com.example.x");
    expect(DEFAULT_HOME.apps).toEqual([]);
  });
});
