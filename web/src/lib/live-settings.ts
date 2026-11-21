// SPDX-License-Identifier: Apache-2.0
//
// Per-device switches for live updates (docs/live-updates.md). Kept in localStorage, so they
// follow the browser and not the account. Both default to on; storage that throws (private
// mode) falls back to a value kept in memory for this tab.

import { useCallback, useSyncExternalStore } from "react";

export const LIVE_KEY = "pp.live";
export const SOS_SOUND_KEY = "pp.sosSound";
type SettingKey = typeof LIVE_KEY | typeof SOS_SOUND_KEY;

const CHANGED = "pp-live-settings";
const memory: Partial<Record<SettingKey, boolean>> = {};

export function readLiveSetting(key: SettingKey): boolean {
  try {
    return localStorage.getItem(key) !== "off";
  } catch {
    // Storage is blocked: use what this tab remembers.
  }
  return memory[key] ?? true;
}

export function writeLiveSetting(key: SettingKey, on: boolean) {
  memory[key] = on;
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    // Kept in memory only.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(fn: () => void) {
  window.addEventListener(CHANGED, fn);
  // Another tab changed it.
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(CHANGED, fn);
    window.removeEventListener("storage", fn);
  };
}

/** A switch that re-renders when it changes, here or in another tab. */
export function useLiveSetting(key: SettingKey): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => readLiveSetting(key), () => true);
  const set = useCallback((next: boolean) => writeLiveSetting(key, next), [key]);
  return [on, set];
}
