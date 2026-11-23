// SPDX-License-Identifier: Apache-2.0
//
// At most HOUSEHOLD_PHONE_CAP phones per household (docs/operations.md, "Phones per household").
// Every phone registers its own DNS filter ClientID, so while billing is off nothing else stops one
// account from registering hundreds. Only adding a phone is checked (pairing, setup and importing
// phones from another server): a phone that is already there always syncs, and SOS, 112 and
// release are never affected.

import { count, eq, sql } from "drizzle-orm";
import { phones } from "../db/schema.js";
import type { Ctx } from "./context.js";
import type { DbLike } from "./changes.js";
import { countAbuse } from "./abuse-metrics.js";

export const PHONE_CAP_CODE = "household_phone_cap";

/** A refusal at the cap; `phoneCap` is the cap, for the response body. */
export interface PhoneCapRefusal { phoneCap: number }

/**
 * Call inside the transaction that adds the phones. Returns a refusal when adding `adding` phones
 * would take the household over the cap (the caller then adds nothing), or null when there is
 * room. Two additions at the same instant wait for each other, so they cannot both take the last
 * place.
 */
export async function phoneCapReached(
  ctx: Ctx, tx: DbLike, householdId: string, adding = 1,
): Promise<PhoneCapRefusal | null> {
  const cap = ctx.cfg.HOUSEHOLD_PHONE_CAP;
  if (cap <= 0 || adding <= 0) return null;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('plainphone.phone_cap'), hashtext(${householdId}))`);
  const [row] = await tx.select({ n: count() }).from(phones).where(eq(phones.householdId, householdId));
  if ((row?.n ?? 0) + adding <= cap) return null;
  countAbuse(ctx, "phone_cap");
  return { phoneCap: cap };
}

export function phoneCapBody(max: number) {
  return { error: `this family has the most phones this server allows (${max})`, code: PHONE_CAP_CODE, max };
}

/** A refusal that has to leave a transaction as an error (importing phones from another server). */
export class PhoneCapError extends Error {
  constructor(readonly max: number) { super(phoneCapBody(max).error); }
}
