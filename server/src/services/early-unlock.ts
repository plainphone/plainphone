// SPDX-License-Identifier: Apache-2.0
//
// Paid early unlock on Myself phones (docs/billing.md, #103). It only ever shortens the user's
// own wait-time key: about ten minutes after payment the pending change applies. Never on child
// phones, never for a buddy or trusted-person key, at most once per rolling seven days, and no
// charity share. Withdrawal before delivery restores the wait and refunds in full; a failed,
// duplicated or undeliverable unlock is refunded too.

import { errorSummary } from "../lib/log.js";
import { and, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { earlyUnlocks, households, pendingChanges, phones, selfKeys, users } from "../db/schema.js";
import { earlyUnlockReceiptMail, withdrawalReceiptMail } from "../lib/billing-mail.js";
import { toLocale } from "../lib/locale.js";
import { billingOn } from "./billing.js";
import type { DbLike, Op } from "./changes.js";
import type { Ctx } from "./context.js";
import { wakePhone } from "./phones.js";

const MINUTE = 60_000;
const DAY = 86_400_000;
/** The change applies about this long after payment. */
export const UNLOCK_AFTER_MS = 10 * MINUTE;
/** At most one paid unlock per phone within this window. */
export const CAP_MS = 7 * DAY;
/** Only offer it when it saves at least this much time compared with paying nothing. */
const MIN_SAVING_MS = 15 * MINUTE;
/** An unpaid checkout is given up after this long (Stripe's session expires at 30 minutes). */
const CHECKOUT_MS = 60 * MINUTE;

type Phone = typeof phones.$inferSelect;
type Key = typeof selfKeys.$inferSelect;
type Change = typeof pendingChanges.$inferSelect;
type Row = typeof earlyUnlocks.$inferSelect;
export type Channel = Row["channel"];

export type OfferReason = "savesNoTime" | "weeklyCap" | "inProgress";

export interface Offer {
  available: boolean;
  reason: OfferReason | null;
  price: number;
  currency: string;
  unlockMinutes: number;
  /** With the weekly cap reached: when the next unlock can be bought. */
  nextAvailableAt: string | null;
  /** A paid or started unlock for this change, with its withdrawal state. */
  purchase: ReturnType<typeof purchaseJson> | null;
}

/**
 * Whether this change can have an early unlock at all, before counting time and purchases.
 * Only the Myself profile, only the user's own delay key, and never a change to the key itself.
 */
export function eligible(ctx: Ctx, phone: Phone, key: Key | undefined, change: Change): boolean {
  return (
    billingOn(ctx) &&
    phone.profile === "self" &&
    key?.keyType === "delay" &&
    key.payUnlockEnabled &&
    change.keyType === "delay" &&
    (change.op as Op).type !== "key.set"
  );
}

const PAID: Row["status"][] = ["scheduled", "delivered"];

async function lastPaid(db: DbLike, phoneId: string, since: Date, except?: string) {
  const rows = await db.select().from(earlyUnlocks).where(and(
    eq(earlyUnlocks.phoneId, phoneId),
    inArray(earlyUnlocks.status, PAID),
    gt(earlyUnlocks.paidAt, since),
    except ? ne(earlyUnlocks.id, except) : undefined,
  ));
  return rows.sort((a, b) => b.paidAt!.getTime() - a.paidAt!.getTime())[0];
}

export function purchaseJson(r: Row) {
  return {
    id: r.id,
    status: r.status,
    channel: r.channel,
    amount: r.amount,
    currency: r.currency,
    consentAt: r.consentAt.toISOString(),
    paidAt: r.paidAt?.toISOString() ?? null,
    unlockAt: r.unlockAt?.toISOString() ?? null,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
    refundedAt: r.refundedAt?.toISOString() ?? null,
    /** The withdrawal control stays visible while this is true (forbrugeraftaleloven § 20 a). */
    canWithdraw: r.status === "scheduled" || r.status === "created",
  };
}

/** The offer shown next to a pending change, or null when there is nothing to show at all. */
export async function offerFor(ctx: Ctx, phone: Phone, key: Key | undefined, change: Change, db: DbLike = ctx.db): Promise<Offer | null> {
  if (!eligible(ctx, phone, key, change)) return null;
  const now = ctx.now();
  const [current] = await db.select().from(earlyUnlocks)
    .where(and(eq(earlyUnlocks.pendingChangeId, change.id), inArray(earlyUnlocks.status, ["created", "scheduled", "refund_due"])));
  const base = { price: ctx.cfg.BILLING_EARLY_UNLOCK_PRICE_MINOR, currency: ctx.cfg.BILLING_CURRENCY, unlockMinutes: UNLOCK_AFTER_MS / MINUTE };
  if (current && current.status !== "created") {
    return { ...base, available: false, reason: "inProgress", nextAvailableAt: null, purchase: purchaseJson(current) };
  }
  const paid = await lastPaid(db, phone.id, new Date(now.getTime() - CAP_MS));
  if (paid) {
    return {
      ...base, available: false, reason: "weeklyCap",
      nextAvailableAt: new Date(paid.paidAt!.getTime() + CAP_MS).toISOString(), purchase: current ? purchaseJson(current) : null,
    };
  }
  if (!change.effectiveAt || change.effectiveAt.getTime() - now.getTime() < UNLOCK_AFTER_MS + MIN_SAVING_MS) {
    return { ...base, available: false, reason: "savesNoTime", nextAvailableAt: null, purchase: null };
  }
  return { ...base, available: true, reason: null, nextAvailableAt: null, purchase: current ? purchaseJson(current) : null };
}

export class EarlyUnlockError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 503, message: string) { super(message); }
}

/**
 * Starts a purchase: records the consent and the original wait, then (Stripe) opens a checkout.
 * Returns the same row and checkout for a retry, so a double click never makes two payments.
 */
export async function startEarlyUnlock(
  ctx: Ctx,
  input: { changeId: string; phone: Phone; buyerId: string | null; channel: Channel; locale?: string },
): Promise<{ purchase: ReturnType<typeof purchaseJson>; checkoutUrl: string | null; productId: string | null; accountId: string }> {
  if (input.channel === "stripe" && !ctx.billing?.stripe) throw new EarlyUnlockError(503, "card payments are not set up on this server");
  if (input.channel === "play" && !ctx.billing?.play) throw new EarlyUnlockError(503, "Google Play payments are not set up on this server");
  const row = await ctx.db.transaction(async (tx) => {
    const [phone] = await tx.select().from(phones).where(eq(phones.id, input.phone.id)).for("update");
    const [change] = await tx.select().from(pendingChanges)
      .where(and(eq(pendingChanges.id, input.changeId), eq(pendingChanges.phoneId, input.phone.id), eq(pendingChanges.status, "pending")));
    if (!phone || !change) throw new EarlyUnlockError(404, "not found");
    const [key] = await tx.select().from(selfKeys).where(eq(selfKeys.phoneId, phone.id));
    const offer = await offerFor(ctx, phone, key, change, tx);
    if (!offer) throw new EarlyUnlockError(409, "early unlock is not available for this change");
    const [open] = await tx.select().from(earlyUnlocks).where(and(
      eq(earlyUnlocks.pendingChangeId, change.id), eq(earlyUnlocks.status, "created"), eq(earlyUnlocks.channel, input.channel),
    ));
    if (open && open.createdAt.getTime() > ctx.now().getTime() - CHECKOUT_MS / 2) return open;
    if (!offer.available) throw new EarlyUnlockError(409, offer.reason ?? "not available");
    if (open) await tx.update(earlyUnlocks).set({ status: "expired" }).where(eq(earlyUnlocks.id, open.id));
    const [created] = await tx.insert(earlyUnlocks).values({
      phoneId: phone.id,
      householdId: phone.householdId,
      pendingChangeId: change.id,
      buyerId: input.buyerId,
      channel: input.channel,
      amount: offer.price,
      currency: offer.currency,
      consentAt: ctx.now(),
      originalEffectiveAt: change.effectiveAt,
      createdAt: ctx.now(),
    }).returning();
    return created!;
  });
  let checkoutUrl: string | null = null;
  if (input.channel === "stripe") {
    const base = ctx.cfg.PUBLIC_URL.replace(/\/+$/, "");
    const back = `${base}/phones/${input.phone.id}/key?earlyUnlock=${row.id}`;
    // The idempotency key is the row id: a retry gets the very same checkout session back.
    const session = await ctx.billing!.stripe!.createCheckoutSession({
      mode: "payment",
      client_reference_id: row.id,
      line_items: [{
        quantity: 1,
        price_data: { currency: row.currency.toLowerCase(), unit_amount: row.amount, product_data: { name: "Plainphone early unlock" } },
      }],
      metadata: { kind: "early_unlock", early_unlock_id: row.id },
      payment_intent_data: { metadata: { kind: "early_unlock", early_unlock_id: row.id } },
      expires_at: Math.floor((row.createdAt.getTime() + 31 * MINUTE) / 1000),
      success_url: back,
      cancel_url: back,
      ...(input.locale ? { locale: stripeLocale(input.locale) } : {}),
    }, `early-unlock-${row.id}`);
    checkoutUrl = session.url;
    await ctx.db.update(earlyUnlocks).set({ providerRef: session.id }).where(eq(earlyUnlocks.id, row.id));
  }
  const [fresh] = await ctx.db.select().from(earlyUnlocks).where(eq(earlyUnlocks.id, row.id));
  return {
    purchase: purchaseJson(fresh!),
    checkoutUrl,
    productId: input.channel === "play" ? ctx.cfg.PLAY_PRODUCT_EARLY_UNLOCK : null,
    accountId: input.phone.householdId,
  };
}

function stripeLocale(l: string) {
  return ({ da: "da", sv: "sv", nb: "nb", de: "de" } as Record<string, string>)[l] ?? "en";
}

export type PaidOutcome = "scheduled" | "refund" | "noop";

/**
 * The provider confirmed payment. Idempotent: a second confirmation for the same payment changes
 * nothing. Returns what to do next outside the transaction, and the row to do it for: a second,
 * different payment for a row that was already paid gets its own refund record, so the first
 * payment's record stays intact.
 */
export async function confirmPaid(
  ctx: Ctx,
  db: DbLike,
  id: string,
  pay: { paymentRef: string; providerRef?: string | null },
): Promise<{ outcome: PaidOutcome; id: string }> {
  const [row] = await db.select().from(earlyUnlocks).where(eq(earlyUnlocks.id, id)).for("update");
  if (!row) return { outcome: "noop", id };
  if (row.paymentRef && row.paymentRef === pay.paymentRef && row.status !== "created" && row.status !== "expired") return { outcome: "noop", id };
  const now = ctx.now();
  if (row.paymentRef && row.paymentRef !== pay.paymentRef) {
    // Another payment for a row that already holds one (two purchase flows for the same offer).
    const [seen] = await db.select({ id: earlyUnlocks.id }).from(earlyUnlocks)
      .where(and(eq(earlyUnlocks.channel, row.channel), eq(earlyUnlocks.paymentRef, pay.paymentRef)));
    if (seen) return { outcome: "noop", id: seen.id };
    const [extra] = await db.insert(earlyUnlocks).values({
      phoneId: row.phoneId,
      householdId: row.householdId,
      // Not tied to the change, so the offer keeps showing the purchase that was actually kept.
      pendingChangeId: null,
      buyerId: row.buyerId,
      channel: row.channel,
      amount: row.amount,
      currency: row.currency,
      status: "refund_due",
      providerRef: pay.providerRef && pay.providerRef !== row.providerRef ? pay.providerRef : null,
      paymentRef: pay.paymentRef,
      consentAt: row.consentAt,
      originalEffectiveAt: row.originalEffectiveAt,
      paidAt: now,
      refundReason: "duplicate",
      createdAt: now,
    }).returning();
    return { outcome: "refund", id: extra!.id };
  }
  const refund = async (reason: string) => {
    await db.update(earlyUnlocks).set({
      status: "refund_due", paidAt: row.paidAt ?? now, paymentRef: pay.paymentRef,
      providerRef: pay.providerRef ?? row.providerRef, refundReason: reason,
    }).where(eq(earlyUnlocks.id, row.id));
    return { outcome: "refund" as const, id: row.id };
  };
  // Paid after it was withdrawn or given up: never keep the money.
  if (row.status !== "created") return refund(row.withdrawnAt ? "withdrawn" : "late");
  const [change] = row.pendingChangeId
    ? await db.select().from(pendingChanges).where(and(eq(pendingChanges.id, row.pendingChangeId), eq(pendingChanges.status, "pending"))).for("update")
    : [];
  if (!change || !row.phoneId || !change.effectiveAt || change.keyType !== "delay") return refund("undeliverable");
  if (await lastPaid(db, row.phoneId, new Date(now.getTime() - CAP_MS), row.id)) return refund("duplicate");
  const unlockAt = new Date(now.getTime() + UNLOCK_AFTER_MS);
  if (change.effectiveAt <= unlockAt) return refund("savesNoTime");
  await db.update(pendingChanges).set({ effectiveAt: unlockAt }).where(eq(pendingChanges.id, change.id));
  await db.update(earlyUnlocks).set({
    status: "scheduled", paidAt: now, unlockAt, paymentRef: pay.paymentRef, providerRef: pay.providerRef ?? row.providerRef,
  }).where(eq(earlyUnlocks.id, row.id));
  return { outcome: "scheduled", id: row.id };
}

/** After confirmPaid committed: wake the phone, send the receipt, or refund at once. */
export async function afterPaid(ctx: Ctx, id: string, outcome: PaidOutcome) {
  const [row] = await ctx.db.select().from(earlyUnlocks).where(eq(earlyUnlocks.id, id));
  if (!row) return;
  if (outcome === "scheduled") {
    if (row.phoneId) await wakePhone(ctx, row.phoneId, "rules");
    await sendReceipt(ctx, row, "purchase");
  }
  if (outcome === "refund") await refundNow(ctx, row);
}

/** Withdrawal (Fortryd aftale): restores the wait and refunds in full, before delivery only. */
export async function withdraw(ctx: Ctx, id: string, userId: string, name?: string): Promise<Row> {
  const now = ctx.now();
  const row = await ctx.db.transaction(async (tx) => {
    const [r] = await tx.select().from(earlyUnlocks).where(eq(earlyUnlocks.id, id)).for("update");
    if (!r) throw new EarlyUnlockError(404, "not found");
    if (r.status === "created") {
      const [done] = await tx.update(earlyUnlocks).set({ status: "expired", withdrawnAt: now }).where(eq(earlyUnlocks.id, r.id)).returning();
      return done!;
    }
    if (r.status !== "scheduled") return r;
    const [change] = r.pendingChangeId
      ? await tx.select().from(pendingChanges).where(eq(pendingChanges.id, r.pendingChangeId)).for("update")
      : [];
    if (change?.status === "applied") {
      // The phone already applied it (GET /device/rules) before the sweeper noticed: delivered.
      const [done] = await tx.update(earlyUnlocks).set({ status: "delivered", deliveredAt: change.decidedAt ?? now })
        .where(eq(earlyUnlocks.id, r.id)).returning();
      return done!;
    }
    if (r.pendingChangeId && r.originalEffectiveAt) {
      await tx.update(pendingChanges).set({ effectiveAt: r.originalEffectiveAt })
        .where(and(eq(pendingChanges.id, r.pendingChangeId), eq(pendingChanges.status, "pending")));
    }
    const [done] = await tx.update(earlyUnlocks).set({ status: "refund_due", withdrawnAt: now, refundReason: "withdrawn" })
      .where(eq(earlyUnlocks.id, r.id)).returning();
    return done!;
  });
  if (row.status === "delivered") throw new EarlyUnlockError(409, "the unlock was delivered, so the right of withdrawal has ended");
  if (row.phoneId) await wakePhone(ctx, row.phoneId, "rules");
  // A receipt only for a contract that was paid; an abandoned checkout just closes.
  if (row.paidAt && row.withdrawnAt?.getTime() === now.getTime()) await sendReceipt(ctx, row, "withdrawal", { userId, name });
  if (row.status === "refund_due") await refundNow(ctx, row);
  const [fresh] = await ctx.db.select().from(earlyUnlocks).where(eq(earlyUnlocks.id, id));
  return fresh!;
}

/** Calls the provider's refund. A failure leaves the row as refund_due for the sweeper. */
export async function refundNow(ctx: Ctx, row: Row): Promise<boolean> {
  if (row.status !== "refund_due" || !row.paymentRef) return false;
  try {
    if (row.channel === "stripe") {
      if (!ctx.billing?.stripe) return false;
      await ctx.billing.stripe.createRefund(row.paymentRef, `refund-${row.id}`);
    } else {
      if (!ctx.billing?.play || !row.providerRef) return false;
      await ctx.billing.play.refundOrder(row.providerRef);
    }
  } catch (err) {
    console.error(`early unlock refund failed, will retry: ${errorSummary(err)}`);
    return false;
  }
  await ctx.db.update(earlyUnlocks).set({ status: "refunded", refundedAt: ctx.now() })
    .where(and(eq(earlyUnlocks.id, row.id), eq(earlyUnlocks.status, "refund_due")));
  return true;
}

/** The provider refunded or voided it on its own (chargeback, store refund). */
export async function markRefundedByProvider(ctx: Ctx, db: DbLike, channel: Channel, paymentRef: string) {
  await db.update(earlyUnlocks)
    .set({ status: "refunded", refundedAt: ctx.now(), refundReason: sql`coalesce(${earlyUnlocks.refundReason}, 'provider')` })
    .where(and(eq(earlyUnlocks.channel, channel), eq(earlyUnlocks.paymentRef, paymentRef), ne(earlyUnlocks.status, "refunded")));
}

/** Sweeper: mark delivered unlocks, refund undeliverable ones, retry refunds, expire old checkouts. */
export async function sweepEarlyUnlocks(ctx: Ctx) {
  const now = ctx.now();
  await ctx.db.update(earlyUnlocks).set({ status: "expired" })
    .where(and(eq(earlyUnlocks.status, "created"), lt(earlyUnlocks.createdAt, new Date(now.getTime() - CHECKOUT_MS))));
  const scheduled = await ctx.db.select({ row: earlyUnlocks, change: pendingChanges }).from(earlyUnlocks)
    .leftJoin(pendingChanges, eq(pendingChanges.id, earlyUnlocks.pendingChangeId))
    .where(eq(earlyUnlocks.status, "scheduled"));
  for (const { row, change } of scheduled) {
    if (change?.status === "pending") continue;
    if (change?.status === "applied") {
      await ctx.db.update(earlyUnlocks).set({ status: "delivered", deliveredAt: change.decidedAt ?? now })
        .where(and(eq(earlyUnlocks.id, row.id), eq(earlyUnlocks.status, "scheduled")));
    } else {
      // Cancelled, failed, or gone: it can no longer be delivered, so the money goes back.
      await ctx.db.update(earlyUnlocks).set({ status: "refund_due", refundReason: "undeliverable" })
        .where(and(eq(earlyUnlocks.id, row.id), eq(earlyUnlocks.status, "scheduled")));
    }
  }
  const due = await ctx.db.select().from(earlyUnlocks).where(eq(earlyUnlocks.status, "refund_due"));
  for (const row of due) await refundNow(ctx, row);
}

async function sendReceipt(ctx: Ctx, row: Row, kind: "purchase" | "withdrawal", extra: { userId?: string; name?: string } = {}) {
  if (!ctx.mail.canSend) return;
  const who = extra.userId ?? row.buyerId;
  if (!who) return;
  try {
    const [user] = await ctx.db.select({ email: users.email, locale: users.locale }).from(users).where(eq(users.id, who));
    if (!user) return;
    const [h] = row.householdId ? await ctx.db.select({ tz: households.timeZone }).from(households).where(eq(households.id, row.householdId)) : [];
    const locale = toLocale(user.locale);
    const mail = kind === "purchase"
      ? earlyUnlockReceiptMail(user.email, locale, ctx.cfg.PUBLIC_URL, row, h?.tz ?? "Europe/Copenhagen")
      : withdrawalReceiptMail(user.email, locale, ctx.cfg.PUBLIC_URL, row, h?.tz ?? "Europe/Copenhagen", extra.name);
    await ctx.mail.send(mail);
  } catch (err) {
    console.error(`could not send the early unlock receipt: ${errorSummary(err)}`);
  }
}
