// SPDX-License-Identifier: Apache-2.0
import { DrizzleQueryError } from "drizzle-orm/errors";

const EMAIL = /[^\s<>"'(),;:@]+@[^\s<>"'(),;:@]+\.[^\s<>"'(),;:@]+/g;

/**
 * Describes an error for the server log without personal data. A failed database query's
 * message holds the query's parameters (email addresses, phone numbers, positions), so only
 * its Postgres error code is kept. Other messages keep their text with email addresses
 * (SMTP servers echo the recipient) replaced.
 */
export function errorSummary(err: unknown): string {
  if (err instanceof DrizzleQueryError) {
    const code = (err.cause as { code?: unknown } | undefined)?.code;
    return typeof code === "string" ? `database error ${code}` : "database error";
  }
  if (!(err instanceof Error)) return "unknown error";
  return `${err.name}: ${err.message.replace(EMAIL, "[email]")}`;
}

/** The stack frames of an error, without its first line (the message, see errorSummary). */
export function errorFrames(err: unknown): string {
  if (!(err instanceof Error) || !err.stack) return "";
  return err.stack.split("\n").filter((line) => line.trimStart().startsWith("at ")).join("\n");
}
