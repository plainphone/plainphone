// SPDX-License-Identifier: Apache-2.0
import type { JsonObject } from "./encoding.ts";

export function rulesRejection(header: JsonObject, role: string, acceptedVersion: number) {
  if (header.table !== "phone_state" || header.scope !== "R") return "wrong-scope";
  if (role !== "admin") return "wrong-role";
  if (typeof header.version !== "number" || !Number.isSafeInteger(header.version) ||
      header.version < 1 || header.version < acceptedVersion) return "old-version";
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

/** Scope grants and owner principal IDs must have been derived from an accepted roster. */
export function hasSelfScope(phoneId: string, ownerPrincipalId: string, principalId: string, selfPhoneIds: readonly string[]) {
  return principalId === ownerPrincipalId || selfPhoneIds.includes(phoneId);
}
