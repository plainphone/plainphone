// SPDX-License-Identifier: Apache-2.0
//
// A lock step the phone lifted on purpose for a short, parent-approved window (the account
// restriction during a Google sign-in). The phone reports it with a deadline and still says
// the lock is intact; the server only makes that stricter once the deadline has passed.

export interface LiftedPolicy {
  name: string;
  /** ISO datetime with offset: when the phone must have put the step back. */
  until: string;
}

/** Clock skew and a slow report are not an overdue window. */
export const LIFTED_GRACE_MS = 2 * 60_000;
/** A phone that has not reported this long after the deadline is told to the parents (sweeper). */
export const LIFTED_SILENT_MS = 10 * 60_000;
/** The `failedPolicies` cap of the status report. */
const MAX_FAILED = 50;

/** The lifted entries whose deadline passed more than the grace period ago. */
export function overdueLifted(lifted: readonly LiftedPolicy[] | undefined, now: Date): LiftedPolicy[] {
  return (lifted ?? []).filter((l) => Date.parse(l.until) < now.getTime() - LIFTED_GRACE_MS);
}

/**
 * Applies overdue lifted steps to a status report: the lock is no longer intact and the step
 * counts as failed, so the usual protection-lost alert fires. Entries within their deadline
 * change nothing. Never makes a report less strict.
 */
export function applyOverdueLifted(
  report: { lockIntact: boolean; failedPolicies: string[]; liftedPolicies?: LiftedPolicy[] },
  now: Date,
): { lockIntact: boolean; failedPolicies: string[] } {
  const overdue = overdueLifted(report.liftedPolicies, now);
  if (overdue.length === 0) return { lockIntact: report.lockIntact, failedPolicies: report.failedPolicies };
  const failed = [...report.failedPolicies];
  for (const { name } of overdue) if (!failed.includes(name) && failed.length < MAX_FAILED) failed.push(name);
  return { lockIntact: false, failedPolicies: failed };
}
