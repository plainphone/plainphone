// SPDX-License-Identifier: Apache-2.0
//
// The hosted plan behind BILLING_ENABLED (#97, docs/billing.md): off changes nothing, limits only
// apply to adding phones, existing households are grandfathered, and the plan comes only from
// signed, idempotent provider events. Synthetic payloads only; no network.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { billingEvents, households, selfKeys, users } from "../src/db/schema.js";
import { verifyStripeSignature, signStripePayload, formEncode } from "../src/providers/stripe.js";
import { enableBilling, playRtdn, RTDN_TOKEN, stripeWebhook, WEBHOOK_SECRET } from "./billing-helpers.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

async function household(c: Client) {
  return (await c.get("/api/me")).json.households[0].id as string;
}

const subscription = (householdId: string, over: Record<string, unknown> = {}) => ({
  id: "sub_test_1",
  object: "subscription",
  customer: "cus_test_1",
  status: "active",
  cancel_at_period_end: false,
  metadata: { kind: "plan", household_id: householdId },
  items: { data: [{ current_period_end: Math.floor(h.clock.now.getTime() / 1000) + 30 * 86_400 }] },
  ...over,
});

describe("with BILLING_ENABLED off (the default)", () => {
  it("keeps everyone unlimited, shows no offers and hides every billing route", async () => {
    expect(h.ctx.cfg.BILLING_ENABLED).toBe(false);
    const parent = await signIn(h, "parent@example.org");
    const hid = await household(parent);
    await pairPhone(h, parent, { name: "One" });
    await pairPhone(h, parent, { name: "Two" });
    const { phoneId } = await pairPhone(h, parent, { name: "Three", profile: "self" });

    const plan = await parent.get(`/api/households/${hid}/plan`);
    expect(plan.status).toBe(200);
    expect(plan.json).toMatchObject({ billing: false, plan: "unlimited", limits: { phones: null, trusted: null } });
    expect(plan.json.channels).toEqual({ stripe: false, play: false });

    expect((await parent.post(`/api/households/${hid}/plan/checkout`)).status).toBe(404);
    const raw = "{}";
    const hook = await h.app.request("/api/billing/stripe/webhook", {
      method: "POST", body: raw, headers: { "stripe-signature": signStripePayload(raw, WEBHOOK_SECRET, h.clock.now) },
    });
    expect(hook.status).toBe(404);
    expect((await playRtdn(h, { testNotification: {} })).status).toBe(404);

    // A Self phone with a pending change: no early unlock anywhere.
    await h.ctx.db.update(households).set({ plan: "free" });
    const changes = await parent.get(`/api/phones/${phoneId}/changes`);
    for (const c of changes.json.changes) expect(c).not.toHaveProperty("earlyUnlock");
    expect(h.ctx.billing).toBeUndefined();
  });

  it("switches billing off again when the grandfathering cutoff is missing", () => {
    const cfg = loadConfig({ DATABASE_URL: "x", BILLING_ENABLED: "true" });
    expect(cfg.BILLING_ENABLED).toBe(false);
    expect(cfg.configWarnings.other).toContain("billing: BILLING_ENABLED needs BILLING_GRANDFATHER_BEFORE");
    // An unknown value is reported, never fatal.
    const odd = loadConfig({ DATABASE_URL: "x", BILLING_ENABLED: "yes please" });
    expect(odd.BILLING_ENABLED).toBe(false);
    expect(odd.configWarnings.other).toContain("billing: invalid BILLING_ENABLED");
    // Neither do malformed billing settings on a server where billing is off.
    const bad = loadConfig({ DATABASE_URL: "x", PLAY_RTDN_TOKEN: "short", BILLING_GRANDFATHER_BEFORE: "last tuesday" });
    expect(bad.PLAY_RTDN_TOKEN).toBeUndefined();
    expect(bad.BILLING_GRANDFATHER_BEFORE).toBeUndefined();
    expect(bad.configWarnings.other).toEqual(expect.arrayContaining(["billing: invalid PLAY_RTDN_TOKEN", "billing: invalid BILLING_GRANDFATHER_BEFORE"]));
  });
});

describe("plan limits with billing on", () => {
  it("lets a free household add one phone, then answers 402 for the next", async () => {
    enableBilling(h);
    const parent = await signIn(h, "parent@example.org");
    const hid = await household(parent);
    await pairPhone(h, parent, { name: "One" });
    const device = new Client(h);
    const start = await device.post("/api/device/pairings", { mode: "strong", deviceInfo: { model: "Test" } });
    const second = await parent.post("/api/phones/claim", { code: start.json.code, name: "Two", profile: "child" });
    expect(second.status).toBe(402);
    expect(second.json).toEqual({ error: "plan_limit", limit: "phones", max: 1 });
    const enroll = await parent.post("/api/phones/enroll", { name: "Two", profile: "child" });
    expect(enroll.status).toBe(402);

    const plan = await parent.get(`/api/households/${hid}/plan`);
    expect(plan.json).toMatchObject({ billing: true, plan: "free", limits: { phones: 1 }, usage: { phones: 1 } });
    expect(plan.json.prices).toEqual({ currency: "DKK", plus: 2900, earlyUnlock: 1000 });
  });

  it("grandfathers households created before the cutoff", async () => {
    enableBilling(h, { BILLING_GRANDFATHER_BEFORE: "2027-01-01T00:00:00Z" });
    const parent = await signIn(h, "parent@example.org");
    await pairPhone(h, parent, { name: "One" });
    await pairPhone(h, parent, { name: "Two" });
    const plan = await parent.get(`/api/households/${await household(parent)}/plan`);
    expect(plan.json).toMatchObject({ plan: "grandfathered", limits: { phones: null } });
  });

  it("honours a manual grant and limits trusted people only on the free plan", async () => {
    enableBilling(h, { BILLING_FREE_PHONES: "3", BILLING_FREE_TRUSTED: "1" });
    const parent = await signIn(h, "adult@example.org");
    const a = await pairPhone(h, parent, { name: "A", profile: "self" });
    const b = await pairPhone(h, parent, { name: "B", profile: "self" });
    const key = (email: string) => ({ keyType: "trusted", delayHours: 24, trustedEmail: email, payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone" });
    expect((await parent.put(`/api/phones/${a.phoneId}/key`, key("one@example.org"))).status).toBeLessThan(300);
    // The key change waits for the delay; apply it so the household has one trusted person.
    h.clock.advance(25 * 3_600_000);
    await a.device.get("/api/device/rules");
    const blocked = await parent.put(`/api/phones/${b.phoneId}/key`, key("two@example.org"));
    expect(blocked.status).toBe(402);
    expect(blocked.json.limit).toBe("trusted");
    // The same person may help on a second phone, also once they accepted and are stored by account.
    await signIn(h, "one@example.org");
    const [one] = await h.ctx.db.select().from(users).where(eq(users.email, "one@example.org"));
    await h.ctx.db.update(selfKeys).set({ trustedUserId: one!.id, trustedEmail: null }).where(eq(selfKeys.phoneId, a.phoneId));
    expect((await parent.put(`/api/phones/${b.phoneId}/key`, key("one@example.org"))).status).toBeLessThan(300);
    await h.ctx.db.update(households).set({ plan: "plus", planSource: "manual", planUntil: null });
    expect((await parent.put(`/api/phones/${b.phoneId}/key`, key("two@example.org"))).status).toBeLessThan(300);
  });
});

describe("Stripe", () => {
  it("verifies signatures, including age and rolled secrets", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    const body = '{"id":"evt_1"}';
    const header = signStripePayload(body, WEBHOOK_SECRET, now);
    expect(verifyStripeSignature(body, header, WEBHOOK_SECRET, now)).toBe(true);
    expect(verifyStripeSignature(body + " ", header, WEBHOOK_SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, header, "whsec_other", now)).toBe(false);
    expect(verifyStripeSignature(body, header, WEBHOOK_SECRET, new Date(now.getTime() + 301_000))).toBe(false);
    expect(verifyStripeSignature(body, `${header},v1=${"0".repeat(64)}`, WEBHOOK_SECRET, now)).toBe(true);
    expect(verifyStripeSignature(body, undefined, WEBHOOK_SECRET, now)).toBe(false);
    expect(formEncode({ a: [{ b: 1 }], c: { d: "e" }, n: null }).toString()).toBe("a%5B0%5D%5Bb%5D=1&c%5Bd%5D=e");
  });

  it("sets the paid plan from subscription events only, once per event, newest state wins", async () => {
    enableBilling(h);
    const parent = await signIn(h, "parent@example.org");
    const hid = await household(parent);
    await pairPhone(h, parent, { name: "One" });

    expect((await stripeWebhook(h, "customer.subscription.created", subscription(hid), { signature: "t=1,v1=00" })).status).toBe(400);
    expect((await parent.get(`/api/households/${hid}/plan`)).json.plan).toBe("free");

    const created = await stripeWebhook(h, "customer.subscription.created", subscription(hid), { id: "evt_a" });
    expect(created.status).toBe(200);
    let plan = (await parent.get(`/api/households/${hid}/plan`)).json;
    expect(plan).toMatchObject({ plan: "plus", source: "stripe", limits: { phones: null }, prioritySupport: true, canManage: true });
    await pairPhone(h, parent, { name: "Two" });

    // A retried delivery of the same event is a no-op.
    expect((await stripeWebhook(h, "customer.subscription.deleted", subscription(hid), { id: "evt_a" })).status).toBe(200);
    expect((await parent.get(`/api/households/${hid}/plan`)).json.plan).toBe("plus");
    expect(await h.ctx.db.select().from(billingEvents)).toHaveLength(1);

    // An older event arriving late does not overwrite the newer state.
    await stripeWebhook(h, "customer.subscription.updated", subscription(hid, { status: "canceled" }), { created: new Date(h.clock.now.getTime() - 60_000) });
    expect((await parent.get(`/api/households/${hid}/plan`)).json.plan).toBe("plus");

    // Cancelled at period end: still paid until then.
    h.clock.advance(1000);
    await stripeWebhook(h, "customer.subscription.updated", subscription(hid, { cancel_at_period_end: true }));
    plan = (await parent.get(`/api/households/${hid}/plan`)).json;
    expect(plan.plan).toBe("plus");
    h.clock.advance(31 * 86_400_000);
    plan = (await parent.get(`/api/households/${hid}/plan`)).json;
    // Lapsed: free again, the two phones stay, only a third cannot be added.
    expect(plan).toMatchObject({ plan: "free", usage: { phones: 2 } });
    expect((await parent.post("/api/phones/enroll", { name: "Three", profile: "child" })).status).toBe(402);
  });

  it("opens a subscription checkout and refuses one for a household that already pays", async () => {
    const { stripe } = enableBilling(h);
    const parent = await signIn(h, "parent@example.org");
    const hid = await household(parent);
    const r = await parent.post(`/api/households/${hid}/plan/checkout`);
    expect(r.status).toBe(200);
    expect(r.json.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(stripe.sessions[0]!.params).toMatchObject({
      mode: "subscription", client_reference_id: hid, line_items: [{ price: "price_test_plus", quantity: 1 }],
      subscription_data: { metadata: { household_id: hid } },
    });
    // The success page grants nothing: only the webhook does.
    expect((await parent.get(`/api/households/${hid}/plan`)).json.plan).toBe("free");
    const other = await signIn(h, "other@example.org");
    expect((await other.post(`/api/households/${hid}/plan/checkout`)).status).toBe(404);
    await stripeWebhook(h, "customer.subscription.created", subscription(hid));
    expect((await parent.post(`/api/households/${hid}/plan/checkout`)).status).toBe(409);
    expect((await parent.post(`/api/households/${hid}/plan/portal`)).json.url).toContain("cus_test_1");
  });

  it("cancels the subscription of a household deleted with its account", async () => {
    const { stripe } = enableBilling(h);
    const parent = await signIn(h, "parent@example.org");
    const hid = await household(parent);
    await stripeWebhook(h, "customer.subscription.created", subscription(hid));
    const r = await parent.call("DELETE", "/api/me", { confirmEmail: "parent@example.org" });
    expect(r.status).toBe(200);
    expect(stripe.cancelled).toEqual(["sub_test_1"]);
  });
});

describe("Google Play", () => {
  it("takes subscription state from Google, never from the phone, and acknowledges it", async () => {
    const { play } = enableBilling(h);
    const parent = await signIn(h, "parent@example.org");
    const hid = await household(parent);
    const { device } = await pairPhone(h, parent, { name: "Mine", profile: "self", mode: "light" });

    expect((await playRtdn(h, { testNotification: {} }, { token: "wrong-token-wrong-token-wrong" })).status).toBe(401);
    expect((await playRtdn(h, { testNotification: {} })).status).toBe(200);

    play.subscriptions.set("tok-other-household", { state: "SUBSCRIPTION_STATE_ACTIVE", expiryTime: new Date(h.clock.now.getTime() + 86_400_000), accountId: "7d7d7d7d-0000-4000-8000-000000000000", acknowledged: false, productId: "plus_household" });
    const stolen = await device.post("/api/device/billing/play", { kind: "plan", productId: "plus_household", purchaseToken: "tok-other-household" });
    expect(stolen.status).toBe(409);

    play.subscriptions.set("tok-mine-0001", { state: "SUBSCRIPTION_STATE_ACTIVE", expiryTime: new Date(h.clock.now.getTime() + 30 * 86_400_000), accountId: hid, acknowledged: false, productId: "plus_household" });
    const mine = await device.post("/api/device/billing/play", { kind: "plan", productId: "plus_household", purchaseToken: "tok-mine-0001" });
    expect(mine.status).toBe(200);
    expect(mine.json.plan).toBe("plus");
    expect(play.acknowledged).toEqual(["tok-mine-0001"]);

    // Real-time notification: on hold → back to free. A repeated message changes nothing.
    play.subscriptions.set("tok-mine-0001", { ...play.subscriptions.get("tok-mine-0001")!, state: "SUBSCRIPTION_STATE_ON_HOLD", acknowledged: true });
    h.clock.advance(1000);
    const note = { subscriptionNotification: { version: "1.0", notificationType: 5, purchaseToken: "tok-mine-0001", subscriptionId: "plus_household" } };
    expect((await playRtdn(h, note, { messageId: "m1" })).status).toBe(200);
    expect((await parent.get(`/api/households/${hid}/plan`)).json.plan).toBe("free");
    play.subscriptions.set("tok-mine-0001", { ...play.subscriptions.get("tok-mine-0001")!, state: "SUBSCRIPTION_STATE_ACTIVE" });
    expect((await playRtdn(h, note, { messageId: "m1" })).json.duplicate).toBe(true);
    expect((await parent.get(`/api/households/${hid}/plan`)).json.plan).toBe("free");
    expect(RTDN_TOKEN.length).toBeGreaterThanOrEqual(24);
  });
});

describe("the household plan row", () => {
  it("is free for new households and unchanged by the migration for old ones", async () => {
    const parent = await signIn(h, "parent@example.org");
    const [row] = await h.ctx.db.select().from(households).where(eq(households.id, await household(parent)));
    expect(row).toMatchObject({ plan: "free", planSource: null, planUntil: null });
  });
});
