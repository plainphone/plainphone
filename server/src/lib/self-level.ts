// SPDX-License-Identifier: Apache-2.0
//
// The three strictness levels of a Self phone (docs/self-keys.md, "Strictness levels"). A level is
// a name for a key, not a stored value: Mild is a 1-hour wait, Firm a 24-hour wait and Strict a
// trusted person. Anything else (6, 12, 48 or 72 hours) is "custom" and lives under Advanced, so
// a phone that set one before levels existed keeps its delay exactly and old clients see no change.

export const SELF_LEVELS = ["mild", "firm", "strict", "custom"] as const;
export type SelfLevel = (typeof SELF_LEVELS)[number];

export const MILD_HOURS = 1;
export const FIRM_HOURS = 24;

export function selfLevel(key: { keyType: "delay" | "trusted"; delayHours: number }): SelfLevel {
  if (key.keyType === "trusted") return "strict";
  if (key.delayHours === MILD_HOURS) return "mild";
  if (key.delayHours === FIRM_HOURS) return "firm";
  return "custom";
}

/** Limited emergency openings (docs/emergency-openings.md). Every opening lasts this long, for one app. */
export const EMERGENCY_MINUTES = 15;
export const MAX_EMERGENCY_ALLOWANCE = 10;
export const DEFAULT_EMERGENCY_ALLOWANCE = 3;

/** How many openings the settings are worth: nothing while the switch is off. */
export function effectiveAllowance(k: { emergencyEnabled: boolean; emergencyAllowance: number }) {
  return k.emergencyEnabled ? k.emergencyAllowance : 0;
}
