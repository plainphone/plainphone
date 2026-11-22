// SPDX-License-Identifier: Apache-2.0
//
// Pairing a child's iPhone (docs/sync-api.md, "Pairing"; docs/ios/architecture.md, phase 1): the
// iPhone asks for a code with `platform: "ios"`, shows it with a QR code, and polls until the
// parent claims it in their app. The state machine is pure, so every path is unit tested; the
// two network steps are plain functions the screen calls.
import type { DeviceFetch } from "./device-api";

export interface ShownCode {
  pairingId: string;
  pollSecret: string;
  code: string;
  qrUrl: string;
  expiresAt: string;
}

export type PairingState =
  | { step: "idle" }
  | { step: "starting" }
  /** The server does not pair iPhones yet (IOS_PAIRING_ENABLED is off). Not an error. */
  | { step: "notYet" }
  | ({ step: "showing" } & ShownCode)
  | { step: "paired"; phoneId: string; deviceToken: string }
  | { step: "expired" }
  | { step: "failed" };

export type PairingEvent =
  | { type: "start" }
  | { type: "started"; code: ShownCode }
  | { type: "notYet" }
  | { type: "waiting" }
  | { type: "paired"; phoneId: string; deviceToken: string }
  | { type: "expired" }
  | { type: "failed" };

export const POLL_MS = 2_000;

export function pairingReducer(state: PairingState, event: PairingEvent): PairingState {
  // Paired is final: the token is saved before anything else happens.
  if (state.step === "paired") return state;
  switch (event.type) {
    case "start":
      return state.step === "starting" || state.step === "showing" ? state : { step: "starting" };
    case "started":
      return state.step === "starting" ? { step: "showing", ...event.code } : state;
    case "notYet":
      return state.step === "starting" ? { step: "notYet" } : state;
    case "waiting":
      // A fresh object, so the screen schedules the next poll.
      return state.step === "showing" ? { ...state } : state;
    case "paired":
      return state.step === "showing" ? { step: "paired", phoneId: event.phoneId, deviceToken: event.deviceToken } : state;
    case "expired":
      return state.step === "showing" ? { step: "expired" } : state;
    case "failed":
      // A failed poll keeps the code on screen; only a failed start is an error.
      return state.step === "starting" ? { step: "failed" } : state;
  }
}

/** `POST /device/pairings` for this iPhone. */
export async function startPairing(api: DeviceFetch, deviceInfo: Record<string, string>): Promise<PairingEvent> {
  try {
    const r = await api("POST", "/pairings", { body: { platform: "ios", profile: "child", deviceInfo } });
    if (r.status === 201) {
      const { pairingId, pollSecret, code, qrUrl, expiresAt } = r.json<ShownCode>();
      return { type: "started", code: { pairingId, pollSecret, code, qrUrl, expiresAt } };
    }
    if (r.status === 403 && r.json<{ code?: string }>().code === "ios_pairing_not_yet") return { type: "notYet" };
    return { type: "failed" };
  } catch {
    return { type: "failed" };
  }
}

/** One `GET /device/pairings/{id}`. `now` decides when a code has run out on this side too. */
export async function pollPairing(api: DeviceFetch, shown: ShownCode, now: Date): Promise<PairingEvent> {
  try {
    const r = await api("GET", `/pairings/${encodeURIComponent(shown.pairingId)}`, { headers: { "x-poll-secret": shown.pollSecret } });
    if (r.status === 200) {
      const { phoneId, deviceToken } = r.json<{ phoneId: string; deviceToken: string }>();
      if (phoneId && deviceToken) return { type: "paired", phoneId, deviceToken };
      return { type: "failed" };
    }
    if (r.status === 410 || r.status === 404) return { type: "expired" };
  } catch {
    // Offline for a moment: keep showing the code.
  }
  return new Date(shown.expiresAt).getTime() <= now.getTime() ? { type: "expired" } : { type: "waiting" };
}
