// SPDX-License-Identifier: Apache-2.0
//
// The household a parent in more than one has picked (an id, not a credential). Kept in memory
// and in storage; the screens read it with useActiveHousehold() in lib/session.tsx.
import { getItem, removeItem, setItem } from "./storage";

const KEY = "pp.household";
let chosen: string | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeHouseholdChoice(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function getHouseholdChoice(): string | null {
  return chosen;
}

/** Reads the saved choice once per sign-in. */
export async function loadHouseholdChoice(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const saved = await getItem(KEY).catch(() => null);
  if (saved && chosen === null) {
    chosen = saved;
    notify();
  }
}

export async function chooseHousehold(id: string): Promise<void> {
  chosen = id;
  loaded = true;
  notify();
  await setItem(KEY, id).catch(() => undefined);
}

/** Logging out or switching server: the next person must not inherit the choice. */
export async function forgetHouseholdChoice(): Promise<void> {
  chosen = null;
  loaded = false;
  notify();
  await removeItem(KEY).catch(() => undefined);
}
