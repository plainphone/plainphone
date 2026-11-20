// SPDX-License-Identifier: Apache-2.0
//
// The honest line under a rule that the phone's platform cannot fully do
// (docs/ios/architecture.md, "Capability map"). The server derives `capabilities` from the
// phone's platform and tier. Shared by the dashboard and the parent app.

import type { MessageKey } from "../i18n/translate";

export type Platform = "android" | "ios";
export type Support = "yes" | "partial" | "no";

/** The parts of a phone summary this needs. Old servers send none of them: an Android phone. */
export interface PlatformInfo {
  platform?: Platform;
  capabilities?: Partial<Record<string, Support>>;
}

/** The rule rows on the phone page, and the capability each one stands for. */
export const RULE_FEATURES = {
  apps: "apps",
  contacts: "contacts",
  filter: "webFilter",
  schedules: "bedtimeSilence",
  home: "calmHome",
  settings: "phoneSettings",
  key: "selfKeys",
} as const;
export type RuleRow = keyof typeof RULE_FEATURES;

const IOS_LINES: Record<(typeof RULE_FEATURES)[RuleRow], MessageKey> = {
  apps: "platform.ios.apps",
  contacts: "platform.ios.contacts",
  webFilter: "platform.ios.webFilter",
  bedtimeSilence: "platform.ios.bedtimeSilence",
  calmHome: "platform.ios.calmHome",
  phoneSettings: "platform.ios.phoneSettings",
  selfKeys: "platform.ios.selfKeys",
};

export function isIphone(phone: PlatformInfo): boolean {
  return phone.platform === "ios";
}

/**
 * The line for a rule row, or null when the phone does it fully. Android phones keep their own
 * mode notes, so only an iPhone gets these lines.
 */
export function platformLine(phone: PlatformInfo, row: string): MessageKey | null {
  if (!isIphone(phone) || !(row in RULE_FEATURES)) return null;
  const feature = RULE_FEATURES[row as RuleRow];
  const support = phone.capabilities?.[feature];
  return support === "partial" || support === "no" ? IOS_LINES[feature] : null;
}
