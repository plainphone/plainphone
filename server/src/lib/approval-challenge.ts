// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from "node:crypto";
import { safeEqualHex, sha256 } from "./crypto.js";

const lifetimeMs = 120_000;

export function issueApprovalChallenge(phoneId: string, changeId: string, now: Date) {
  return [phoneId, changeId, now.getTime() + lifetimeMs, randomBytes(32).toString("base64url")].join(".");
}

export function approvalChallengeHash(token: string, helperId: string, revision: string) {
  return sha256(`${token}:${helperId}:${revision}`);
}

export function matchesApprovalChallenge(token: string, helperId: string, revision: string, hash: string | null, now: Date) {
  if (!hash || !safeEqualHex(approvalChallengeHash(token, helperId, revision), hash)) return false;
  const expiry = Number(token.split(".")[2]);
  return expiry > now.getTime() && expiry <= now.getTime() + lifetimeMs;
}
