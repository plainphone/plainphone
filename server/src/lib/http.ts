// SPDX-License-Identifier: Apache-2.0
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

/** Parses and validates a JSON body; anything else is a 400. */
export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const type = c.req.header("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new HTTPException(415, { message: "send JSON with Content-Type: application/json" });
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "invalid JSON" });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error);
  return parsed.data;
}

export class ValidationError extends Error {
  constructor(readonly error: z.ZodError) {
    super("invalid input");
  }
}

export const uuidParam = z.uuid();

/**
 * A UUID from the path, lower-cased: Postgres treats "ABC…" and "abc…" as the same id, so anything
 * keyed on the string (advisory locks, rate limits) must see one form.
 */
export function param(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value || !uuidParam.safeParse(value).success) throw new HTTPException(404, { message: "not found" });
  return value.toLowerCase();
}

/** Small fixed-window limiter, per process. Enough for one server; swap for Redis if you scale out. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    /** Keys kept at most. A client that sends a new key per request must not fill the memory. */
    private readonly maxKeys = 50_000,
  ) {}

  /** Returns false when the key is over the limit. */
  take(key: string, now = Date.now()): boolean {
    const hit = this.hits.get(key);
    if (!hit || hit.resetAt <= now) {
      this.hits.delete(key);
      if (this.hits.size >= this.maxKeys) this.prune(now);
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    hit.count++;
    return hit.count <= this.limit;
  }

  get size(): number {
    return this.hits.size;
  }

  /**
   * Drops expired keys, then the oldest ones, down to 90 % so the scan is not repeated per request.
   * Trade-off: a client that can mint enough new keys also evicts its own key and so resets its
   * count. Bounded memory wins here; a limiter whose keys a client controls needs a per-IP limit too.
   */
  private prune(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    const target = Math.floor(this.maxKeys * 0.9);
    for (const k of this.hits.keys()) {
      if (this.hits.size <= target) break;
      this.hits.delete(k);
    }
  }
}

/** Rejects with `timeout` when `work` takes longer than `ms`; the work itself is not cancelled. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    // Behind one reverse proxy the last X-Forwarded-For entry is the address the proxy
    // saw; earlier entries are whatever the client claimed.
    const xff = c.req.header("x-forwarded-for")?.split(",");
    const ip = xff?.[xff.length - 1]?.trim();
    if (ip) return ip;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown"; // no socket, e.g. in tests
  }
}
