// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

export const undoMinutesInput = z.union([
  z.literal(0), z.literal(5), z.literal(10), z.literal(30), z.literal(60),
]);
export const DEFAULT_SETUP_UNDO_MINUTES = 10;

export const MAX_SETUP_COMPLETION_AGE_MS = 7 * 24 * 60 * 60_000;
export const SETUP_UNDO_REPORT_GRACE_MS = 48 * 60 * 60_000;

export function setupUndoDeadline(phone: {
  mode: string;
  setupCompletedAt: Date | null;
  setupUndoMinutes: number | null;
}): number | null {
  if (phone.mode !== "light" || !phone.setupCompletedAt) return null;
  const duration = undoMinutesInput.safeParse(phone.setupUndoMinutes ?? DEFAULT_SETUP_UNDO_MINUTES);
  return duration.success ? phone.setupCompletedAt.getTime() + duration.data * 60_000 : null;
}

/**
 * Whether an undo report counts as late. With a known completion it is late once the window ended
 * more than the grace ago. When completion never reached the server (for example the phone rebooted
 * first) there is no window to measure, so it is late when the phone entry is older than the longest
 * age the server accepts for a completion.
 */
export function setupUndoReportedLate(
  phone: { mode: string; setupCompletedAt: Date | null; setupUndoMinutes: number | null; createdAt: Date },
  receivedAt: number,
): boolean {
  if (phone.setupCompletedAt === null) return receivedAt - phone.createdAt.getTime() > MAX_SETUP_COMPLETION_AGE_MS;
  const deadline = setupUndoDeadline(phone);
  return deadline === null || receivedAt > deadline + SETUP_UNDO_REPORT_GRACE_MS;
}
