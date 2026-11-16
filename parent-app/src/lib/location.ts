// SPDX-License-Identifier: Apache-2.0
//
// "Find now" asks the phone for a fresh position, then polls until it answers.
import type { LocationState } from "../api/models";

export const POLL_MS = 5000;
export const FIND_TIMEOUT_MS = 90_000;

/** A fix answers a request when it was recorded at or after the request. */
export function answers(loc: LocationState["location"], requestedAt: string): boolean {
  return Boolean(loc && new Date(loc.recordedAt).getTime() >= new Date(requestedAt).getTime());
}
