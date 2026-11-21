// SPDX-License-Identifier: Apache-2.0
//
// Google Play Developer API calls for Play Billing (docs/billing.md). The server never trusts
// what the phone says it bought: every purchase token is looked up here first. Tests use a
// fake PlayApi; nothing in the test suite talks to Google.

import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { z } from "zod";

export interface PlaySubscription {
  /** SUBSCRIPTION_STATE_ACTIVE, _IN_GRACE_PERIOD, _ON_HOLD, _PAUSED, _CANCELED, _EXPIRED, _PENDING ... */
  state: string;
  expiryTime: Date | null;
  /** What the app put in obfuscatedAccountId: the household id. */
  accountId: string | null;
  acknowledged: boolean;
  productId: string | null;
}

export interface PlayProduct {
  /** 0 purchased, 1 canceled, 2 pending. */
  purchaseState: number;
  consumed: boolean;
  acknowledged: boolean;
  orderId: string | null;
  /** obfuscatedExternalAccountId: the household id. */
  accountId: string | null;
  /** obfuscatedExternalProfileId: the early unlock id. */
  profileId: string | null;
}

export interface PlayApi {
  subscription(token: string): Promise<PlaySubscription>;
  acknowledgeSubscription(productId: string, token: string): Promise<void>;
  product(productId: string, token: string): Promise<PlayProduct>;
  consumeProduct(productId: string, token: string): Promise<void>;
  /** Refunds and revokes a one-time order. */
  refundOrder(orderId: string): Promise<void>;
  /** Stops renewal; the plan runs to the end of the paid period (the household was deleted). */
  cancelSubscription(productId: string, token: string): Promise<void>;
}

const googleAuth = "https://oauth2.googleapis.com/token";
const account = z.object({ client_email: z.email(), private_key: z.string() });

function jwt(claims: object, key: KeyObject) {
  const data = [{ alg: "RS256", typ: "JWT" }, claims].map((p) => Buffer.from(JSON.stringify(p)).toString("base64url")).join(".");
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), key).toString("base64url")}`;
}

export class HttpPlay implements PlayApi {
  private readonly email: string;
  private readonly key: KeyObject;
  private access?: { token: string; until: number };

  constructor(serviceAccountJson: string, private readonly packageName: string, private readonly http: typeof fetch = fetch) {
    const parsed = account.parse(JSON.parse(serviceAccountJson));
    this.email = parsed.client_email;
    this.key = createPrivateKey(parsed.private_key);
  }

  private async token() {
    if (this.access && this.access.until > Date.now()) return this.access.token;
    const iat = Math.floor(Date.now() / 1000);
    const assertion = jwt({
      iss: this.email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: googleAuth, iat, exp: iat + 3600,
    }, this.key);
    const r = await this.http(googleAuth, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!r.ok) throw new Error("Play authorization failed");
    const { access_token, expires_in } = z.object({ access_token: z.string(), expires_in: z.number() }).parse(await r.json());
    this.access = { token: access_token, until: Date.now() + (expires_in - 60) * 1000 };
    return access_token;
  }

  private async call(path: string, method: "GET" | "POST" = "GET"): Promise<unknown> {
    const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(this.packageName)}`;
    const r = await this.http(`${base}/${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${await this.token()}`, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    if (!r.ok) throw new Error(`Play ${method} failed with ${r.status}`);
    const text = await r.text();
    return text ? JSON.parse(text) : {};
  }

  async subscription(token: string): Promise<PlaySubscription> {
    const s = z.object({
      subscriptionState: z.string(),
      acknowledgementState: z.string().optional(),
      lineItems: z.array(z.object({ productId: z.string().optional(), expiryTime: z.string().optional() })).optional(),
      externalAccountIdentifiers: z.object({ obfuscatedExternalAccountId: z.string().optional() }).optional(),
    }).parse(await this.call(`purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`));
    const expiries = (s.lineItems ?? []).map((l) => l.expiryTime).filter(Boolean).map((t) => new Date(t!).getTime());
    return {
      state: s.subscriptionState,
      expiryTime: expiries.length ? new Date(Math.max(...expiries)) : null,
      accountId: s.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
      acknowledged: s.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      productId: s.lineItems?.[0]?.productId ?? null,
    };
  }

  async acknowledgeSubscription(productId: string, token: string) {
    await this.call(`purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:acknowledge`, "POST");
  }

  async product(productId: string, token: string): Promise<PlayProduct> {
    const p = z.object({
      purchaseState: z.number().optional(),
      consumptionState: z.number().optional(),
      acknowledgementState: z.number().optional(),
      orderId: z.string().optional(),
      obfuscatedExternalAccountId: z.string().optional(),
      obfuscatedExternalProfileId: z.string().optional(),
    }).parse(await this.call(`purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`));
    return {
      purchaseState: p.purchaseState ?? 0,
      consumed: p.consumptionState === 1,
      acknowledged: p.acknowledgementState === 1,
      orderId: p.orderId ?? null,
      accountId: p.obfuscatedExternalAccountId ?? null,
      profileId: p.obfuscatedExternalProfileId ?? null,
    };
  }

  async consumeProduct(productId: string, token: string) {
    await this.call(`purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:consume`, "POST");
  }

  async cancelSubscription(productId: string, token: string) {
    await this.call(`purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:cancel`, "POST");
  }

  async refundOrder(orderId: string) {
    await this.call(`orders/${encodeURIComponent(orderId)}:refund?revoke=true`, "POST");
  }
}

/** Play subscription state → the stored status (billing_subscriptions.status). */
export function playStatus(state: string) {
  switch (state) {
    case "SUBSCRIPTION_STATE_ACTIVE": return "active" as const;
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD": return "grace" as const;
    case "SUBSCRIPTION_STATE_CANCELED": return "canceled" as const;
    case "SUBSCRIPTION_STATE_ON_HOLD": return "on_hold" as const;
    case "SUBSCRIPTION_STATE_PAUSED": return "paused" as const;
    case "SUBSCRIPTION_STATE_PENDING": return "pending" as const;
    default: return "expired" as const;
  }
}
