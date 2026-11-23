// SPDX-License-Identifier: Apache-2.0
//
// How often the bot and spam protection stepped in, for the operator's /api/metrics page. Counters
// since start-up per process, by reason only: no address, household or user is recorded.

import type { Ctx } from "./context.js";

export const ABUSE_REASONS = [
  /** The hidden form field was filled in: answered like a success, nothing sent. */
  "honeypot",
  /** No solution, or a wrong, expired or reused one. */
  "bot_challenge",
  /** A new household with a throwaway mail address. */
  "disposable_email",
  /** A household at its daily invitation cap. */
  "invite_cap",
  /** A household at HOUSEHOLD_PHONE_CAP that tried to add another phone. */
  "phone_cap",
  /** A database-backed IP rate limit. */
  "rate_limit",
] as const;
export type AbuseReason = (typeof ABUSE_REASONS)[number];

const counters = new WeakMap<Ctx, Map<AbuseReason, number>>();

export function countAbuse(ctx: Ctx, reason: AbuseReason) {
  const counts = counters.get(ctx) ?? new Map<AbuseReason, number>();
  counters.set(ctx, counts);
  counts.set(reason, (counts.get(reason) ?? 0) + 1);
}

export function abuseCount(ctx: Ctx, reason: AbuseReason): number {
  return counters.get(ctx)?.get(reason) ?? 0;
}

/** Prometheus lines; every reason always shows, at 0 when nothing happened. */
export function abuseMetricsText(ctx: Ctx): string {
  return [
    "# HELP plainphone_abuse_blocked_total Requests the bot and spam protection stopped, by reason, since start-up.",
    "# TYPE plainphone_abuse_blocked_total counter",
    ...ABUSE_REASONS.map((r) => `plainphone_abuse_blocked_total{reason="${r}"} ${abuseCount(ctx, r)}`),
    "",
  ].join("\n");
}
