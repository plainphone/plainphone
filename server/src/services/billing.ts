// SPDX-License-Identifier: Apache-2.0
//
// The hosted plan of a household (docs/billing.md, #97) and the one place that answers
// "is this allowed". With BILLING_ENABLED off (the default) every answer is "yes" and every
// household reports the unlimited plan.

import { errorSummary } from "../lib/log.js";
import { and, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { billingSubscriptions, householdMembers, households, phones, selfKeys, users } from "../db/schema.js";
import type { Ctx } from "./context.js";
import type { DbLike } from "./changes.js";

/**
 * Things a plan may limit. Nothing else is ever gated by billing: see NEVER_GATED.
 * Existing phones are never touched: a lapsed plan only stops adding more.
 */
export type GatedAction = "phone.add" | "trusted.add";

/**
 * Parts of Plainphone a paywall must never touch (#97). Enumerated here so the test
 * `billing-exempt.test.ts` can call every one of them with billing on and the free plan exceeded.
 */
export const NEVER_GATED = [
  "rules sync and locking (GET /device/rules, PUT /device/status)",
  "release and removal of a phone",
  "SOS, safety rings and check-ins, 112 and emergency numbers",
  "emergency openings on Myself phones",
  "pending changes: cancel, approve, reject, the delay key itself",
  "phone settings and rules edits on existing phones",
  "moving a phone to another server, and receiving one",
  "household members (the parents' reachability and access)",
  "account and data deletion",
] as const;

export type PlanName = "unlimited" | "grandfathered" | "free" | "plus";

export interface Entitlements {
  /** True when billing is switched on for this server. */
  billing: boolean;
  plan: PlanName;
  source: "play" | "stripe" | "manual" | null;
  until: string | null;
  limits: { phones: number | null; trusted: number | null };
  usage: { phones: number; trusted: number };
  prioritySupport: boolean;
}

export function billingOn(ctx: Ctx): boolean {
  return ctx.cfg.BILLING_ENABLED && Boolean(ctx.cfg.BILLING_GRANDFATHER_BEFORE);
}

type Household = Pick<typeof households.$inferSelect, "id" | "plan" | "planSource" | "planUntil" | "createdAt">;

/** The plan as it applies right now, without counting anything. */
export function planOf(ctx: Ctx, h: Household): PlanName {
  if (!billingOn(ctx)) return "unlimited";
  if (h.createdAt < new Date(ctx.cfg.BILLING_GRANDFATHER_BEFORE!)) return "grandfathered";
  if (h.plan === "plus" && (h.planUntil === null || h.planUntil > ctx.now())) return "plus";
  return "free";
}

async function countPhones(db: DbLike, householdId: string) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(phones).where(eq(phones.householdId, householdId));
  return row?.n ?? 0;
}

/** Distinct trusted people (buddies) across the household's Myself phones, optionally without one phone. */
async function trustedPeople(db: DbLike, householdId: string, exceptPhoneId?: string) {
  const rows = await db
    .select({ userId: selfKeys.trustedUserId, email: selfKeys.trustedEmail })
    .from(selfKeys)
    .innerJoin(phones, eq(phones.id, selfKeys.phoneId))
    .where(and(
      eq(phones.householdId, householdId),
      eq(selfKeys.keyType, "trusted"),
      or(isNotNull(selfKeys.trustedUserId), isNotNull(selfKeys.trustedEmail)),
      exceptPhoneId ? ne(phones.id, exceptPhoneId) : undefined,
    ));
  return new Set(rows.map((r) => r.userId ?? `mail:${r.email}`));
}

export async function entitlements(ctx: Ctx, householdId: string, db: DbLike = ctx.db): Promise<Entitlements> {
  const [h] = await db.select().from(households).where(eq(households.id, householdId));
  if (!h) throw new Error("household not found");
  const plan = planOf(ctx, h);
  const limited = plan === "free";
  return {
    billing: billingOn(ctx),
    plan,
    source: plan === "plus" ? h.planSource : null,
    until: plan === "plus" ? (h.planUntil?.toISOString() ?? null) : null,
    limits: {
      phones: limited ? ctx.cfg.BILLING_FREE_PHONES : null,
      trusted: limited ? ctx.cfg.BILLING_FREE_TRUSTED : null,
    },
    usage: { phones: await countPhones(db, householdId), trusted: (await trustedPeople(db, householdId)).size },
    prioritySupport: plan === "plus",
  };
}

export type Allowed = { ok: true } | { ok: false; limit: "phones" | "trusted"; max: number };

/**
 * The one place that answers "is this allowed" for the plan. Always yes while billing is off,
 * for grandfathered and paid households, and for everything outside GatedAction.
 */
export async function isAllowed(
  ctx: Ctx,
  householdId: string,
  action: GatedAction,
  opts: { phoneId?: string; trusted?: { userId?: string | null; email?: string | null } } = {},
  db: DbLike = ctx.db,
): Promise<Allowed> {
  if (!billingOn(ctx)) return { ok: true };
  const [h] = await db.select().from(households).where(eq(households.id, householdId));
  if (!h || planOf(ctx, h) !== "free") return { ok: true };
  if (action === "phone.add") {
    const max = ctx.cfg.BILLING_FREE_PHONES;
    return (await countPhones(db, householdId)) < max ? { ok: true } : { ok: false, limit: "phones", max };
  }
  const max = ctx.cfg.BILLING_FREE_TRUSTED;
  const others = await trustedPeople(db, householdId, opts.phoneId);
  // Someone who already helps on another phone costs nothing extra, whether they were stored by
  // account (accepted) or by address (invited), so the address is matched to an account too.
  const email = opts.trusted?.email?.toLowerCase() ?? null;
  let userId = opts.trusted?.userId ?? null;
  if (!userId && email) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    userId = u?.id ?? null;
  }
  if ((userId && others.has(userId)) || (email && others.has(`mail:${email}`))) return { ok: true };
  return others.size < max ? { ok: true } : { ok: false, limit: "trusted", max };
}

export function planLimitBody(a: Extract<Allowed, { ok: false }>) {
  return { error: "plan_limit", limit: a.limit, max: a.max };
}

/** Provider states that keep the paid plan until `currentPeriodEnd`. */
const PAID_STATES = new Set(["active", "grace", "canceled"]);

/**
 * Records a provider's subscription state and recomputes the household's plan from all of its
 * subscriptions. A state older than the stored one is ignored (webhooks arrive out of order).
 * A manual grant is never changed by a provider.
 */
export async function recordSubscription(
  ctx: Ctx,
  db: DbLike,
  s: {
    householdId: string;
    provider: "stripe" | "play";
    subscriptionRef: string;
    customerRef?: string | null;
    productRef?: string | null;
    status: (typeof billingSubscriptions.$inferSelect)["status"];
    currentPeriodEnd: Date | null;
    stateAt: Date;
  },
): Promise<void> {
  const [existing] = await db.select().from(billingSubscriptions).where(and(
    eq(billingSubscriptions.provider, s.provider), eq(billingSubscriptions.subscriptionRef, s.subscriptionRef),
  )).for("update");
  if (existing && existing.stateAt > s.stateAt) return;
  if (existing) {
    await db.update(billingSubscriptions).set({
      status: s.status,
      currentPeriodEnd: s.currentPeriodEnd,
      stateAt: s.stateAt,
      customerRef: s.customerRef ?? existing.customerRef,
      productRef: s.productRef ?? existing.productRef,
    }).where(eq(billingSubscriptions.id, existing.id));
  } else {
    const [h] = await db.select({ id: households.id }).from(households).where(eq(households.id, s.householdId));
    if (!h) return;
    await db.insert(billingSubscriptions).values({
      householdId: s.householdId,
      provider: s.provider,
      subscriptionRef: s.subscriptionRef,
      customerRef: s.customerRef ?? null,
      productRef: s.productRef ?? null,
      status: s.status,
      currentPeriodEnd: s.currentPeriodEnd,
      stateAt: s.stateAt,
    });
  }
  await recomputePlan(ctx, db, existing?.householdId ?? s.householdId);
}

export async function recomputePlan(ctx: Ctx, db: DbLike, householdId: string) {
  const [h] = await db.select().from(households).where(eq(households.id, householdId)).for("update");
  if (!h || h.planSource === "manual") return;
  const subs = await db.select().from(billingSubscriptions).where(and(
    eq(billingSubscriptions.householdId, householdId),
    inArray(billingSubscriptions.status, [...PAID_STATES] as ("active" | "grace" | "canceled")[]),
  ));
  const now = ctx.now();
  const paying = subs
    .filter((x) => x.currentPeriodEnd === null ? x.status === "active" : x.currentPeriodEnd > now)
    .sort((a, b) => (b.currentPeriodEnd?.getTime() ?? Infinity) - (a.currentPeriodEnd?.getTime() ?? Infinity));
  const best = paying[0];
  await db.update(households).set(best
    ? { plan: "plus", planSource: best.provider, planUntil: best.currentPeriodEnd }
    : { plan: "free", planSource: null, planUntil: null }).where(eq(households.id, householdId));
}

/**
 * Paid subscriptions of the households that disappear with this user (the only member).
 * Read before the account is deleted, cancelled after, so a deleted household never pays on.
 */
export async function subscriptionsOfSoleHouseholds(ctx: Ctx, userId: string) {
  const mine = await ctx.db.select({ hid: householdMembers.householdId }).from(householdMembers).where(eq(householdMembers.userId, userId));
  const out: (typeof billingSubscriptions.$inferSelect)[] = [];
  for (const { hid } of mine) {
    const [n] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(householdMembers).where(eq(householdMembers.householdId, hid));
    if ((n?.n ?? 0) > 1) continue;
    out.push(...await ctx.db.select().from(billingSubscriptions).where(and(
      eq(billingSubscriptions.householdId, hid),
      inArray(billingSubscriptions.status, ["active", "grace", "on_hold", "paused", "pending"]),
    )));
  }
  return out;
}

export async function cancelSubscriptions(ctx: Ctx, subs: (typeof billingSubscriptions.$inferSelect)[]) {
  for (const s of subs) {
    try {
      if (s.provider === "stripe" && ctx.billing?.stripe) await ctx.billing.stripe.cancelSubscription(s.subscriptionRef);
      if (s.provider === "play" && ctx.billing?.play && s.productRef) await ctx.billing.play.cancelSubscription(s.productRef, s.subscriptionRef);
    } catch (err) {
      // Logged without ids: Mahope cancels by hand in the provider's dashboard (docs/billing.md).
      console.error(`billing: could not cancel a ${s.provider} subscription of a deleted household: ${errorSummary(err)}`);
    }
  }
}
