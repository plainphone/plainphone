// SPDX-License-Identifier: Apache-2.0
//
// What the settings page offers: which settings exist, how they are grouped, which modes they
// support and which values can be picked. Mirrors docs/phone-settings.md; the server has the
// final word and answers 400 to anything else.

import type { MessageKey, T } from "@plainphone/i18n/translate";
import type { Home, PhoneSetting, SettingKey, SettingMode, SettingValue } from "./models";

export type ValueMode = Exclude<SettingMode, "free">;
export type SettingGroup = "connections" | "screen" | "privacy";

/** The values a mode can take. A single option is sent without asking; a mode without a spec takes no value. */
export interface ValueSpec {
  options: readonly SettingValue[];
  /** What a freshly chosen mode starts on. */
  default: SettingValue;
}

export interface SettingSpec {
  key: SettingKey;
  group: SettingGroup;
  /** Modes besides `free`, which every setting has. */
  modes: readonly ValueMode[];
  values: Partial<Record<ValueMode, ValueSpec>>;
}

const fixed = (value: SettingValue): ValueSpec => ({ options: [value], default: value });
const percents = (min: number, max: number, step: number): number[] => {
  const out: number[] = [];
  for (let n = min; n <= max; n += step) out.push(n);
  return out;
};

export const TIMEOUT_SECONDS = [15, 30, 60, 120, 300, 600] as const;

const timeout: ValueSpec = { options: TIMEOUT_SECONDS, default: 60 };
const brightness: ValueSpec = { options: ["auto", ...percents(10, 100, 10)], default: "auto" };
const onOff: ValueSpec = { options: ["on", "off"], default: "on" };

/** In the order they are shown. */
export const SETTING_SPECS: readonly SettingSpec[] = [
  // Connections
  { key: "bluetooth", group: "connections", modes: ["locked"], values: { locked: { options: ["noNewDevices", "off"], default: "noNewDevices" } } },
  { key: "wifi", group: "connections", modes: ["locked"], values: {} },
  { key: "mobileNetworks", group: "connections", modes: ["locked"], values: {} },
  { key: "roaming", group: "connections", modes: ["locked"], values: { locked: fixed("off") } },
  { key: "tethering", group: "connections", modes: ["locked"], values: { locked: fixed("off") } },
  { key: "nfc", group: "connections", modes: ["locked"], values: { locked: fixed("off") } },
  { key: "airplaneMode", group: "connections", modes: ["locked"], values: { locked: fixed("off") } },
  // Screen and sound
  { key: "screenTimeout", group: "screen", modes: ["preset", "locked"], values: { preset: timeout, locked: timeout } },
  { key: "brightness", group: "screen", modes: ["preset", "locked"], values: { preset: brightness, locked: brightness } },
  {
    key: "volume",
    group: "screen",
    modes: ["preset", "locked"],
    values: { preset: { options: percents(0, 100, 10), default: 50 }, locked: fixed("muted") },
  },
  { key: "wallpaper", group: "screen", modes: ["locked"], values: { locked: fixed("plainphone") } },
  // Privacy
  { key: "location", group: "privacy", modes: ["preset", "locked"], values: { preset: onOff, locked: onOff } },
  { key: "camera", group: "privacy", modes: ["locked"], values: { locked: fixed("off") } },
  { key: "screenCapture", group: "privacy", modes: ["locked"], values: { locked: fixed("off") } },
  // Language
];

export const SETTING_GROUPS: readonly SettingGroup[] = ["connections", "screen", "privacy"];

export function specFor(key: SettingKey): SettingSpec {
  const spec = SETTING_SPECS.find((s) => s.key === key);
  if (!spec) throw new Error(`unknown setting ${key}`);
  return spec;
}

/** Every mode the setting supports, `free` first. */
export function modesOf(spec: SettingSpec): SettingMode[] {
  return ["free", ...spec.modes];
}

/** The options to pick from, or null when the mode needs no choice (no value, or only one). */
export function pickable(spec: SettingSpec, mode: SettingMode): readonly SettingValue[] | null {
  if (mode === "free") return null;
  const v = spec.values[mode];
  return v && v.options.length > 1 ? v.options : null;
}

/**
 * The state to send for a mode. Keeps the value the setting had before when the new mode
 * accepts it, so switching between Set and Set and locked does not lose the choice.
 */
export function stateFor(spec: SettingSpec, mode: SettingMode, previous?: PhoneSetting): PhoneSetting {
  if (mode === "free") return { mode };
  const v = spec.values[mode];
  if (!v) return { mode };
  const keep = previous && previous.value !== undefined && v.options.includes(previous.value);
  return { mode, value: keep ? previous.value : v.default };
}

export function sameSetting(a: PhoneSetting, b: PhoneSetting): boolean {
  return a.mode === b.mode && (a.value ?? null) === (b.value ?? null);
}

/** Whether a change is saved at once when a mode is picked: nothing is left to choose. */
export function savesAtOnce(spec: SettingSpec, mode: SettingMode): boolean {
  return pickable(spec, mode) === null;
}

export function settingName(key: SettingKey, t: T): string {
  return t(`phoneSettings.${key}.name` as MessageKey);
}

/** A value in words, e.g. 300 as "5 minutes" and "noNewDevices" as "Only paired devices". */
export function formatSettingValue(key: SettingKey, value: SettingValue, t: T): string {
  if (typeof value === "number") {
    if (key === "screenTimeout") {
      if (value < 60) return t("phoneSettings.val.seconds", { n: value });
      const m = Math.round(value / 60);
      return m === 1 ? t("phoneSettings.val.oneMinute") : t("phoneSettings.val.minutes", { n: m });
    }
    return t("phoneSettings.val.percent", { n: value });
  }
  switch (value) {
    case "on":
      return t("phoneSettings.val.on");
    case "off":
      return t("phoneSettings.val.off");
    case "auto":
      return t("phoneSettings.val.auto");
    case "muted":
      return t("phoneSettings.val.muted");
    case "noNewDevices":
      return t("phoneSettings.val.paired");
    case "plainphone":
      return t("phoneSettings.val.plainphone");
    default:
      return value;
  }
}

// --- Home screen -------------------------------------------------------------------

export const HOME_LAYOUTS = ["list", "grid"] as const;
export const HOME_THEMES = ["system", "light", "dark"] as const;
export const HOME_PALETTES = ["grey", "sage", "sand"] as const;
export const HOME_MAX_APPS = 8;

export const DEFAULT_HOME: Home = { layout: "list", theme: "system", palette: "grey", apps: [] };

/** Moves the item at `index` one step; out-of-range moves leave the list as it is. */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** Whether two homes are the same, order of the apps included. */
export function sameHome(a: Home, b: Home): boolean {
  return (
    a.layout === b.layout &&
    a.theme === b.theme &&
    a.palette === b.palette &&
    a.apps.length === b.apps.length &&
    a.apps.every((p, i) => p === b.apps[i])
  );
}
