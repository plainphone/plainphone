// SPDX-License-Identifier: Apache-2.0
//
// What a phone can do, derived from its platform and tier (docs/ios/architecture.md,
// "Capability map"). The iOS rows follow the parity matrix in the iOS research (#163):
// `family_controls` is an App Store app authorized through Family Sharing, `supervised` adds a
// profile installed with Apple Configurator. The dashboard and the parent app use the map to say
// honestly, per rule, what the phone's platform cannot do.

import { IOS_TIERS, PLATFORMS } from "../db/schema.js";

export { IOS_TIERS, PLATFORMS };
export type Platform = (typeof PLATFORMS)[number];
export type IosTier = (typeof IOS_TIERS)[number];
export type Tier = "strong" | "light" | IosTier;

/** yes: Plainphone does it. partial: it does part of it, or Apple's own setting does the rest. no: not possible. */
export type Support = "yes" | "partial" | "no";

export const FEATURES = [
  "apps",
  "appNames",
  "installBlock",
  "uninstallProtection",
  "factoryResetBlock",
  "resetProtection",
  "accountLock",
  "usbBlock",
  "vpnBlock",
  "webFilter",
  "adultFilter",
  "safeSearch",
  "systemLanguage",
  "openMode",
  "schoolTime",
  "bedtimeApps",
  "bedtimeSilence",
  "timeLimits",
  "limitWarning",
  "moreTime",
  "contacts",
  "callScreening",
  "callLog",
  "helpLines",
  "sos",
  "location",
  "ring",
  "checkin",
  "pinApproval",
  "receipts",
  "health",
  "updateAlarm",
  "weeklySummary",
  "calmHome",
  "release",
  "maintenance",
  "selfKeys",
  "phoneSettings",
] as const;
export type Feature = (typeof FEATURES)[number];
export type Capabilities = Record<Feature, Support>;

const all = (support: Support): Capabilities =>
  Object.fromEntries(FEATURES.map((f) => [f, support])) as Capabilities;

/** Device Owner: everything Plainphone has. */
const STRONG: Capabilities = all("yes");

/** An ordinary app (docs/light-mode.md, "What can be got around"). */
const LIGHT: Capabilities = {
  ...STRONG,
  apps: "partial", // closed after they open, not hidden
  installBlock: "partial", // blocked once Android announces the new app
  uninstallProtection: "partial",
  factoryResetBlock: "no",
  resetProtection: "no",
  usbBlock: "no",
  vpnBlock: "no",
  safeSearch: "partial", // Chrome's managed configuration needs Device Owner
  systemLanguage: "no",
  phoneSettings: "partial",
};

/** Tier 1: Family Controls through Family Sharing, no erase and no Mac. */
const FAMILY_CONTROLS: Capabilities = {
  ...STRONG,
  apps: "partial", // shielded, not hidden (ShieldSettings .all(except:))
  appNames: "partial", // EU only on iOS 26.4+ (FamilyActivityData)
  factoryResetBlock: "no",
  usbBlock: "no",
  vpnBlock: "no",
  webFilter: "partial", // NEDNSSettingsManager: the user must enable it and can disable it
  safeSearch: "partial",
  systemLanguage: "no",
  bedtimeSilence: "partial", // Apple's Downtime, set by the parent
  moreTime: "partial",
  contacts: "partial", // Apple's Communication Limits, set by the parent
  callScreening: "no",
  callLog: "no",
  helpLines: "partial",
  ring: "partial", // no silent-switch bypass without Critical Alerts
  health: "partial",
  updateAlarm: "partial",
  weeklySummary: "partial", // usage totals stay on the phone
  calmHome: "no",
  selfKeys: "partial", // the owner can revoke authorization in Settings
  phoneSettings: "no",
};

/** Tier 2: Tier 1 plus a supervised profile from Apple Configurator. */
const SUPERVISED: Capabilities = {
  ...FAMILY_CONTROLS,
  apps: "yes", // allowListedAppBundleIDs hides everything else
  factoryResetBlock: "yes",
  usbBlock: "yes",
  vpnBlock: "yes",
  webFilter: "yes", // DNS Settings payload with ProhibitDisablement
  safeSearch: "yes",
  calmHome: "yes", // Home Screen Layout payload
  release: "partial", // removing the profile needs the Mac or its removal password
};

const BY_TIER: Record<Tier, Capabilities> = {
  strong: STRONG,
  light: LIGHT,
  family_controls: FAMILY_CONTROLS,
  supervised: SUPERVISED,
};

/** Android's tier is its mode; an iPhone without a recorded tier is Family Controls. */
export function phoneTier(phone: { platform: Platform; mode: "strong" | "light"; iosTier: IosTier | null }): Tier {
  return phone.platform === "ios" ? phone.iosTier ?? "family_controls" : phone.mode;
}

export function capabilities(tier: Tier): Capabilities {
  return { ...BY_TIER[tier] };
}
