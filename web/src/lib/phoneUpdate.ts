// SPDX-License-Identifier: Apache-2.0
export interface LatestVersion {
  versionCode: number;
  versionName: string;
}

export async function fetchLatestPhoneVersion(url: string): Promise<LatestVersion | undefined> {
  const response = await fetch(url);
  if (!response.ok) return undefined;
  const release: Partial<LatestVersion> = await response.json();
  if (typeof release.versionCode === "number" && typeof release.versionName === "string") {
    return { versionCode: release.versionCode, versionName: release.versionName };
  }
}

export function usesProductionKey(version: string | null | undefined): boolean | undefined {
  const match = version?.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return undefined;
  const [, major, minor, patch] = match;
  return Number(major) > 0 || Number(minor) > 1 || (Number(minor) === 1 && Number(patch) >= 10);
}

export function hasPhoneSigningKeyChange(
  status: {
    appVersion?: string | null;
    update?: { state: string; errorCode?: string; latestVersion?: string | null };
  },
  latest?: LatestVersion,
): boolean {
  const update = status.update;
  const reportedOffer = update?.state === "prompted" || update?.state === "available"
    || update?.errorCode === "signature_mismatch" ? update.latestVersion : undefined;
  return usesProductionKey(status.appVersion) === false
    && (usesProductionKey(latest?.versionName) === true || usesProductionKey(reportedOffer) === true);
}
