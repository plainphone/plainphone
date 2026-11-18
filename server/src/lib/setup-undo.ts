// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

export const undoMinutesInput = z.union([
  z.literal(0), z.literal(5), z.literal(10), z.literal(30), z.literal(60),
]);
export const DEFAULT_SETUP_UNDO_MINUTES = 10;

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
