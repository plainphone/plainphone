// SPDX-License-Identifier: Apache-2.0
//
// At most INVITES_PER_HOUSEHOLD_DAILY invitation mails per household in any 24 hours
// (docs/operations.md, "Bot and spam protection"). Counted in the database, so the cap holds
// across restarts and processes. Covers every mail that invites someone into a household: a
// second parent, and a trusted person chosen in the dashboard, the app or on the phone at setup.

import { and, count, eq, gt, lt, sql } from "drizzle-orm";
import { inviteMails } from "../db/schema.js";
import type { Ctx } from "./context.js";
import { countAbuse } from "./abuse-metrics.js";

export const INVITE_CAP_CODE = "invite_cap_reached";
const DAY = 86_400_000;

/**
 * Takes one invitation mail from the household's allowance. False (and nothing recorded) when the
 * household has already sent the cap's worth in the last 24 hours; the caller then sends nothing.
 */
export async function takeInviteMail(ctx: Ctx, householdId: string): Promise<boolean> {
  const cap = ctx.cfg.INVITES_PER_HOUSEHOLD_DAILY;
  if (cap <= 0) return true;
  const ok = await ctx.db.transaction(async (tx) => {
    // Two invitations at once from the same household must not both take the last place. The key is
    // the lower-cased id, because Postgres sees both letter cases as one household.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('plainphone.invite_cap'), hashtext(${householdId.toLowerCase()}))`);
    const now = ctx.now();
    const [row] = await tx
      .select({ n: count() })
      .from(inviteMails)
      .where(and(eq(inviteMails.householdId, householdId), gt(inviteMails.createdAt, new Date(now.getTime() - DAY))));
    if ((row?.n ?? 0) >= cap) return false;
    await tx.insert(inviteMails).values({ householdId, createdAt: now });
    return true;
  });
  if (!ok) countAbuse(ctx, "invite_cap");
  return ok;
}

/** Sweeper: rows older than the window count for nothing. */
export async function sweepInviteMails(ctx: Ctx): Promise<number> {
  const rows = await ctx.db.delete(inviteMails).where(lt(inviteMails.createdAt, new Date(ctx.now().getTime() - DAY)));
  return rows.count;
}
