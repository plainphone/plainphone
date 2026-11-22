// SPDX-License-Identifier: Apache-2.0
//
// One rules sync on a child's iPhone (docs/sync-api.md; docs/ios/architecture.md, "How it talks to
// the sync API"): fetch `GET /device/rules` with the applied ETag, fetch the app selection when its
// revision changed, let the Swift module apply both, and report the receipt with
// `PUT /device/status`. The Swift side keeps the old rules when a document is invalid, so an
// error here never makes the phone looser; this file only moves bytes and reports.
import type { ScreenTime, ScreenTimeStatus } from "../../../modules/plainphone-screentime";
import type { DeviceFetch, DeviceIdentity, DeviceResponse } from "./device-api";

/** What the sync remembers between runs while the app is open. */
export interface SyncMemory {
  selectionRevision: string | null;
  selection: string | null;
  /** The server's `pollSeconds` from the last applied document, kept for `304` answers. */
  pollSeconds: number | null;
}

export const emptyMemory = (): SyncMemory => ({ selectionRevision: null, selection: null, pollSeconds: null });

export type SyncResult =
  | { outcome: "applied" | "unchanged"; status: ScreenTimeStatus; pollSeconds: number | null }
  /** The parents released the phone and the server confirmed it: forget the pairing. */
  | { outcome: "released"; status: ScreenTimeStatus }
  /** The server no longer knows this phone (removed from the dashboard). */
  | { outcome: "unpaired" }
  /** Offline or the server failed; the rules in effect stay. */
  | { outcome: "offline"; status: ScreenTimeStatus | null };

/** The body of `PUT /device/status` for an iPhone (docs/sync-api.md, "Status"). */
export function statusBody(status: ScreenTimeStatus, appVersion: string) {
  return {
    appVersion,
    // Not read on iPhones yet; null is the documented "unknown".
    batteryPct: null,
    charging: null,
    deviceOwner: false,
    lockIntact: status.lockIntact,
    maintenance: status.maintenance,
    failedPolicies: status.failedPolicies,
    rulesEtag: status.rulesEtag,
    rulesAppliedAt: status.rulesAppliedAt,
    rulesReceiptConfirmed: status.rulesReceiptConfirmed,
    dnsHost: null,
    ios: status.ios,
  };
}

/**
 * Only this `401` means the server no longer knows the phone (docs/sync-api.md, Rules, step 6).
 * Any other `401`, such as a proxy or login wall in front of a self-hosted server, is an ordinary
 * error that is retried, so it cannot unpair the phone.
 */
function isUnknownDevice(r: DeviceResponse): boolean {
  if (r.status !== 401) return false;
  try {
    return r.json<{ error?: unknown }>().error === "unknown device; pair again";
  } catch {
    return false;
  }
}

/** What the sync itself needs from the document; the Swift side checks the rest. */
function peek(document: string): { revision: string | null; release: boolean } {
  try {
    const doc = JSON.parse(document) as { release?: boolean; iosApps?: { selection?: { revision?: string } | null } };
    return { revision: doc.iosApps?.selection?.revision ?? null, release: doc.release === true };
  } catch {
    return { revision: null, release: false };
  }
}

export async function syncOnce(deps: {
  api: DeviceFetch;
  identity: DeviceIdentity;
  screenTime: ScreenTime;
  memory: SyncMemory;
  appVersion: string;
}): Promise<SyncResult> {
  const { api, identity, screenTime, memory, appVersion } = deps;
  const token = identity.deviceToken;
  let status: ScreenTimeStatus;
  try {
    status = await screenTime.status();
  } catch {
    // No Swift module or an unreadable receipt: nothing to report, try again at the next sync.
    return { outcome: "offline", status: null };
  }
  if (status.released) return acknowledgeRelease(api, token, status);

  let outcome: "applied" | "unchanged" = "unchanged";
  try {
    const headers: Record<string, string> = status.rulesEtag ? { "if-none-match": status.rulesEtag } : {};
    const rules = await api("GET", "/rules", { token, headers });
    if (isUnknownDevice(rules)) return { outcome: "unpaired" };
    if (rules.status === 200 && rules.etag) {
      const { revision, release } = peek(rules.text);
      // A release needs no apps.
      if (!release && revision !== memory.selectionRevision) {
        const sel = revision ? await api("GET", "/ios-selection", { token }) : null;
        if (sel && sel.status !== 200 && sel.status !== 404) return { outcome: "offline", status };
        memory.selection = sel?.status === 200 ? (sel.json<{ selection: string | null }>().selection ?? null) : null;
        memory.selectionRevision = revision;
      }
      status = await screenTime.applyRules(rules.text, rules.etag, identity.phoneId, memory.selection);
      outcome = "applied";
      memory.pollSeconds = rules.json<{ pollSeconds?: number }>().pollSeconds ?? null;
    } else if (rules.status !== 304) {
      return { outcome: "offline", status };
    }
    if (status.released) return acknowledgeRelease(api, token, status);
    const put = await api("PUT", "/status", { token, body: statusBody(status, appVersion) });
    if (isUnknownDevice(put)) return { outcome: "unpaired" };
  } catch {
    return { outcome: "offline", status };
  }
  return { outcome, status, pollSeconds: memory.pollSeconds };
}

/**
 * `POST /device/released`. 204 and the "unknown device" 401 both mean done; on anything else,
 * try at the next sync.
 * TODO: a 409 (no release on record) should make the phone forget the release and sync normally
 * (docs/sync-api.md, release, step 3); that needs a way to clear `released` in the Swift receipt.
 */
async function acknowledgeRelease(api: DeviceFetch, token: string, status: ScreenTimeStatus): Promise<SyncResult> {
  try {
    const r = await api("POST", "/released", { token });
    if (r.status === 204 || isUnknownDevice(r)) return { outcome: "released", status };
  } catch {
    // The phone has released itself already; only the acknowledgement waits.
  }
  return { outcome: "offline", status };
}
