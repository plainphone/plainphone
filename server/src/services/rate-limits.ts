// SPDX-License-Identifier: Apache-2.0
//
// Rate limits kept in Postgres (docs/operations.md, "Bot and spam protection"), for the routes
// that send mail or create something for a visitor without an account. They survive restarts and
// hold across every process on the same database.
//
// No IP address is stored. A row's subject is an HMAC of the address with a key derived from a
// server secret and the UTC date, so the key changes every day: yesterday's rows cannot be
// matched with today's, and a row cannot be turned back into an address without the secret.
// Rows expire with their window and the sweeper deletes them.

import { createHmac } from "node:crypto";
import { isIPv6 } from "node:net";
import { lt, sql } from "drizzle-orm";
import { rateLimitHits } from "../db/schema.js";
import type { Ctx } from "./context.js";
import { serverSecret } from "./server-secrets.js";

/** The HMAC key for one UTC day. */
async function dayKey(ctx: Ctx, now: Date): Promise<Buffer> {
  const day = now.toISOString().slice(0, 10);
  return createHmac("sha256", await serverSecret(ctx, "rate-limit-hmac")).update(`day:${day}`).digest();
}

/**
 * The part of an address that identifies one client: an IPv4 address as it is, an IPv6 address
 * cut to its /64 (one home or phone gets a whole /64 and can pick any address in it).
 */
export function addressKey(ip: string): string {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4) return v4[1]!;
  if (!isIPv6(ip)) return ip;
  const [head = "", tail = ""] = ip.split("%")[0]!.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** A keyed hash that names `value` for today without storing it. */
export async function hashedSubject(ctx: Ctx, value: string, now = ctx.now()): Promise<string> {
  return createHmac("sha256", await dayKey(ctx, now)).update(value).digest("base64url");
}

/**
 * A fixed-window limit counted in the database. Like the in-memory RateLimiter, every attempt
 * counts, also the refused ones, so a client that keeps trying stays refused until the window ends.
 */
export class DbRateLimiter {
  constructor(
    /** Stable name of the limit, e.g. "auth-request-ip". */
    readonly bucket: string,
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  /** Counts one attempt for `subject` (an IP address or another key). False when over the limit. */
  async take(ctx: Ctx, subject: string): Promise<boolean> {
    const now = ctx.now();
    const windowStart = new Date(Math.floor(now.getTime() / this.windowMs) * this.windowMs);
    const [row] = await ctx.db
      .insert(rateLimitHits)
      .values({
        bucket: this.bucket,
        subject: await hashedSubject(ctx, subject, now),
        windowStart,
        hits: 1,
        expiresAt: new Date(windowStart.getTime() + this.windowMs),
      })
      .onConflictDoUpdate({
        target: [rateLimitHits.bucket, rateLimitHits.subject, rateLimitHits.windowStart],
        set: { hits: sql`${rateLimitHits.hits} + 1` },
      })
      .returning({ hits: rateLimitHits.hits });
    return row!.hits <= this.limit;
  }

  /** Counts one attempt from the client's address. */
  takeIp(ctx: Ctx, ip: string): Promise<boolean> {
    return this.take(ctx, `ip:${addressKey(ip)}`);
  }
}

/** Sweeper: rate-limit rows whose window has ended. */
export async function sweepRateLimits(ctx: Ctx): Promise<number> {
  const rows = await ctx.db.delete(rateLimitHits).where(lt(rateLimitHits.expiresAt, ctx.now()));
  return rows.count;
}
