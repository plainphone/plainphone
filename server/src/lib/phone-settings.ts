// SPDX-License-Identifier: Apache-2.0
//
// The catalog of phone settings the parent can set or lock, and the home screen choices.
// The contract is docs/phone-settings.md; keep the two in step.

import { z } from "zod";
import { packageName } from "./validation.js";

export const SETTING_MODES = ["free", "preset", "locked"] as const;
export type SettingMode = (typeof SETTING_MODES)[number];

export type SettingValue = string | number;

/** What one setting is set to. `value` is only present for `preset` and `locked`, and only if the setting has one. */
export interface SettingState {
  mode: SettingMode;
  value?: SettingValue;
}

/** A setting as stored: `free` is never stored, the key is simply absent. */
export interface StoredSetting {
  mode: "preset" | "locked";
  value?: SettingValue;
}
export type StoredSettings = Partial<Record<SettingKey, StoredSetting>>;

interface SettingDef {
  /** Modes beyond `free` (which every setting has). */
  modes: readonly ("preset" | "locked")[];
  /** Allowed values per mode. A mode without an entry takes no value. */
  values: { preset?: z.ZodType<SettingValue>; locked?: z.ZodType<SettingValue> };
}

const off = z.literal("off");
const onOff = z.enum(["on", "off"]);
const percent = (min: number, max: number) => z.number().int().min(min).max(max);

export const SCREEN_TIMEOUT_SECONDS = [15, 30, 60, 120, 300, 600] as const;
export const BLUETOOTH_VALUES = ["off", "noNewDevices"] as const;

/** Every setting, in the order of docs/phone-settings.md. */
const CATALOG = {
  bluetooth: { modes: ["locked"], values: { locked: z.enum(BLUETOOTH_VALUES) } },
  wifi: { modes: ["locked"], values: {} },
  mobileNetworks: { modes: ["locked"], values: {} },
  roaming: { modes: ["locked"], values: { locked: off } },
  location: { modes: ["preset", "locked"], values: { preset: onOff, locked: onOff } },
  camera: { modes: ["locked"], values: { locked: off } },
  screenCapture: { modes: ["locked"], values: { locked: off } },
  screenTimeout: {
    modes: ["preset", "locked"],
    values: {
      preset: z.literal([...SCREEN_TIMEOUT_SECONDS]),
      locked: z.literal([...SCREEN_TIMEOUT_SECONDS]),
    },
  },
  brightness: {
    modes: ["preset", "locked"],
    values: {
      preset: z.union([z.literal("auto"), percent(10, 100)]),
      locked: z.union([z.literal("auto"), percent(10, 100)]),
    },
  },
  volume: { modes: ["preset", "locked"], values: { preset: percent(0, 100), locked: z.literal("muted") } },
  wallpaper: { modes: ["locked"], values: { locked: z.literal("plainphone") } },
  language: { modes: ["locked"], values: {} },
  tethering: { modes: ["locked"], values: { locked: off } },
  nfc: { modes: ["locked"], values: { locked: off } },
  airplaneMode: { modes: ["locked"], values: { locked: off } },
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof CATALOG;

export const SETTING_KEYS = Object.keys(CATALOG) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(CATALOG, key);
}

/** The modes a setting supports, `free` first. */
export function settingModes(key: SettingKey): SettingMode[] {
  return ["free", ...(CATALOG[key] as SettingDef).modes];
}

/** Whether a mode of a setting takes a value. */
export function settingTakesValue(key: SettingKey, mode: SettingMode): boolean {
  return mode !== "free" && Boolean((CATALOG[key] as SettingDef).values[mode]);
}

/**
 * Checks one setting against the catalog. Returns the normalised state (no `value` where
 * none applies) or the reason it is not allowed.
 */
export function checkSetting(
  key: SettingKey,
  input: { mode: SettingMode; value?: SettingValue | null },
): { ok: true; setting: SettingState } | { ok: false; error: string } {
  const def = CATALOG[key] as SettingDef;
  const hasValue = input.value !== undefined && input.value !== null;
  if (input.mode === "free") {
    return hasValue ? { ok: false, error: "a free setting takes no value" } : { ok: true, setting: { mode: "free" } };
  }
  if (!def.modes.includes(input.mode)) {
    return { ok: false, error: `${key} does not support mode ${input.mode}` };
  }
  const schema = def.values[input.mode];
  if (!schema) {
    return hasValue
      ? { ok: false, error: `${key} takes no value when ${input.mode}` }
      : { ok: true, setting: { mode: input.mode } };
  }
  if (!hasValue) return { ok: false, error: `${key} needs a value when ${input.mode}` };
  const parsed = schema.safeParse(input.value);
  if (!parsed.success) return { ok: false, error: `value not supported for ${key} when ${input.mode}` };
  return { ok: true, setting: { mode: input.mode, value: parsed.data } };
}

/** The request body for `PUT /phones/{pid}/settings/{key}`, checked against the catalog. */
export function settingBody(key: SettingKey) {
  return z
    .object({
      mode: z.enum(SETTING_MODES),
      value: z.union([z.string(), z.number()]).nullish(),
    })
    .transform((input, ctx): SettingState => {
      const r = checkSetting(key, input);
      if (!r.ok) {
        ctx.addIssue({ code: "custom", message: r.error, path: ["mode"] });
        return z.NEVER;
      }
      return r.setting;
    });
}

/**
 * Whether going from `before` to `after` makes a setting less strict. A Self phone sends
 * those through the key (docs/phone-settings.md, "Self profile"):
 * - leaving `locked` (to `preset` or `free`) loosens;
 * - changing the value of a `locked` setting loosens, except Bluetooth from
 *   `noNewDevices` to `off`;
 * - everything else applies at once.
 */
export function settingLoosens(key: SettingKey, before: SettingState | undefined, after: SettingState): boolean {
  if (!before || before.mode !== "locked") return false;
  if (after.mode !== "locked") return true;
  if (before.value === after.value) return false;
  return !(key === "bluetooth" && before.value === "noNewDevices" && after.value === "off");
}

/** What a phone's stored settings look like to a parent: every key, `free` filled in. */
export function fullSettings(stored: StoredSettings | null | undefined): Record<SettingKey, SettingState> {
  const out = {} as Record<SettingKey, SettingState>;
  for (const key of SETTING_KEYS) out[key] = stored?.[key] ? { ...stored[key] } : { mode: "free" };
  return out;
}

/** What the rules document carries: only settings that are not `free`, keys in alphabetical order. */
export function rulesSettings(stored: StoredSettings | null | undefined): Record<string, StoredSetting> {
  const out: Record<string, StoredSetting> = {};
  for (const key of [...SETTING_KEYS].sort()) {
    const s = stored?.[key];
    if (s) out[key] = s.value === undefined ? { mode: s.mode } : { mode: s.mode, value: s.value };
  }
  return out;
}

// --- Home screen ---------------------------------------------------------------

export const HOME_LAYOUTS = ["list", "grid"] as const;
export const HOME_THEMES = ["system", "light", "dark"] as const;
export const HOME_PALETTES = ["grey", "sage", "sand"] as const;
export const HOME_MAX_APPS = 8;

export const homeInput = z.object({
  layout: z.enum(HOME_LAYOUTS),
  theme: z.enum(HOME_THEMES),
  palette: z.enum(HOME_PALETTES),
  apps: z
    .array(packageName)
    .max(HOME_MAX_APPS)
    .refine((apps) => new Set(apps).size === apps.length, { message: "an app can only be on the front page once" }),
});

export const homePromiseInput = z.strictObject({ showFreePromise: z.boolean() });
export const homeUpdateInput = z.union([homePromiseInput, homeInput]);
const homeWithPromise = homeInput.extend(homePromiseInput.shape);

export type Home = z.infer<typeof homeWithPromise>;
export type HomeUpdate = z.infer<typeof homeUpdateInput>;

export const DEFAULT_HOME: Home = { layout: "list", theme: "system", palette: "grey", apps: [], showFreePromise: true };

/** The stored home choices with the defaults filled in. Anything unreadable falls back to the default. */
export function fullHome(stored: unknown): Home {
  const parsed = homeWithPromise.safeParse({ ...DEFAULT_HOME, ...(stored && typeof stored === "object" ? stored : {}) });
  return parsed.success ? parsed.data : { ...DEFAULT_HOME, apps: [] };
}
