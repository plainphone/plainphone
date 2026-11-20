// SPDX-License-Identifier: Apache-2.0
//
// The few Stripe calls billing needs (docs/billing.md), over plain fetch so no SDK is pulled in.
// Every write carries an Idempotency-Key, so a retried request never charges or refunds twice.

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export interface StripeApi {
  createCheckoutSession(params: Record<string, unknown>, idempotencyKey: string): Promise<{ id: string; url: string }>;
  createRefund(paymentIntent: string, idempotencyKey: string): Promise<{ id: string }>;
  createPortalSession(customer: string, returnUrl: string): Promise<{ url: string }>;
  /** Ends a subscription at once (the household was deleted). */
  cancelSubscription(subscription: string): Promise<void>;
}

/** Stripe's form encoding: nested objects and arrays as `a[b][0]=c`. */
export function formEncode(params: Record<string, unknown>): URLSearchParams {
  const out = new URLSearchParams();
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${prefix}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v)) walk(prefix ? `${prefix}[${k}]` : k, x);
    else out.append(prefix, String(v));
  };
  walk("", params);
  return out;
}

export class HttpStripe implements StripeApi {
  constructor(private readonly secretKey: string, private readonly http: typeof fetch = fetch) {}

  private async post<T extends z.ZodType>(path: string, params: Record<string, unknown>, schema: T, idempotencyKey?: string, method = "POST"): Promise<z.infer<T>> {
    const response = await this.http(`https://api.stripe.com/v1/${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      ...(method === "POST" ? { body: formEncode(params) } : {}),
    });
    // Never log Stripe's body: it can carry customer details.
    if (!response.ok) throw new Error(`stripe ${path} failed with ${response.status}`);
    return schema.parse(await response.json());
  }

  createCheckoutSession(params: Record<string, unknown>, idempotencyKey: string) {
    return this.post("checkout/sessions", params, z.object({ id: z.string(), url: z.url() }), idempotencyKey);
  }

  createRefund(paymentIntent: string, idempotencyKey: string) {
    return this.post("refunds", { payment_intent: paymentIntent }, z.object({ id: z.string() }), idempotencyKey);
  }

  createPortalSession(customer: string, returnUrl: string) {
    return this.post("billing_portal/sessions", { customer, return_url: returnUrl }, z.object({ url: z.url() }));
  }

  async cancelSubscription(subscription: string) {
    await this.post(`subscriptions/${encodeURIComponent(subscription)}`, {}, z.object({ id: z.string() }), undefined, "DELETE");
  }
}

/** Seconds a signed webhook may be old (Stripe's own default). */
export const STRIPE_TOLERANCE_SECONDS = 300;

/**
 * Checks a `Stripe-Signature` header: `t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`, with
 * possibly several v1 values while a secret is rolled.
 */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, now: Date): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("=", 2) as [string, string | undefined]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k, v]) => k === "v1" && v).map(([, v]) => v!);
  if (!Number.isInteger(t) || sigs.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - t) > STRIPE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return sigs.some((s) => {
    if (!/^[0-9a-f]{64}$/.test(s)) return false;
    return timingSafeEqual(Buffer.from(s, "hex"), expected);
  });
}

/** Builds a header the way Stripe does: for tests and fixtures only. */
export function signStripePayload(rawBody: string, secret: string, at: Date): string {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}
