// SPDX-License-Identifier: Apache-2.0
import type { JsonObject } from "./encoding.ts";

type RulesRevision = { version: number; digest: string };

export function rulesRejection(header: JsonObject, role: string, receivedDigest: string, accepted: RulesRevision | null) {
  if (header.table !== "phone_state" || header.scope !== "R") return "wrong-scope";
  if (header.v !== 1) return "wrong-wire-version";
  if (typeof header.phoneId !== "string" || header.recordId !== header.phoneId) return "wrong-record-id";
  if (role !== "admin") return "wrong-role";
  if (typeof header.version !== "number" || !Number.isSafeInteger(header.version) ||
      header.version < 1 || (accepted && header.version < accepted.version)) return "old-version";
  if (accepted && header.version === accepted.version && receivedDigest !== accepted.digest) return "revision-conflict";
  return null;
}

export type SelfBase = { version: number; digest: string; epoch: number };

export function selfBaseRejection(changeId: string, expected: SelfBase, accepted: SelfBase, consumed: ReadonlySet<string>) {
  if (consumed.has(changeId)) return "replay";
  if (expected.epoch !== accepted.epoch) return "wrong-epoch";
  if (expected.version !== accepted.version) return "wrong-base-version";
  if (expected.digest !== accepted.digest) return "wrong-base-digest";
  return null;
}

/** Use the device grants from the accepted roster, including the grant at Self phone creation. */
export function hasSelfScope(phoneId: string, selfPhoneIds: readonly string[]) {
  return selfPhoneIds.includes(phoneId);
}
