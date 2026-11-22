// SPDX-License-Identifier: Apache-2.0
//
// A daily cap on new households (SIGNUP_DAILY_CAP, docs/operations.md). The hosted test service
// turns it on so a busy launch day cannot flood the mail server; self-hosters leave it off.
//
// Everything is counted from the database, so the cap survives restarts and holds across
// processes. A sign-up holds a place from the moment its login link is sent (the link is
// pending for 15 minutes), so the cap limits mails as well as households. People who already
// have an account, and people invited into an existing household, are never stopped.

import { and, count, countDistinct, eq, gt, gte, isNull, notExists, sql } from "drizzle-orm";
import { householdInvites, households, magicLinks, selfKeys, users } from "../db/schema.js";
import type { Ctx } from "./context.js";

type Db = Ctx["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const SIGNUP_CAP_CODE = "signup_cap_reached";

/** Thrown when a new household would go over today's cap. */
export class SignupCapError extends Error {
  constructor(readonly retryAt: Date) {
    super("the service takes a limited number of new households per day; try again tomorrow");
  }
}

/** Start of the UTC day `now` falls in. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The next UTC midnight: when the count starts over. */
export function nextUtcMidnight(now: Date): Date {
  return new Date(utcDayStart(now).getTime() + 86_400_000);
}

/** One lock for every process that counts towards the cap, held to the end of the transaction. */
async function lockCap(tx: Tx) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('plainphone.signup_cap'))`);
}

/** Has an account already: never capped. */
async function hasAccount(db: Db | Tx, email: string): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return Boolean(row);
}

/** Invited into an existing household, as a parent or a trusted person: never capped. */
async function isInvited(db: Db | Tx, email: string, now: Date): Promise<boolean> {
  const [invite] = await db
    .select({ id: householdInvites.id })
    .from(householdInvites)
    .where(and(eq(householdInvites.email, email), isNull(householdInvites.acceptedAt), gt(householdInvites.expiresAt, now)))
    .limit(1);
  if (invite) return true;
  const [trusted] = await db
    .select({ id: selfKeys.phoneId })
    .from(selfKeys)
    .where(and(eq(selfKeys.trustedEmail, email), isNull(selfKeys.trustedUserId)))
    .limit(1);
  return Boolean(trusted);
}

/** Households made since the start of today (UTC). */
async function householdsToday(db: Db | Tx, now: Date): Promise<number> {
  const [row] = await db.select({ n: count() }).from(households).where(gte(households.createdAt, utcDayStart(now)));
  return row?.n ?? 0;
}

/** Addresses without an account that hold a login link they have not used yet. */
async function pendingSignups(db: Db | Tx, now: Date, except: string): Promise<number> {
  const [row] = await db
    .select({ n: countDistinct(magicLinks.email) })
    .from(magicLinks)
    .where(
      and(
        isNull(magicLinks.usedAt),
        gt(magicLinks.expiresAt, now),
        sql`${magicLinks.email} <> ${except}`,
        notExists(db.select({ one: sql`1` }).from(users).where(eq(users.email, magicLinks.email))),
      ),
    );
  return row?.n ?? 0;
}

/** True when this address would start a new household that the cap does not allow. */
async function blocked(tx: Tx, cap: number, email: string, now: Date, reserve: boolean): Promise<boolean> {
  if (cap <= 0) return false;
  if (await hasAccount(tx, email)) return false;
  if (await isInvited(tx, email, now)) return false;
  await lockCap(tx);
  const taken = (await householdsToday(tx, now)) + (reserve ? await pendingSignups(tx, now, email) : 0);
  return taken >= cap;
}

/**
 * Runs `issue` (which stores the login link) only if the address may sign in today. The check
 * and the insert share one lock, so two processes cannot both take the last place.
 */
export async function withSignupPlace<T>(ctx: Ctx, email: string, issue: (db: Db | Tx) => Promise<T>): Promise<T> {
  const cap = ctx.cfg.SIGNUP_DAILY_CAP;
  // Off (the self-hosting default): no lock, no counting, the login path is as before.
  if (cap <= 0) return issue(ctx.db);
  return ctx.db.transaction(async (tx) => {
    const now = ctx.now();
    if (await blocked(tx, cap, email, now, true)) throw new SignupCapError(nextUtcMidnight(now));
    return issue(tx);
  });
}

/**
 * The hard check when a new household is about to be made (inside the login transaction).
 * Only households count here: the link being used already held its place.
 */
export async function assertHouseholdPlace(ctx: Ctx, tx: Tx, email: string, now: Date): Promise<void> {
  if (await blocked(tx, ctx.cfg.SIGNUP_DAILY_CAP, email, now, false)) throw new SignupCapError(nextUtcMidnight(now));
}

/** Login links sent to one address in the last hour (per-address mail limit). */
export async function recentLinks(ctx: Ctx, email: string): Promise<number> {
  const since = new Date(ctx.now().getTime() - 60 * 60_000);
  const [row] = await ctx.db
    .select({ n: count() })
    .from(magicLinks)
    .where(and(eq(magicLinks.email, email), gt(magicLinks.createdAt, since)));
  return row?.n ?? 0;
}
