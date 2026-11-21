// SPDX-License-Identifier: Apache-2.0
//
// When a status report is worth a "phone.status" live event (docs/live-updates.md). Phones report
// often; most reports change nothing a parent sees. Only a change in what the dashboard shows
// counts: the lock, the rules receipt, the filter, the app version and update, and the battery
// in steps of ten. Minutes used and check times are left out on purpose.

import type { DeviceStatus } from "../db/schema.js";

const SHOWN = [
  "lockIntact", "deviceOwner", "maintenance", "failedPolicies", "rulesEtag", "rulesAppliedAt", "rulesReceiptConfirmed",
  "webFilterActive", "filterMethod", "filterWorking", "filterIssue", "appVersion", "androidVersion", "charging",
  "resetProtection", "accountTypes", "callRoleActionNeeded", "mode", "protections", "pushProvider", "dnsHost", "ios",
] as const satisfies readonly (keyof DeviceStatus)[];

export function statusFingerprint(s: Partial<DeviceStatus> | null | undefined): string {
  if (!s) return "";
  const shown: Record<string, unknown> = {};
  for (const key of SHOWN) shown[key] = s[key] ?? null;
  shown.battery = typeof s.batteryPct === "number" ? Math.floor(s.batteryPct / 10) : null;
  shown.update = s.update ? [s.update.state, s.update.errorCode ?? null, s.update.latestVersion] : null;
  return JSON.stringify(shown);
}

export function statusVisiblyChanged(prev: Partial<DeviceStatus> | null | undefined, next: Partial<DeviceStatus>): boolean {
  return statusFingerprint(prev) !== statusFingerprint(next);
}
