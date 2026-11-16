// SPDX-License-Identifier: Apache-2.0
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

export function param(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value || !uuidParam.safeParse(value).success) throw new HTTPException(404, { message: "not found" });
  return value;
}

/** Small fixed-window limiter, per process. Enough for one server; swap for Redis if you scale out. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns false when the key is over the limit. */
  take(key: string, now = Date.now()): boolean {
    const hit = this.hits.get(key);
    if (!hit || hit.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 50_000) this.prune(now);
      return true;
    }
    hit.count++;
    return hit.count <= this.limit;
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}

export function clientIp(c: Context): string {
  // Behind one reverse proxy (Traefik in Dokploy) the last X-Forwarded-For entry is the
  // address the proxy saw; earlier entries are whatever the client claimed.
  const xff = c.req.header("x-forwarded-for")?.split(",");
  return xff?.[xff.length - 1]?.trim() || c.req.header("x-real-ip") || "unknown";
}
