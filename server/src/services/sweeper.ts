// SPDX-License-Identifier: Apache-2.0
import { lt, or } from "drizzle-orm";
import { magicLinks, pairings, sessions } from "../db/schema.js";
import { applyDueChanges } from "./changes.js";
import type { Ctx } from "./context.js";
import { syncDirtyDns } from "./dns.js";

/** One pass of background work: due delay-key changes, DNS retries, expired rows. */
export async function sweep(ctx: Ctx) {
  const now = ctx.now();
  const applied = await applyDueChanges(ctx);
  const dns = await syncDirtyDns(ctx);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  await ctx.db.delete(magicLinks).where(lt(magicLinks.expiresAt, dayAgo));
  await ctx.db.delete(sessions).where(lt(sessions.expiresAt, now));
  // Pairings hold an undelivered device token in clear text; never keep them long.
  await ctx.db.delete(pairings).where(or(lt(pairings.expiresAt, dayAgo), lt(pairings.createdAt, dayAgo)));
  return { applied, dns };
}

export function startSweeper(ctx: Ctx, everyMs = 60_000): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await sweep(ctx);
    } catch (err) {
      console.error("sweeper failed", err);
    } finally {
      running = false;
    }
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
