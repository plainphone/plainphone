// SPDX-License-Identifier: Apache-2.0
//
// The two per-device switches for live updates. Both are on until the parent turns them off.
import { getItem, setItem } from "./storage";

const LIVE_KEY = "pp.liveUpdates";
const SOS_KEY = "pp.sosAlert";

export interface LiveSettings {
  /** Keep a live connection while the app is open. */
  enabled: boolean;
  /** Vibrate when an SOS arrives while the app is open (the push brings the sound). */
  sosAlert: boolean;
}

export const DEFAULT_LIVE_SETTINGS: LiveSettings = { enabled: true, sosAlert: true };

export async function loadLiveSettings(): Promise<LiveSettings> {
  const [live, sos] = await Promise.all([getItem(LIVE_KEY).catch(() => null), getItem(SOS_KEY).catch(() => null)]);
  return { enabled: live !== "off", sosAlert: sos !== "off" };
}

export async function saveLiveSetting(key: keyof LiveSettings, on: boolean): Promise<void> {
  await setItem(key === "enabled" ? LIVE_KEY : SOS_KEY, on ? "on" : "off");
}
