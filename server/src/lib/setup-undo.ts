// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

export const undoMinutesInput = z.union([
  z.literal(0), z.literal(5), z.literal(10), z.literal(30), z.literal(60),
]);
export const MAX_SETUP_UNDO_MS = 60 * 60_000;
export const DEFAULT_SETUP_UNDO_MINUTES = 10;
