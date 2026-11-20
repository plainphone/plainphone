// SPDX-License-Identifier: Apache-2.0
//
// Billing routes (docs/billing.md): the provider webhooks (public, signed), the parent's plan
// page and early unlock, and the Play purchase report from a phone. Every route answers 404
// while BILLING_ENABLED is off, so a server without billing looks exactly like before.
// Subscription state comes from the provider only, never from the client.

import { timingSafeEqual } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  billingEvents, billingSubscriptions, earlyUnlocks, householdMembers, pendingChanges, phones, selfKeys,
} from "../db/schema.js";
import { body, param, RateLimiter } from "../lib/http.js";
import { playStatus } from "../providers/play-billing.js";
import { verifyStripeSignature } from "../providers/stripe.js";
import { billingOn, entitlements, recordSubscription } from "../services/billing.js";
import type { DbLike } from "../services/changes.js";
import type { Ctx } from "../services/context.js";
import {
  afterPaid, confirmPaid, EarlyUnlockError, markRefundedByProvider, offerFor, purchaseJson, startEarlyUnlock, withdraw,
} from "../services/early-unlock.js";

type Phone = typeof phones.$inferSelect;
type After = (() => Promise<void>)[];

function requireBilling(ctx: Ctx) {
  if (!billingOn(ctx)) throw new HTTPException(404, { message: "not found" });
}

function rethrow(err: unknown): never {
  if (err instanceof EarlyUnlockError) throw new HTTPException(err.status, { message: err.message });
  throw err;
}

/** Records an event id; false when it was handled before (providers retry webhooks). */
async function firstTime(db: DbLike, provider: "stripe" | "play", eventId: string, type: string, now: Date) {
  const rows = await db.insert(billingEvents).values({ provider, eventId, type, receivedAt: now })
    .onConflictDoNothing().returning({ id: billingEvents.eventId });
  return rows.length > 0;
}

// --- Stripe --------------------------------------------------------------------

const stripeEvent = z.object({
  id: z.string().min(1).max(255),
  type: z.string().max(100),
  created: z.number().int(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

const meta = (o: Record<string, unknown>) => (o.metadata && typeof o.metadata === "object" ? o.metadata as Record<string, string> : {});
const str = (v: unknown) => (typeof v === "string" ? v : null);

function stripeStatus(o: Record<string, unknown>): (typeof billingSubscriptions.$inferSelect)["status"] {
  switch (o.status) {
    case "active":
    case "trialing":
      return o.cancel_at_period_end === true ? "canceled" : "active";
    case "past_due": return "grace";
    case "paused": return "paused";
    case "incomplete": return "pending";
    default: return "expired";
  }
}

function stripePeriodEnd(o: Record<string, unknown>): Date | null {
  const direct = typeof o.current_period_end === "number" ? o.current_period_end : null;
  const items = (o.items as { data?: { current_period_end?: number }[] } | undefined)?.data ?? [];
  const fromItems = items.map((i) => i.current_period_end).filter((n): n is number => typeof n === "number");
  const end = direct ?? (fromItems.length ? Math.max(...fromItems) : null);
  return end === null ? null : new Date(end * 1000);
}

async function handleStripe(ctx: Ctx, tx: DbLike, e: z.infer<typeof stripeEvent>, after: After) {
  const o = e.data.object;
  switch (e.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const m = meta(o);
      if (m.kind !== "early_unlock" || o.payment_status !== "paid" || !m.early_unlock_id) return;
      const id = m.early_unlock_id;
      const pi = str(o.payment_intent);
      if (!pi || !z.uuid().safeParse(id).success) return;
      const outcome = await confirmPaid(ctx, tx, id, { paymentRef: pi, providerRef: str(o.id) });
      after.push(() => afterPaid(ctx, id, outcome));
      return;
    }
    case "checkout.session.expired": {
      const m = meta(o);
      if (m.kind !== "early_unlock" || !z.uuid().safeParse(m.early_unlock_id).success) return;
      await tx.update(earlyUnlocks).set({ status: "expired" })
        .where(and(eq(earlyUnlocks.id, m.early_unlock_id!), eq(earlyUnlocks.status, "created")));
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      const householdId = meta(o).household_id;
      const ref = str(o.id);
      if (!ref || !z.uuid().safeParse(householdId).success) return;
      await recordSubscription(ctx, tx, {
        householdId: householdId!,
        provider: "stripe",
        subscriptionRef: ref,
        customerRef: str(o.customer),
        productRef: ctx.cfg.STRIPE_PRICE_PLUS ?? null,
        status: e.type === "customer.subscription.deleted" ? "expired" : stripeStatus(o),
        currentPeriodEnd: stripePeriodEnd(o),
        stateAt: new Date(e.created * 1000),
      });
      return;
    }
    case "charge.refunded": {
      const pi = str(o.payment_intent);
      if (pi && o.refunded === true) await markRefundedByProvider(ctx, tx, "stripe", pi);
      return;
    }
    default:
      return;
  }
}

// --- Google Play -----------------------------------------------------------------

const rtdn = z.object({
  packageName: z.string(),
  eventTimeMillis: z.coerce.number(),
  subscriptionNotification: z.object({ notificationType: z.number(), purchaseToken: z.string(), subscriptionId: z.string().optional() }).optional(),
  oneTimeProductNotification: z.object({ notificationType: z.number(), purchaseToken: z.string(), sku: z.string() }).optional(),
  voidedPurchaseNotification: z.object({ purchaseToken: z.string(), orderId: z.string().optional(), productType: z.number().optional() }).optional(),
  testNotification: z.unknown().optional(),
});

/** Looks a Play subscription up and stores it for the household the app put in obfuscatedAccountId. */
async function syncPlaySubscription(ctx: Ctx, token: string, stateAt: Date, householdHint?: string) {
  const play = ctx.billing!.play!;
  const sub = await play.subscription(token);
  const householdId = sub.accountId ?? householdHint;
  if (!householdId || !z.uuid().safeParse(householdId).success) return null;
  if (householdHint && sub.accountId && sub.accountId !== householdHint) return null;
  return { sub, householdId, stateAt };
}

async function applyPlaySubscription(ctx: Ctx, tx: DbLike, token: string, s: NonNullable<Awaited<ReturnType<typeof syncPlaySubscription>>>) {
  await recordSubscription(ctx, tx, {
    householdId: s.householdId,
    provider: "play",
    subscriptionRef: token,
    productRef: s.sub.productId,
    status: playStatus(s.sub.state),
    currentPeriodEnd: s.sub.expiryTime,
    stateAt: s.stateAt,
  });
}

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Public: the signed provider webhooks, mounted at /api/billing. */
export function billingWebhookRoutes(ctx: Ctx) {
  const app = new Hono();
  const limit = bodyLimit({ maxSize: 256 * 1024 });

  app.post("/stripe/webhook", limit, async (c) => {
    requireBilling(ctx);
    const secret = ctx.cfg.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new HTTPException(404, { message: "not found" });
    const raw = await c.req.text();
    if (!verifyStripeSignature(raw, c.req.header("stripe-signature"), secret, ctx.now())) {
      return c.json({ error: "invalid signature" }, 400);
    }
    let parsed: z.infer<typeof stripeEvent>;
    try {
      parsed = stripeEvent.parse(JSON.parse(raw));
    } catch {
      return c.json({ error: "invalid event" }, 400);
    }
    const after: After = [];
    // One transaction: if handling fails, the event id is not recorded and Stripe retries it.
    await ctx.db.transaction(async (tx) => {
      if (!(await firstTime(tx, "stripe", parsed.id, parsed.type, ctx.now()))) return;
      await handleStripe(ctx, tx, parsed, after);
    });
    for (const f of after) await f();
    return c.json({ received: true });
  });

  // Pub/Sub push subscription for real-time developer notifications. Pub/Sub retries anything
  // but a 2xx, so a failed lookup at Google answers 500 and comes back later.
  app.post("/play/rtdn", limit, async (c) => {
    requireBilling(ctx);
    const expected = ctx.cfg.PLAY_RTDN_TOKEN;
    if (!expected || !ctx.billing?.play) throw new HTTPException(404, { message: "not found" });
    if (!sameSecret(c.req.query("token") ?? "", expected)) return c.json({ error: "unauthorized" }, 401);
    const envelope = await body(c, z.object({ message: z.object({ data: z.string().max(64 * 1024), messageId: z.string().max(200) }) }));
    let n: z.infer<typeof rtdn>;
    try {
      n = rtdn.parse(JSON.parse(Buffer.from(envelope.message.data, "base64").toString("utf8")));
    } catch {
      return c.json({ ok: true, ignored: "malformed" });
    }
    if (n.packageName !== ctx.cfg.PLAY_PACKAGE_NAME) return c.json({ ok: true, ignored: "package" });
    const id = envelope.message.messageId;
    const [seen] = await ctx.db.select().from(billingEvents).where(and(eq(billingEvents.provider, "play"), eq(billingEvents.eventId, id)));
    if (seen) return c.json({ ok: true, duplicate: true });
    const stateAt = new Date(n.eventTimeMillis);
    const after: After = [];
    // Network lookups happen before the transaction; the transaction only writes.
    if (n.subscriptionNotification) {
      const token = n.subscriptionNotification.purchaseToken;
      const s = await syncPlaySubscription(ctx, token, stateAt);
      await ctx.db.transaction(async (tx) => {
        if (!(await firstTime(tx, "play", id, "subscription", ctx.now()))) return;
        if (s) await applyPlaySubscription(ctx, tx, token, s);
      });
      if (s && !s.sub.acknowledged && s.sub.productId && ["active", "grace"].includes(playStatus(s.sub.state))) {
        await ctx.billing.play.acknowledgeSubscription(s.sub.productId, token).catch(() => undefined);
      }
    } else if (n.oneTimeProductNotification) {
      const { purchaseToken: token, sku, notificationType } = n.oneTimeProductNotification;
      const product = notificationType === 1 ? await ctx.billing.play.product(sku, token) : null;
      await ctx.db.transaction(async (tx) => {
        if (!(await firstTime(tx, "play", id, `product:${notificationType}`, ctx.now()))) return;
        if (product) await fulfilPlayProduct(ctx, tx, sku, token, product, null, after);
        else {
          await tx.update(earlyUnlocks).set({ status: "expired" })
            .where(and(eq(earlyUnlocks.channel, "play"), eq(earlyUnlocks.paymentRef, token), eq(earlyUnlocks.status, "created")));
        }
      });
    } else if (n.voidedPurchaseNotification) {
      const token = n.voidedPurchaseNotification.purchaseToken;
      await ctx.db.transaction(async (tx) => {
        if (!(await firstTime(tx, "play", id, "voided", ctx.now()))) return;
        await markRefundedByProvider(ctx, tx, "play", token);
        const [sub] = await tx.select().from(billingSubscriptions)
          .where(and(eq(billingSubscriptions.provider, "play"), eq(billingSubscriptions.subscriptionRef, token)));
        if (sub) {
          await recordSubscription(ctx, tx, {
            householdId: sub.householdId, provider: "play", subscriptionRef: token, status: "expired", currentPeriodEnd: null, stateAt,
          });
        }
      });
    } else {
      await firstTime(ctx.db, "play", id, "test", ctx.now());
    }
    for (const f of after) await f();
    return c.json({ ok: true });
  });

  return app;
}

/** A verified one-time Play purchase of the early unlock: schedule it, then consume it. */
async function fulfilPlayProduct(
  ctx: Ctx, tx: DbLike, sku: string, token: string,
  product: Awaited<ReturnType<NonNullable<NonNullable<Ctx["billing"]>["play"]>["product"]>>,
  expectHousehold: string | null, after: After,
) {
  if (sku !== ctx.cfg.PLAY_PRODUCT_EARLY_UNLOCK || product.purchaseState !== 0) return null;
  const id = product.profileId;
  if (!id || !z.uuid().safeParse(id).success) return null;
  const [row] = await tx.select().from(earlyUnlocks).where(and(eq(earlyUnlocks.id, id), eq(earlyUnlocks.channel, "play")));
  if (!row || row.householdId !== product.accountId || (expectHousehold && row.householdId !== expectHousehold)) return null;
  const outcome = await confirmPaid(ctx, tx, id, { paymentRef: token, providerRef: product.orderId });
  after.push(async () => {
    await afterPaid(ctx, id, outcome);
    // Consumed, so it can be bought again next week. Play refunds a purchase never acknowledged.
    if (!product.consumed) await ctx.billing!.play!.consumeProduct(sku, token).catch(() => undefined);
  });
  return outcome;
}

// --- Parent API ------------------------------------------------------------------

export function parentBillingRoutes<E extends { Variables: { user: { id: string; email: string } } }>(
  app: Hono<E>,
  ctx: Ctx,
  helpers: {
    requireMember: (c: Context<E>, householdId: string) => Promise<unknown>;
    requirePhone: (c: Context<E>) => Promise<Phone>;
  },
) {
  const checkoutLimit = new RateLimiter(20, 60 * 60_000);

  function prices() {
    return {
      currency: ctx.cfg.BILLING_CURRENCY,
      plus: ctx.cfg.BILLING_PLUS_PRICE_MINOR,
      earlyUnlock: ctx.cfg.BILLING_EARLY_UNLOCK_PRICE_MINOR,
    };
  }

  app.get("/households/:hid/plan", async (c) => {
    const hid = param(c, "hid");
    await helpers.requireMember(c, hid);
    c.header("Cache-Control", "no-store");
    const ent = await entitlements(ctx, hid);
    const [stripeSub] = await ctx.db.select({ id: billingSubscriptions.id }).from(billingSubscriptions)
      .where(and(eq(billingSubscriptions.householdId, hid), eq(billingSubscriptions.provider, "stripe")));
    return c.json({
      ...ent,
      prices: prices(),
      channels: {
        stripe: ent.billing && Boolean(ctx.billing?.stripe && ctx.cfg.STRIPE_PRICE_PLUS),
        play: ent.billing && Boolean(ctx.billing?.play),
      },
      canManage: Boolean(stripeSub && ctx.billing?.stripe),
    });
  });

  app.post("/households/:hid/plan/checkout", async (c) => {
    requireBilling(ctx);
    const hid = param(c, "hid");
    await helpers.requireMember(c, hid);
    if (!checkoutLimit.take(c.get("user").id)) throw new HTTPException(429, { message: "too many attempts" });
    const stripe = ctx.billing?.stripe;
    const price = ctx.cfg.STRIPE_PRICE_PLUS;
    if (!stripe || !price) return c.json({ error: "card payments are not set up on this server" }, 503);
    const ent = await entitlements(ctx, hid);
    if (ent.plan !== "free") return c.json({ error: "this household already has an unlimited plan" }, 409);
    const base = ctx.cfg.PUBLIC_URL.replace(/\/+$/, "");
    const session = await stripe.createCheckoutSession({
      mode: "subscription",
      client_reference_id: hid,
      line_items: [{ price, quantity: 1 }],
      metadata: { kind: "plan", household_id: hid },
      subscription_data: { metadata: { kind: "plan", household_id: hid } },
      success_url: `${base}/plan?checkout=done`,
      cancel_url: `${base}/plan`,
    }, `plan-${hid}-${Math.floor(ctx.now().getTime() / 600_000)}`);
    return c.json({ url: session.url });
  });

  app.post("/households/:hid/plan/portal", async (c) => {
    requireBilling(ctx);
    const hid = param(c, "hid");
    await helpers.requireMember(c, hid);
    const [sub] = await ctx.db.select().from(billingSubscriptions)
      .where(and(eq(billingSubscriptions.householdId, hid), eq(billingSubscriptions.provider, "stripe")))
      .orderBy(asc(billingSubscriptions.createdAt));
    if (!sub?.customerRef || !ctx.billing?.stripe) return c.json({ error: "no card subscription to manage" }, 404);
    const { url } = await ctx.billing.stripe.createPortalSession(sub.customerRef, `${ctx.cfg.PUBLIC_URL.replace(/\/+$/, "")}/plan`);
    return c.json({ url });
  });

  async function memberChange(c: Context<E>) {
    const cid = param(c, "cid");
    const [row] = await ctx.db.select({ change: pendingChanges, phone: phones }).from(pendingChanges)
      .innerJoin(phones, eq(phones.id, pendingChanges.phoneId))
      .innerJoin(householdMembers, and(eq(householdMembers.householdId, phones.householdId), eq(householdMembers.userId, c.get("user").id)))
      .where(eq(pendingChanges.id, cid));
    if (!row) throw new HTTPException(404, { message: "not found" });
    return row;
  }

  app.get("/changes/:cid/early-unlock", async (c) => {
    requireBilling(ctx);
    const { change, phone } = await memberChange(c);
    const [key] = await ctx.db.select().from(selfKeys).where(eq(selfKeys.phoneId, phone.id));
    const offer = change.status === "pending" ? await offerFor(ctx, phone, key, change) : null;
    if (!offer) return c.json({ error: "early unlock is not offered for this change" }, 404);
    c.header("Cache-Control", "no-store");
    return c.json(offer);
  });

  app.post("/changes/:cid/early-unlock", async (c) => {
    requireBilling(ctx);
    const { change, phone } = await memberChange(c);
    if (!checkoutLimit.take(c.get("user").id)) throw new HTTPException(429, { message: "too many attempts" });
    // The consent box is never ticked in advance: the request must carry it explicitly.
    const input = await body(c, z.object({ consent: z.literal(true), locale: z.string().max(10).optional() }));
    try {
      const out = await startEarlyUnlock(ctx, {
        changeId: change.id, phone, buyerId: c.get("user").id, channel: "stripe", locale: input.locale,
      });
      return c.json({ purchase: out.purchase, checkoutUrl: out.checkoutUrl }, 201);
    } catch (err) {
      rethrow(err);
    }
  });

  async function memberUnlock(c: Context<E>) {
    const id = param(c, "id");
    const [row] = await ctx.db.select({ unlock: earlyUnlocks }).from(earlyUnlocks)
      .innerJoin(householdMembers, and(eq(householdMembers.householdId, earlyUnlocks.householdId), eq(householdMembers.userId, c.get("user").id)))
      .where(eq(earlyUnlocks.id, id));
    if (!row) throw new HTTPException(404, { message: "not found" });
    return row.unlock;
  }

  // The purchase stays readable while billing is off, so a receipt never disappears.
  app.get("/early-unlocks/:id", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(purchaseJson(await memberUnlock(c)));
  });

  // Withdrawal (Fortryd aftale) also works with billing switched off again: the right stays.
  app.post("/early-unlocks/:id/withdraw", async (c) => {
    const unlock = await memberUnlock(c);
    const input = await body(c, z.object({ confirm: z.literal(true), name: z.string().trim().max(120).optional() }));
    try {
      return c.json(purchaseJson(await withdraw(ctx, unlock.id, c.get("user").id, input.name || undefined)));
    } catch (err) {
      rethrow(err);
    }
  });
}

// --- Device API (Play builds) ----------------------------------------------------

export function deviceBillingRoutes<E extends { Variables: { phone: Phone } }>(app: Hono<E>, ctx: Ctx) {
  const limit = new RateLimiter(30, 60 * 60_000);

  async function owner(householdId: string) {
    const [m] = await ctx.db.select({ id: householdMembers.userId }).from(householdMembers)
      .where(eq(householdMembers.householdId, householdId)).orderBy(asc(householdMembers.createdAt));
    return m?.id ?? null;
  }

  app.get("/billing", async (c) => {
    requireBilling(ctx);
    const phone = c.get("phone");
    c.header("Cache-Control", "no-store");
    const ent = await entitlements(ctx, phone.householdId);
    return c.json({
      plan: ent.plan,
      until: ent.until,
      limits: ent.limits,
      usage: ent.usage,
      prices: { currency: ctx.cfg.BILLING_CURRENCY, plus: ctx.cfg.BILLING_PLUS_PRICE_MINOR, earlyUnlock: ctx.cfg.BILLING_EARLY_UNLOCK_PRICE_MINOR },
      play: ctx.billing?.play ? { plusProductId: ctx.cfg.PLAY_PRODUCT_PLUS, earlyUnlockProductId: ctx.cfg.PLAY_PRODUCT_EARLY_UNLOCK, accountId: phone.householdId } : null,
    });
  });

  app.get("/early-unlocks", async (c) => {
    requireBilling(ctx);
    const phone = c.get("phone");
    const [key] = await ctx.db.select().from(selfKeys).where(eq(selfKeys.phoneId, phone.id));
    const pending = await ctx.db.select().from(pendingChanges)
      .where(and(eq(pendingChanges.phoneId, phone.id), eq(pendingChanges.status, "pending")));
    const offers = [];
    for (const change of pending) {
      const offer = await offerFor(ctx, phone, key, change);
      if (offer) offers.push({ changeId: change.id, effectiveAt: change.effectiveAt?.toISOString() ?? null, offer });
    }
    c.header("Cache-Control", "no-store");
    return c.json({ offers });
  });

  // Play builds only buy through Google Play: there is no card (Stripe) path for a phone.
  app.post("/early-unlocks", async (c) => {
    requireBilling(ctx);
    const phone = c.get("phone");
    if (!limit.take(phone.id)) throw new HTTPException(429, { message: "too many attempts" });
    const input = await body(c, z.object({ changeId: z.uuid(), consent: z.literal(true) }));
    try {
      const out = await startEarlyUnlock(ctx, { changeId: input.changeId, phone, buyerId: await owner(phone.householdId), channel: "play" });
      return c.json({ purchase: out.purchase, productId: out.productId, accountId: out.accountId }, 201);
    } catch (err) {
      rethrow(err);
    }
  });

  app.post("/early-unlocks/:id/withdraw", async (c) => {
    const phone = c.get("phone");
    const id = param(c, "id");
    const input = await body(c, z.object({ confirm: z.literal(true), name: z.string().trim().max(120).optional() }));
    const [row] = await ctx.db.select().from(earlyUnlocks).where(and(eq(earlyUnlocks.id, id), eq(earlyUnlocks.phoneId, phone.id)));
    if (!row) throw new HTTPException(404, { message: "not found" });
    const who = row.buyerId ?? (await owner(phone.householdId));
    if (!who) throw new HTTPException(404, { message: "not found" });
    try {
      return c.json(purchaseJson(await withdraw(ctx, row.id, who, input.name || undefined)));
    } catch (err) {
      rethrow(err);
    }
  });

  /** The phone reports a finished Play purchase. The server looks it up at Google before it counts. */
  app.post("/billing/play", async (c) => {
    requireBilling(ctx);
    const phone = c.get("phone");
    if (!ctx.billing?.play) return c.json({ error: "Google Play payments are not set up on this server" }, 503);
    if (!limit.take(phone.id)) throw new HTTPException(429, { message: "too many attempts" });
    const input = await body(c, z.object({
      kind: z.enum(["plan", "earlyUnlock"]),
      productId: z.string().max(100),
      purchaseToken: z.string().min(10).max(4096),
    }));
    if (input.kind === "plan") {
      if (input.productId !== ctx.cfg.PLAY_PRODUCT_PLUS) return c.json({ error: "unknown product" }, 400);
      const s = await syncPlaySubscription(ctx, input.purchaseToken, ctx.now(), phone.householdId);
      if (!s || s.householdId !== phone.householdId) return c.json({ error: "this purchase belongs to another household" }, 409);
      await ctx.db.transaction((tx) => applyPlaySubscription(ctx, tx, input.purchaseToken, s));
      if (!s.sub.acknowledged && s.sub.productId && ["active", "grace"].includes(playStatus(s.sub.state))) {
        await ctx.billing.play.acknowledgeSubscription(s.sub.productId, input.purchaseToken).catch(() => undefined);
      }
      const ent = await entitlements(ctx, phone.householdId);
      return c.json({ plan: ent.plan, until: ent.until });
    }
    const product = await ctx.billing.play.product(input.productId, input.purchaseToken);
    const after: After = [];
    const outcome = await ctx.db.transaction((tx) =>
      fulfilPlayProduct(ctx, tx, input.productId, input.purchaseToken, product, phone.householdId, after));
    for (const f of after) await f();
    if (!outcome) return c.json({ error: "this purchase could not be matched" }, 409);
    const [row] = await ctx.db.select().from(earlyUnlocks).where(eq(earlyUnlocks.id, product.profileId!));
    return c.json(purchaseJson(row!));
  });
}
