// SPDX-License-Identifier: Apache-2.0
//
// iPhone pieces the server needs before the iOS app exists (docs/ios/architecture.md, phase 1):
// the "not yet" answer while iOS pairing is off, the size rules for Apple's opaque app
// selections, and the status fields an iPhone reports.

import { z } from "zod";

/** What `POST /device/pairings` answers an iPhone while IOS_PAIRING_ENABLED is off. */
export const IOS_PAIRING_NOT_YET = {
  error: "iPhone pairing is not available on this server yet",
  code: "ios_pairing_not_yet",
} as const;

/**
 * The largest selection the server stores, decoded. An encoded FamilyActivitySelection is a few
 * hundred bytes per picked app or category, so this leaves room for several hundred.
 */
export const MAX_IOS_SELECTION_BYTES = 128 * 1024;
/** Base64 of MAX_IOS_SELECTION_BYTES, with padding. */
export const MAX_IOS_SELECTION_CHARS = Math.ceil(MAX_IOS_SELECTION_BYTES / 3) * 4;

/** Standard base64 with padding, as Swift's `Data.base64EncodedString()` writes it. */
export const iosSelectionInput = z.object({
  selection: z
    .string()
    .min(4)
    .max(MAX_IOS_SELECTION_CHARS)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, "base64"),
});

export const IOS_AUTHORIZATION = ["notDetermined", "denied", "approved"] as const;
export const IOS_LOCATION_AUTH = ["notDetermined", "denied", "whenInUse", "always"] as const;
/** The ManagedSettings stores an iPhone can have in effect (docs/ios/architecture.md, Stores.swift). */
export const IOS_STORES = ["base", "school", "bedtime", "limits", "maintenance"] as const;

/**
 * A value Apple names. IOS_AUTHORIZATION and IOS_LOCATION_AUTH are the cases known today; a newer
 * iOS or app may send another, and the report is recorded rather than refused (the phone is the
 * authority for what happened). Only "approved" ever counts as an intact lock.
 */
const appleValue = z.string().min(1).max(40);

/** The `ios` part of `PUT /device/status`. Android phones leave it out. */
export const iosStatusInput = z.object({
  /** "26.1", but also whatever a beta writes ("26.2 beta 3"). */
  iosVersion: appleValue,
  /** Family Controls authorization (`AuthorizationCenter.shared.authorizationStatus`). */
  authorizationStatus: appleValue,
  /** Apple's Communication Limits through Declared Age Range; null when the phone cannot tell. */
  communicationLimits: z.boolean().nullable().optional(),
  /** The per-phone DNS settings (NEDNSSettingsManager) are enabled; null before phase 4. */
  dnsEnabled: z.boolean().nullable().optional(),
  locationAuth: appleValue.optional(),
  /** The named stores in effect right now (IOS_STORES today; a newer app may add some). */
  effectiveStores: z.array(z.string().min(1).max(40)).max(20).optional(),
});
export type IosStatus = z.infer<typeof iosStatusInput>;

/**
 * Whether an iPhone's lock is intact. It has no Device Owner or light-mode protections: the lock
 * holds while Family Controls is approved, nothing failed and no maintenance runs. The server only
 * ever makes the phone's own answer stricter. It never expects the school, bedtime or limits
 * stores: phase 1 iPhones do not enforce those rules and do not report them
 * (`IosEnforcement.enforcesSchedules` in the Swift core, docs/ios/architecture.md).
 */
export function iosLockIntact(input: {
  lockIntact: boolean;
  maintenance: boolean;
  failedPolicies: string[];
  ios?: IosStatus;
}): boolean {
  return input.lockIntact && input.ios?.authorizationStatus === "approved" && !input.maintenance &&
    input.failedPolicies.length === 0;
}
