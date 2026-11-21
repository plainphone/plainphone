// SPDX-License-Identifier: Apache-2.0
//
// The typed JS API of the Swift module (docs/ios/architecture.md, "The Swift Expo module"). Screens
// never import the native module directly: they get a `ScreenTime` from `nativeScreenTime()`,
// and tests pass a fake. Values come back from Swift as JSON strings (StatusReport.json).
import { Platform, requireOptionalNativeModule } from "expo";

/** Family Controls authorization, as `ios.authorizationStatus` spells it. A newer iOS may add values. */
export type Authorization = "notDetermined" | "denied" | "approved" | (string & {});

/** What `PUT /device/status` needs from the Swift side, after applying (Receipt.swift). */
export interface ScreenTimeStatus {
  lockIntact: boolean;
  maintenance: boolean;
  failedPolicies: string[];
  rulesEtag: string | null;
  rulesAppliedAt: string | null;
  rulesReceiptConfirmed: boolean;
  /** The phone released itself (`release: true`); it never locks again. */
  released: boolean;
  ios: { iosVersion: string; authorizationStatus: Authorization; effectiveStores: string[] };
}

export interface ScreenTime {
  authorizationStatus(): Promise<Authorization>;
  /** `child` needs a parent's Apple Account on this phone; `individual` is an adult's own iPhone. */
  requestAuthorization(kind: "child" | "individual"): Promise<Authorization>;
  /** Applies a rules document fetched with `etag`. An invalid one leaves the old rules in place. */
  applyRules(document: string, etag: string, phoneId: string | null, selection: string | null): Promise<ScreenTimeStatus>;
  setMaintenance(on: boolean, selection: string | null): Promise<ScreenTimeStatus>;
  /** A new pairing succeeded: forget the old receipt (a release), so the new rules apply. */
  beginNewPairing(): Promise<ScreenTimeStatus>;
  status(): Promise<ScreenTimeStatus>;
}

interface Native {
  authorizationStatus(): Promise<string>;
  requestAuthorization(kind: string): Promise<string>;
  applyRules(document: string, etag: string, phoneId: string | null, selection: string | null): Promise<string>;
  setMaintenance(on: boolean, selection: string | null): Promise<string>;
  beginNewPairing(): Promise<string>;
  status(): Promise<string>;
}

export class ScreenTimeUnavailable extends Error {
  constructor() {
    super("Screen Time is only available in the iPhone app");
  }
}

function wrap(native: Native): ScreenTime {
  const parse = async (json: Promise<string>) => JSON.parse(await json) as ScreenTimeStatus;
  return {
    authorizationStatus: () => native.authorizationStatus(),
    requestAuthorization: (kind) => native.requestAuthorization(kind),
    applyRules: (document, etag, phoneId, selection) => parse(native.applyRules(document, etag, phoneId, selection)),
    setMaintenance: (on, selection) => parse(native.setMaintenance(on, selection)),
    beginNewPairing: () => parse(native.beginNewPairing()),
    status: () => parse(native.status()),
  };
}

const unavailable: ScreenTime = {
  authorizationStatus: async () => { throw new ScreenTimeUnavailable(); },
  requestAuthorization: async () => { throw new ScreenTimeUnavailable(); },
  applyRules: async () => { throw new ScreenTimeUnavailable(); },
  setMaintenance: async () => { throw new ScreenTimeUnavailable(); },
  beginNewPairing: async () => { throw new ScreenTimeUnavailable(); },
  status: async () => { throw new ScreenTimeUnavailable(); },
};

let cached: ScreenTime | null = null;

/** The Swift module on an iPhone build; elsewhere (Android, web, Expo Go) every call throws. */
export function nativeScreenTime(): ScreenTime {
  if (cached) return cached;
  const native = Platform.OS === "ios" ? requireOptionalNativeModule<Native>("PlainphoneScreenTime") : null;
  cached = native ? wrap(native) : unavailable;
  return cached;
}

/** Whether this build has the Swift module (an iPhone build made after phase 1). */
export function hasScreenTime(): boolean {
  return nativeScreenTime() !== unavailable;
}
