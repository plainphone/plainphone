// SPDX-License-Identifier: Apache-2.0
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Challenges issued before a service restart expire when it restarts.
const key = randomBytes(32);
const lifetimeMs = 120_000;

function signature(payload: string) {
  return createHmac("sha256", key).update(payload).digest();
}

export function issueApprovalChallenge(phoneId: string, changeId: string, now: Date) {
  const payload = [phoneId, changeId, now.getTime() + lifetimeMs].join(".");
  return payload + "." + signature(payload).toString("base64url");
}

export function matchesApprovalChallenge(token: string, phoneId: string, changeId: string, now: Date) {
  const [phone, change, expiry, mac, extra] = token.split(".");
  if (extra !== undefined || phone !== phoneId || change !== changeId || !/^\d{1,15}$/.test(expiry ?? "")) return false;
  if (Number(expiry) <= now.getTime() || Number(expiry) > now.getTime() + lifetimeMs) return false;
  if (!/^[\w-]{43}$/.test(mac ?? "")) return false;
  const actual = Buffer.from(mac!, "base64url");
  return actual.length === 32 && timingSafeEqual(actual, signature([phone, change, expiry].join(".")));
}
