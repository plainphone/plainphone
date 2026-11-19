// SPDX-License-Identifier: Apache-2.0
import { diagnosticPolicy } from "./failedPolicies";

export const MIN_REMOTE_RELEASE_VERSION = "0.1.8";

type SupportPhone = {
  releaseWarningsEnabled?: boolean;
  releaseRequestedAt?: string | null;
  releaseSyncCount?: number;
  status?: { appVersion: string } | null;
};

function versionParts(version: string) {
  return /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})(?:[-+][0-9A-Za-z.-]+)?$/.exec(version)?.slice(1).map(Number);
}

const releaseMinimum = versionParts(MIN_REMOTE_RELEASE_VERSION)!;

export function isRemoteReleaseTooOld(phone: SupportPhone) {
  if (phone.releaseWarningsEnabled === false) return false;
  const version = versionParts(phone.status?.appVersion ?? "");
  if (!version) return false;
  const firstDifference = version.findIndex((part, index) => part !== releaseMinimum[index]);
  return firstDifference !== -1 && version[firstDifference]! < releaseMinimum[firstDifference]!;
}

export function releaseState(phone: SupportPhone) {
  if (!phone.releaseRequestedAt) return null;
  if (isRemoteReleaseTooOld(phone)) return "old";
  if (phone.releaseWarningsEnabled !== false && (phone.releaseSyncCount ?? 0) >= 3) return "stalled";
  return "requested";
}

export function helpUrl(locale: string, recovery = false) {
  return `https://plainphone.org/${locale === "da" ? "da/" : ""}help/${recovery ? "#recovery" : ""}`;
}

export function diagnostics(phone: {
  mode: "strong" | "light";
  androidVersion?: string | null;
  status?: { appVersion: string; failedPolicies: readonly string[] } | null;
}): string {
  const version = (value?: string | null) => value && /^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(value) ? value : null;
  return JSON.stringify({
    appVersion: version(phone.status?.appVersion),
    androidVersion: version(phone.androidVersion),
    mode: phone.mode,
    failedPolicies: phone.status ? [...new Set(phone.status.failedPolicies.map(diagnosticPolicy))] : null,
  }, null, 2);
}
