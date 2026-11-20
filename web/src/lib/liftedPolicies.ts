// SPDX-License-Identifier: Apache-2.0

/** The server treats a lifted step as failed once it is this far past its deadline. */
export const LIFTED_GRACE_MS = 2 * 60_000;

/**
 * The calm "allowed until" line while an approved window is open, or a warning when the deadline has
 * passed and the phone has not reported the step as failed (it went silent, so the server cannot know).
 * Within the grace after the deadline the phone is about to report, so nothing is shown.
 */
export function liftedNotice(
  status: { failedPolicies: readonly string[]; liftedPolicies?: readonly { name: string; until: string }[] } | null | undefined,
  now: number,
): { until: string; overdue: boolean } | null {
  const entries = status?.liftedPolicies ?? [];
  const open = entries.find((l) => Date.parse(l.until) > now);
  if (open) return { until: open.until, overdue: false };
  const overdue = entries.find((l) => Date.parse(l.until) + LIFTED_GRACE_MS < now && !status!.failedPolicies.includes(l.name));
  return overdue ? { until: overdue.until, overdue: true } : null;
}
