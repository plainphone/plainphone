// SPDX-License-Identifier: Apache-2.0
//
// Billing in tests: the flag on, fake Stripe and Play clients that record calls, and signed
// synthetic webhook payloads. Nothing here talks to Stripe or Google.
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { PlayApi, PlayProduct, PlaySubscription } from "../src/providers/play-billing.js";
import { signStripePayload, type StripeApi } from "../src/providers/stripe.js";
import { type Harness, PUBLIC_URL } from "./harness.js";

/** A synthetic signing secret, the same shape as Stripe's. Not a real key. */
export const WEBHOOK_SECRET = "whsec_test_0123456789abcdef0123456789abcdef";
export const RTDN_TOKEN = "rtdn-test-token-0123456789abcdef";

export class FakeStripe implements StripeApi {
  sessions: { params: Record<string, unknown>; key: string; id: string }[] = [];
  refunds: { paymentIntent: string; key: string }[] = [];
  cancelled: string[] = [];
  failRefunds = false;

  async createCheckoutSession(params: Record<string, unknown>, key: string) {
    const seen = this.sessions.find((s) => s.key === key);
    if (seen) return { id: seen.id, url: `https://checkout.stripe.test/${seen.id}` };
    const id = `cs_test_${this.sessions.length + 1}`;
    this.sessions.push({ params, key, id });
    return { id, url: `https://checkout.stripe.test/${id}` };
  }

  async createRefund(paymentIntent: string, key: string) {
    if (this.failRefunds) throw new Error("stripe refunds failed with 500");
    this.refunds.push({ paymentIntent, key });
    return { id: `re_${this.refunds.length}` };
  }

  async createPortalSession(customer: string) {
    return { url: `https://billing.stripe.test/${customer}` };
  }

  async cancelSubscription(id: string) {
    this.cancelled.push(id);
  }
}

export class FakePlay implements PlayApi {
  subscriptions = new Map<string, PlaySubscription>();
  products = new Map<string, PlayProduct>();
  acknowledged: string[] = [];
  consumed: string[] = [];
  refunded: string[] = [];
  cancelled: string[] = [];

  async subscription(token: string) {
    const s = this.subscriptions.get(token);
    if (!s) throw new Error("Play GET failed with 404");
    return s;
  }
  async acknowledgeSubscription(_: string, token: string) { this.acknowledged.push(token); }
  async product(_: string, token: string) {
    const p = this.products.get(token);
    if (!p) throw new Error("Play GET failed with 404");
    return p;
  }
  async consumeProduct(_: string, token: string) { this.consumed.push(token); }
  async refundOrder(orderId: string) { this.refunded.push(orderId); }
  async cancelSubscription(_: string, token: string) { this.cancelled.push(token); }
}

/**
 * Billing on, with every household created before `grandfatherBefore` grandfathered. The
 * default cutoff lies before the harness clock, so households made in a test are on the free plan.
 */
export function enableBilling(h: Harness, env: Record<string, string> = {}) {
  const stripe = new FakeStripe();
  const play = new FakePlay();
  h.ctx.cfg = loadConfig({
    DATABASE_URL: "unused",
    PUBLIC_URL,
    NODE_ENV: "test",
    BILLING_ENABLED: "true",
    BILLING_GRANDFATHER_BEFORE: "2026-01-01T00:00:00Z",
    STRIPE_SECRET_KEY: "sk_test_synthetic",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_PLUS: "price_test_plus",
    PLAY_RTDN_TOKEN: RTDN_TOKEN,
    ...env,
  });
  h.ctx.billing = { stripe, play };
  h.app = createApp(h.ctx);
  return { stripe, play };
}

let eventCounter = 0;

/** Posts a Stripe event with a valid signature (or the given header). */
export async function stripeWebhook(
  h: Harness,
  type: string,
  object: Record<string, unknown>,
  opts: { id?: string; created?: Date; signature?: string } = {},
) {
  const created = opts.created ?? h.clock.now;
  const event = { id: opts.id ?? `evt_test_${++eventCounter}`, type, created: Math.floor(created.getTime() / 1000), data: { object } };
  const raw = JSON.stringify(event);
  const res = await h.app.request("/api/billing/stripe/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": opts.signature ?? signStripePayload(raw, WEBHOOK_SECRET, h.clock.now) },
    body: raw,
  });
  return { status: res.status, json: await res.json().catch(() => null), event };
}

/** Posts a Pub/Sub push with a Play notification. */
export async function playRtdn(h: Harness, notification: Record<string, unknown>, opts: { messageId?: string; token?: string } = {}) {
  const data = Buffer.from(JSON.stringify({
    version: "1.0", packageName: "org.plainphone.app", eventTimeMillis: String(h.clock.now.getTime()), ...notification,
  })).toString("base64");
  const res = await h.app.request(`/api/billing/play/rtdn?token=${encodeURIComponent(opts.token ?? RTDN_TOKEN)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: { data, messageId: opts.messageId ?? `msg-${++eventCounter}` }, subscription: "projects/test/subscriptions/rtdn" }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
