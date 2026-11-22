// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { da } from "@plainphone/i18n/da";
import { en } from "@plainphone/i18n/en";
import { makeT } from "@plainphone/i18n/translate";
import type { Op, SettingKey } from "./api";
import { describeOp } from "./ops";
import {
  DEFAULT_HOME,
  formatSettingValue,
  HOME_MAX_APPS,
  modesOf,
  moveItem,
  pickable,
  sameHome,
  sameSetting,
  savesAtOnce,
  SETTING_GROUPS,
  SETTING_SPECS,
  specFor,
  stateFor,
} from "./settings";

const tEn = makeT("en");
const tDa = makeT("da");

describe("the settings the page offers", () => {
  it("covers every setting of docs/phone-settings.md once", () => {
    const keys = SETTING_SPECS.map((s) => s.key).sort();
    expect(keys).toEqual(
      [
        "airplaneMode",
        "bluetooth",
        "brightness",
        "camera",
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
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("groups them as Connections, Screen and sound, and Privacy", () => {
    expect(SETTING_GROUPS).toEqual(["connections", "screen", "privacy"]);
    const group = (g: string) => SETTING_SPECS.filter((s) => s.group === g).map((s) => s.key);
    expect(group("connections")).toEqual(["bluetooth", "wifi", "mobileNetworks", "roaming", "tethering", "nfc", "airplaneMode"]);
    expect(group("screen")).toEqual(["screenTimeout", "brightness", "volume", "wallpaper"]);
    expect(group("privacy")).toEqual(["location", "camera", "screenCapture"]);
  });

  it("only offers the modes each setting supports", () => {
    expect(modesOf(specFor("bluetooth"))).toEqual(["free", "locked"]);
    expect(modesOf(specFor("wifi"))).toEqual(["free", "locked"]);
    for (const key of ["location", "screenTimeout", "brightness", "volume"] as const) {
      expect(modesOf(specFor(key))).toEqual(["free", "preset", "locked"]);
    }
    for (const spec of SETTING_SPECS) expect(modesOf(spec)[0]).toBe("free");
  });

  it("offers the values of the contract", () => {
    expect(pickable(specFor("bluetooth"), "locked")).toEqual(["noNewDevices", "off"]);
    expect(pickable(specFor("screenTimeout"), "preset")).toEqual([15, 30, 60, 120, 300, 600]);
    expect(pickable(specFor("location"), "locked")).toEqual(["on", "off"]);
    const brightness = pickable(specFor("brightness"), "locked")!;
    expect(brightness[0]).toBe("auto");
    expect(brightness.slice(1)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(pickable(specFor("volume"), "preset")).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    // Nothing to pick: no value at all, or only one possible value.
    expect(pickable(specFor("wifi"), "locked")).toBeNull();
    expect(pickable(specFor("camera"), "locked")).toBeNull();
    expect(pickable(specFor("volume"), "locked")).toBeNull();
    expect(pickable(specFor("camera"), "free")).toBeNull();
  });

  it("builds the state to send for a mode", () => {
    expect(stateFor(specFor("wifi"), "free")).toEqual({ mode: "free" });
    expect(stateFor(specFor("wifi"), "locked")).toEqual({ mode: "locked" });
    expect(stateFor(specFor("camera"), "locked")).toEqual({ mode: "locked", value: "off" });
    expect(stateFor(specFor("volume"), "locked")).toEqual({ mode: "locked", value: "muted" });
    expect(stateFor(specFor("wallpaper"), "locked")).toEqual({ mode: "locked", value: "plainphone" });
    expect(stateFor(specFor("screenTimeout"), "preset")).toEqual({ mode: "preset", value: 60 });
    expect(stateFor(specFor("brightness"), "preset")).toEqual({ mode: "preset", value: "auto" });
    expect(stateFor(specFor("bluetooth"), "locked")).toEqual({ mode: "locked", value: "noNewDevices" });
    // The value carries over when the new mode accepts it, and not when it does not.
    expect(stateFor(specFor("screenTimeout"), "locked", { mode: "preset", value: 300 })).toEqual({ mode: "locked", value: 300 });
    expect(stateFor(specFor("volume"), "locked", { mode: "preset", value: 30 })).toEqual({ mode: "locked", value: "muted" });
    expect(stateFor(specFor("volume"), "preset", { mode: "locked", value: "muted" })).toEqual({ mode: "preset", value: 50 });
    expect(stateFor(specFor("screenTimeout"), "locked", { mode: "preset", value: 45 })).toEqual({ mode: "locked", value: 60 });
  });

  it("only sends a value the server accepts", () => {
    // Every state the page can build must be one the contract allows for that mode.
    for (const spec of SETTING_SPECS) {
      for (const mode of modesOf(spec)) {
        const s = stateFor(spec, mode);
        expect(s.mode).toBe(mode);
        if (mode === "free" || !spec.values[mode]) expect(s.value).toBeUndefined();
        else expect(spec.values[mode]!.options).toContain(s.value);
      }
    }
  });

  it("saves at once unless a value has to be chosen first", () => {
    expect(savesAtOnce(specFor("wifi"), "locked")).toBe(true);
    expect(savesAtOnce(specFor("camera"), "locked")).toBe(true);
    expect(savesAtOnce(specFor("volume"), "locked")).toBe(true);
    expect(savesAtOnce(specFor("screenTimeout"), "free")).toBe(true);
    expect(savesAtOnce(specFor("screenTimeout"), "preset")).toBe(false);
    expect(savesAtOnce(specFor("bluetooth"), "locked")).toBe(false);
  });

  it("compares settings by mode and value", () => {
    expect(sameSetting({ mode: "free" }, { mode: "free" })).toBe(true);
    expect(sameSetting({ mode: "locked", value: 60 }, { mode: "locked", value: 60 })).toBe(true);
    expect(sameSetting({ mode: "locked", value: 60 }, { mode: "preset", value: 60 })).toBe(false);
    expect(sameSetting({ mode: "locked", value: 60 }, { mode: "locked", value: 120 })).toBe(false);
    expect(sameSetting({ mode: "locked" }, { mode: "locked", value: undefined })).toBe(true);
  });
});

describe("words for the settings", () => {
  it("has a name and a line of help for every setting, in both languages", () => {
    for (const spec of SETTING_SPECS) {
      for (const part of ["name", "desc"]) {
        const key = `phoneSettings.${spec.key}.${part}`;
        expect(en, key).toHaveProperty([key]);
        expect(da, key).toHaveProperty([key]);
      }
      expect(en, spec.key).toHaveProperty([`phoneSettings.group.${spec.group}`]);
    }
  });

  it("labels every value picker", () => {
    for (const spec of SETTING_SPECS) {
      const picks = (["preset", "locked"] as const).some((m) => pickable(spec, m));
      if (picks) {
        expect(en, spec.key).toHaveProperty([`phoneSettings.value.${spec.key}`]);
        expect(da, spec.key).toHaveProperty([`phoneSettings.value.${spec.key}`]);
      }
    }
  });

  it("writes values in plain words", () => {
    expect(formatSettingValue("screenTimeout", 15, tEn)).toBe("15 seconds");
    expect(formatSettingValue("screenTimeout", 60, tEn)).toBe("1 minute");
    expect(formatSettingValue("screenTimeout", 300, tEn)).toBe("5 minutes");
    expect(formatSettingValue("screenTimeout", 300, tDa)).toBe("5 minutter");
    expect(formatSettingValue("screenTimeout", 60, tDa)).toBe("1 minut");
    expect(formatSettingValue("brightness", "auto", tEn)).toBe("Automatic");
    expect(formatSettingValue("brightness", 40, tEn)).toBe("40 %");
    expect(formatSettingValue("volume", "muted", tDa)).toBe("Lydløs");
    expect(formatSettingValue("bluetooth", "noNewDevices", tEn)).toBe("Only paired devices");
    expect(formatSettingValue("bluetooth", "off", tDa)).toBe("Fra");
    expect(formatSettingValue("location", "on", tEn)).toBe("On");
  });

  it("describes setting and home changes for the waiting list", () => {
    const op = (key: SettingKey, setting: Extract<Op, { type: "setting.set" }>["setting"]): Op => ({ type: "setting.set", key, setting });
    expect(describeOp(op("camera", { mode: "free" }), tEn, "en")).toBe("Unlock Camera");
    expect(describeOp(op("camera", { mode: "free" }), tDa, "da")).toBe("Lås Kamera op");
    expect(describeOp(op("camera", { mode: "locked", value: "off" }), tEn, "en")).toBe("Lock Camera: Off");
    expect(describeOp(op("wifi", { mode: "locked" }), tEn, "en")).toBe("Lock Wi-Fi");
    expect(describeOp(op("screenTimeout", { mode: "locked", value: 300 }), tEn, "en")).toBe("Lock Screen timeout: 5 minutes");
    expect(describeOp(op("screenTimeout", { mode: "preset", value: 120 }), tEn, "en")).toBe("Set Screen timeout to 2 minutes, without a lock");
    expect(describeOp(op("bluetooth", { mode: "locked", value: "off" }), tDa, "da")).toBe("Lås Bluetooth: Fra");
    expect(describeOp({ type: "home.set", home: DEFAULT_HOME }, tEn, "en")).toBe("Change the home screen");
    expect(describeOp({ type: "home.set", home: DEFAULT_HOME }, tDa, "da")).toBe("Ændr hjemmeskærmen");
  });
});

describe("home screen helpers", () => {
  it("moves an app one step up or down and stops at the ends", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(list, 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(list, 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(list, 2, 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(list, 5, -1)).toEqual(["a", "b", "c"]);
    // The original is left alone.
    expect(list).toEqual(["a", "b", "c"]);
  });

  it("knows the defaults and the limit of the contract", () => {
    expect(DEFAULT_HOME).toEqual({ layout: "list", theme: "system", palette: "grey", apps: [] });
    expect(HOME_MAX_APPS).toBe(8);
  });

  it("compares homes including the order of the apps", () => {
    const home = { ...DEFAULT_HOME, apps: ["a", "b"] };
    expect(sameHome(home, { ...home, apps: ["a", "b"] })).toBe(true);
    expect(sameHome(home, { ...home, apps: ["b", "a"] })).toBe(false);
    expect(sameHome(home, { ...home, apps: ["a"] })).toBe(false);
    expect(sameHome(home, { ...home, palette: "sand" })).toBe(false);
  });
});
