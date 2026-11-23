// SPDX-License-Identifier: Apache-2.0
//
// At most HOUSEHOLD_PHONE_CAP phones per household (docs/operations.md, "Phones per household").
// Every phone registers its own DNS filter ClientID, so while billing is off nothing else stops one
// account from registering hundreds. Only adding a phone is checked: a phone that is already there
// always syncs, and SOS, 112, release and moving a phone in are never affected.

import { count, eq, sql } from "drizzle-orm";
import { phones } from "../db/schema.js";
import type { Ctx } from "./context.js";
import type { DbLike } from "./changes.js";
import { countAbuse } from "./abuse-metrics.js";

export const PHONE_CAP_CODE = "household_phone_cap";

/**
 * Call inside the transaction that adds the phone. Returns the cap when the household already has
 * that many phones (the caller then adds nothing), or null when there is room. Two additions at
 * the same instant wait for each other, so they cannot both take the last place.
 */
export async function phoneCapReached(ctx: Ctx, tx: DbLike, householdId: string): Promise<number | null> {
  const cap = ctx.cfg.HOUSEHOLD_PHONE_CAP;
  if (cap <= 0) return null;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('plainphone.phone_cap'), hashtext(${householdId}))`);
  const [row] = await tx.select({ n: count() }).from(phones).where(eq(phones.householdId, householdId));
  if ((row?.n ?? 0) < cap) return null;
  countAbuse(ctx, "phone_cap");
  return cap;
}

export function phoneCapBody(max: number) {
  return { error: `this family has the most phones this server allows (${max})`, code: PHONE_CAP_CODE, max };
}
