// SPDX-License-Identifier: Apache-2.0
//
// Paid early unlock on Myself phones (#103, docs/billing.md). Synthetic Stripe and Play
// payloads only. The clock is pinned by the harness.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { earlyUnlocks, pendingChanges, phoneApps, phones } from "../src/db/schema.js";
import { sweep } from "../src/services/sweeper.js";
import { enableBilling, playRtdn, stripeWebhook } from "./billing-helpers.js";
import { type Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();
const MIN = 60_000;

const delayKey = (payUnlockEnabled: boolean) => ({
  keyType: "delay", delayHours: 24, trustedEmail: null, payUnlockEnabled, payUnlockAmount: 50000, payUnlockRecipient: "plainphone",
});

/** A Myself phone with the paid early unlock switched on and one loosening waiting 24 hours. */
async function myself(opts: { payUnlock?: boolean } = {}) {
  const me = await signIn(h, "adult@example.org");
  const { phoneId, device } = await pairPhone(h, me, { name: "My phone", profile: "self", mode: "light" });
  await h.ctx.db.update(phones).set({ openMode: false }).where(eq(phones.id, phoneId));
  await device.put("/api/device/apps", {
    apps: ["com.instagram.android", "com.spotify.music", "org.example.news"].map((p) => ({ packageName: p, label: p })),
  });
  if (opts.payUnlock ?? true) {
    // Switching it on loosens the key, so it waits for the delay itself.
    await me.put(`/api/phones/${phoneId}/key`, delayKey(true));
    h.clock.advance(24 * 3_600_000 + 1000);
    await device.get("/api/device/rules");
  }
  return { me, phoneId, device };
}

async function loosen(me: Client, phoneId: string, pkg = "com.instagram.android") {
  const r = await me.put(`/api/phones/${phoneId}/apps/${pkg}`, { allowed: true });
  expect(r.json.status).toBe("pending");
  return r.json.change.id as string;
}

async function pay(changeId: string, me: Client) {
  const start = await me.post(`/api/changes/${changeId}/early-unlock`, { consent: true });
  expect(start.status).toBe(201);
  const purchase = start.json.purchase;
  const [row] = await h.ctx.db.select().from(earlyUnlocks).where(eq(earlyUnlocks.id, purchase.id));
  const done = await stripeWebhook(h, "checkout.session.completed", {
    id: row!.providerRef, object: "checkout.session", payment_status: "paid", payment_intent: `pi_${purchase.id.slice(0, 8)}`,
    metadata: { kind: "early_unlock", early_unlock_id: purchase.id },
  });
  expect(done.status).toBe(200);
  return { purchaseId: purchase.id as string, checkoutUrl: start.json.checkoutUrl as string, event: done.event };
}

const unlockRow = async (id: string) => (await h.ctx.db.select().from(earlyUnlocks).where(eq(earlyUnlocks.id, id)))[0]!;

describe("who gets an offer", () => {
  it("only a Myself phone with its own delay key and the switch on", async () => {
    enableBilling(h);
    const { me, phoneId, device } = await myself({ payUnlock: false });
    const cid = await loosen(me, phoneId);
    expect((await me.get(`/api/changes/${cid}/early-unlock`)).status).toBe(404);
    expect((await me.get(`/api/phones/${phoneId}/changes`)).json.changes[0]).not.toHaveProperty("earlyUnlock");
    expect((await device.get("/api/device/rules")).json).not.toHaveProperty("earlyUnlock");

    await me.put(`/api/phones/${phoneId}/key`, delayKey(true));
    h.clock.advance(24 * 3_600_000 + 1000);
    await device.get("/api/device/rules");
    const cid2 = await loosen(me, phoneId, "com.spotify.music");
    const offer = await me.get(`/api/changes/${cid2}/early-unlock`);
    expect(offer.json).toMatchObject({ available: true, price: 1000, currency: "DKK", unlockMinutes: 10 });
    expect((await device.get("/api/device/rules")).json.earlyUnlock).toEqual({ enabled: true, price: 1000, currency: "DKK" });
    // Never for a change to the key itself.
    const keyChange = await me.put(`/api/phones/${phoneId}/key`, delayKey(false));
    expect((await me.get(`/api/changes/${keyChange.json.change.id}/early-unlock`)).status).toBe(404);
  });

  it("never on a child phone", async () => {
    enableBilling(h);
    const parent = await signIn(h, "parent@example.org");
    const { phoneId, device } = await pairPhone(h, parent, { name: "Child" });
    // Child phones apply changes at once; a pending row is forced here to prove the guard.
    const [change] = await h.ctx.db.insert(pendingChanges).values({
      phoneId, op: { type: "app.set", packageName: "x.y", allowed: true }, keyType: "delay",
      effectiveAt: new Date(h.clock.now.getTime() + 24 * 3_600_000),
    }).returning();
    expect((await parent.get(`/api/changes/${change!.id}/early-unlock`)).status).toBe(404);
    expect((await parent.post(`/api/changes/${change!.id}/early-unlock`, { consent: true })).status).toBe(409);
    expect((await device.get("/api/device/early-unlocks")).json.offers).toEqual([]);
  });

  for (const [label, email] of [["has accepted", "buddy@example.org"], ["has not accepted yet", "not-yet@example.org"]] as const) {
    it(`never when a buddy (trusted person) holds the key, also when the buddy ${label}`, async () => {
      enableBilling(h);
      const { me, phoneId, device } = await myself();
      await signIn(h, "buddy@example.org");
      await me.put(`/api/phones/${phoneId}/key`, { ...delayKey(true), keyType: "trusted", trustedEmail: email });
      h.clock.advance(24 * 3_600_000 + 1000);
      await device.get("/api/device/rules");
      expect((await me.get(`/api/phones/${phoneId}/key`)).json).toMatchObject({ keyType: "trusted", payUnlockEnabled: true });
      // Until a buddy accepts, changes fall back to the delay: still the buddy's key, no paid shortcut.
      const r = await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true });
      expect(r.json.status).toBe("pending");
      expect((await me.get(`/api/changes/${r.json.change.id}/early-unlock`)).status).toBe(404);
      expect((await me.post(`/api/changes/${r.json.change.id}/early-unlock`, { consent: true })).status).toBe(409);
      expect((await device.get("/api/device/rules")).json).not.toHaveProperty("earlyUnlock");
    });
  }

  it("needs the express consent, never ticked in advance", async () => {
    enableBilling(h);
    const { me, phoneId } = await myself();
    const cid = await loosen(me, phoneId);
    expect((await me.post(`/api/changes/${cid}/early-unlock`, {})).status).toBe(400);
    expect((await me.post(`/api/changes/${cid}/early-unlock`, { consent: false })).status).toBe(400);
  });
});

describe("buying and delivering", () => {
  it("applies the change about ten minutes after payment, once, with a receipt", async () => {
    const { stripe } = enableBilling(h);
    const { me, phoneId, device } = await myself();
    const cid = await loosen(me, phoneId);
    h.mail.outbox.length = 0;
    const first = await me.post(`/api/changes/${cid}/early-unlock`, { consent: true });
    // A double click returns the same checkout instead of a second payment.
    const again = await me.post(`/api/changes/${cid}/early-unlock`, { consent: true });
    expect(again.json.purchase.id).toBe(first.json.purchase.id);
    expect(again.json.checkoutUrl).toBe(first.json.checkoutUrl);
    expect(stripe.sessions).toHaveLength(1);
    const params = JSON.stringify(stripe.sessions[0]!.params).toLowerCase();
    expect(params).not.toMatch(/charit|donat|velgør|indsamling/);

    const { purchaseId, event } = await pay(cid, me);
    const change = (await me.get(`/api/phones/${phoneId}/changes`)).json.changes[0];
    expect(new Date(change.effectiveAt).getTime() - h.clock.now.getTime()).toBe(10 * MIN);
    expect(change.earlyUnlock).toMatchObject({ available: false, reason: "inProgress", purchase: { status: "scheduled", canWithdraw: true } });
    expect(h.mail.outbox.at(-1)!.subject).toBe("Receipt: early unlock");
    expect(h.mail.outbox.at(-1)!.text).toContain(purchaseId);

    // Stripe retries the same event: nothing changes, no second receipt.
    const before = h.mail.outbox.length;
    const repeat = await h.app.request("/api/billing/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": (await import("../src/providers/stripe.js")).signStripePayload(JSON.stringify(event), "whsec_test_0123456789abcdef0123456789abcdef", h.clock.now) },
      body: JSON.stringify(event),
    });
    expect(repeat.status).toBe(200);
    expect(h.mail.outbox.length).toBe(before);

    h.clock.advance(10 * MIN);
    expect((await device.get("/api/device/rules")).json.apps.allowed).toContain("com.instagram.android");
    await sweep(h.ctx);
    expect((await unlockRow(purchaseId)).status).toBe("delivered");
    // After delivery the right of withdrawal has ended.
    expect((await me.post(`/api/early-unlocks/${purchaseId}/withdraw`, { confirm: true })).status).toBe(409);
    expect(stripe.refunds).toEqual([]);
  });

  it("allows one purchase per rolling seven days", async () => {
    enableBilling(h);
    const { me, phoneId } = await myself();
    await pay(await loosen(me, phoneId), me);
    h.clock.advance(11 * MIN);
    await sweep(h.ctx);
    const next = await loosen(me, phoneId, "com.spotify.music");
    const offer = (await me.get(`/api/changes/${next}/early-unlock`)).json;
    expect(offer).toMatchObject({ available: false, reason: "weeklyCap" });
    expect((await me.post(`/api/changes/${next}/early-unlock`, { consent: true })).status).toBe(409);
    h.clock.advance(7 * 86_400_000 - 11 * MIN);
    const third = await loosen(me, phoneId, "org.example.news");
    expect((await me.get(`/api/changes/${third}/early-unlock`)).json.available).toBe(true);
  });

  it("refunds a second payment that slipped past the cap", async () => {
    const { stripe } = enableBilling(h);
    const { me, phoneId } = await myself();
    const a = await loosen(me, phoneId);
    const b = await loosen(me, phoneId, "com.spotify.music");
    // Both checkouts were opened before either was paid.
    const startB = await me.post(`/api/changes/${b}/early-unlock`, { consent: true });
    await pay(a, me);
    const [rowB] = await h.ctx.db.select().from(earlyUnlocks).where(eq(earlyUnlocks.id, startB.json.purchase.id));
    await stripeWebhook(h, "checkout.session.completed", {
      id: rowB!.providerRef, payment_status: "paid", payment_intent: "pi_second", metadata: { kind: "early_unlock", early_unlock_id: rowB!.id },
    });
    expect(await unlockRow(rowB!.id)).toMatchObject({ status: "refunded", refundReason: "duplicate" });
    expect(stripe.refunds.map((r) => r.paymentIntent)).toEqual(["pi_second"]);
  });

  it("refunds a second Play payment for an already paid unlock in its own record", async () => {
    const { play } = enableBilling(h);
    const { me, phoneId, device } = await myself();
    const cid = await loosen(me, phoneId);
    const hid = (await me.get("/api/me")).json.households[0].id;
    const start = await device.post("/api/device/early-unlocks", { changeId: cid, consent: true });
    const id = start.json.purchase.id as string;
    // Two purchase flows for the same open offer, and both were paid.
    for (const [token, orderId] of [["tok-first-0001", "GPA.1"], ["tok-second-001", "GPA.2"]] as const) {
      play.products.set(token, { purchaseState: 0, consumed: false, acknowledged: false, orderId, accountId: hid, profileId: id });
      expect((await device.post("/api/device/billing/play", { kind: "earlyUnlock", productId: "early_unlock", purchaseToken: token })).status).toBe(200);
    }
    // The paid, scheduled unlock keeps its own payment and its withdrawal right.
    expect(await unlockRow(id)).toMatchObject({ status: "scheduled", paymentRef: "tok-first-0001", providerRef: "GPA.1" });
    const extra = await h.ctx.db.select().from(earlyUnlocks).where(eq(earlyUnlocks.paymentRef, "tok-second-001"));
    expect(extra).toHaveLength(1);
    expect(extra[0]).toMatchObject({ status: "refunded", refundReason: "duplicate", providerRef: "GPA.2", pendingChangeId: null });
    expect(play.refunded).toEqual(["GPA.2"]);
    // The same second payment reported again refunds nothing more.
    await playRtdn(h, { oneTimeProductNotification: { version: "1.0", notificationType: 1, purchaseToken: "tok-second-001", sku: "early_unlock" } });
    expect(play.refunded).toEqual(["GPA.2"]);
    const change = (await me.get(`/api/phones/${phoneId}/changes`)).json.changes[0];
    expect(change.earlyUnlock.purchase).toMatchObject({ id, status: "scheduled", canWithdraw: true });
  });

  it("refunds an unlock that cannot be delivered, and retries a failed refund", async () => {
    const { stripe } = enableBilling(h);
    const { me, phoneId } = await myself();
    const cid = await loosen(me, phoneId);
    const { purchaseId } = await pay(cid, me);
    stripe.failRefunds = true;
    expect((await me.post(`/api/changes/${cid}/cancel`)).status).toBe(204);
    await sweep(h.ctx);
    expect((await unlockRow(purchaseId)).status).toBe("refund_due");
    stripe.failRefunds = false;
    await sweep(h.ctx);
    await sweep(h.ctx);
    expect(await unlockRow(purchaseId)).toMatchObject({ status: "refunded", refundReason: "undeliverable" });
    // One refund, with an idempotency key, never two.
    expect(stripe.refunds).toEqual([{ paymentIntent: `pi_${purchaseId.slice(0, 8)}`, key: `refund-${purchaseId}` }]);
  });
});

describe("withdrawal (Fortryd aftale)", () => {
  it("restores the wait, refunds in full and sends a durable receipt", async () => {
    const { stripe } = enableBilling(h);
    const { me, phoneId, device } = await myself();
    const cid = await loosen(me, phoneId);
    const original = (await me.get(`/api/phones/${phoneId}/changes`)).json.changes[0].effectiveAt;
    const { purchaseId } = await pay(cid, me);
    h.clock.advance(3 * MIN);
    expect((await me.post(`/api/early-unlocks/${purchaseId}/withdraw`, {})).status).toBe(400);
    const w = await me.post(`/api/early-unlocks/${purchaseId}/withdraw`, { confirm: true, name: "Test Person" });
    expect(w.status).toBe(200);
    expect(w.json).toMatchObject({ status: "refunded", canWithdraw: false });
    expect((await me.get(`/api/phones/${phoneId}/changes`)).json.changes[0].effectiveAt).toBe(original);
    expect(stripe.refunds).toHaveLength(1);
    const receipt = h.mail.outbox.at(-1)!;
    expect(receipt.subject).toBe("Receipt: withdrawal");
    expect(receipt.text).toContain(purchaseId);
    expect(receipt.text).toContain("Test Person");
    // The change does not apply early.
    h.clock.advance(20 * MIN);
    expect((await device.get("/api/device/rules")).json.apps.allowed).not.toContain("com.instagram.android");
    // A repeated withdrawal changes nothing and refunds nothing more.
    await me.post(`/api/early-unlocks/${purchaseId}/withdraw`, { confirm: true });
    expect(stripe.refunds).toHaveLength(1);
    const stranger = await signIn(h, "stranger@example.org");
    expect((await stranger.get(`/api/early-unlocks/${purchaseId}`)).status).toBe(404);
  });

  it("ends once the phone has applied the change, even before the sweeper runs", async () => {
    const { stripe } = enableBilling(h);
    const { me, phoneId, device } = await myself();
    const cid = await loosen(me, phoneId);
    const { purchaseId } = await pay(cid, me);
    h.clock.advance(10 * MIN);
    expect((await device.get("/api/device/rules")).json.apps.allowed).toContain("com.instagram.android");
    expect((await unlockRow(purchaseId)).status).toBe("scheduled");
    const w = await me.post(`/api/early-unlocks/${purchaseId}/withdraw`, { confirm: true });
    expect(w.status).toBe(409);
    expect(await unlockRow(purchaseId)).toMatchObject({ status: "delivered", withdrawnAt: null });
    expect(stripe.refunds).toEqual([]);
  });

  it("closes an unpaid checkout without a withdrawal receipt", async () => {
    enableBilling(h);
    const { me, phoneId } = await myself();
    const cid = await loosen(me, phoneId);
    const start = await me.post(`/api/changes/${cid}/early-unlock`, { consent: true });
    h.mail.outbox.length = 0;
    const w = await me.post(`/api/early-unlocks/${start.json.purchase.id}/withdraw`, { confirm: true });
    expect(w.status).toBe(200);
    expect(w.json.status).toBe("expired");
    expect(h.mail.outbox).toEqual([]);
  });
});

describe("Play builds", () => {
  it("buy through Google Play only, and the server checks the purchase at Google", async () => {
    const { play, stripe } = enableBilling(h);
    const { me, phoneId, device } = await myself();
    const cid = await loosen(me, phoneId);
    const offers = await device.get("/api/device/early-unlocks");
    expect(offers.json.offers).toHaveLength(1);
    // A phone cannot ask for a card checkout: extra fields are ignored and the channel is Play.
    const start = await device.post("/api/device/early-unlocks", { changeId: cid, consent: true, channel: "stripe" });
    expect(start.status).toBe(201);
    expect(start.json).toMatchObject({ productId: "early_unlock", purchase: { channel: "play" } });
    expect(start.json).not.toHaveProperty("checkoutUrl");
    expect(stripe.sessions).toHaveLength(0);
    const hid = (await me.get("/api/me")).json.households[0].id;
    expect(start.json.accountId).toBe(hid);

    play.products.set("tok-unlock-0001", {
      purchaseState: 0, consumed: false, acknowledged: false, orderId: "GPA.1234", accountId: hid, profileId: start.json.purchase.id,
    });
    const report = await device.post("/api/device/billing/play", { kind: "earlyUnlock", productId: "early_unlock", purchaseToken: "tok-unlock-0001" });
    expect(report.status).toBe(200);
    expect(report.json.status).toBe("scheduled");
    expect(play.consumed).toEqual(["tok-unlock-0001"]);
    // The real-time notification for the same purchase changes nothing.
    await playRtdn(h, { oneTimeProductNotification: { version: "1.0", notificationType: 1, purchaseToken: "tok-unlock-0001", sku: "early_unlock" } });
    expect((await unlockRow(start.json.purchase.id)).status).toBe("scheduled");

    // Withdrawal from the phone refunds the Play order.
    const w = await device.post(`/api/device/early-unlocks/${start.json.purchase.id}/withdraw`, { confirm: true });
    expect(w.json.status).toBe("refunded");
    expect(play.refunded).toEqual(["GPA.1234"]);
  });

  it("refuses a purchase token for someone else's unlock", async () => {
    const { play } = enableBilling(h);
    const { me, phoneId, device } = await myself();
    await loosen(me, phoneId);
    play.products.set("tok-foreign-01", {
      purchaseState: 0, consumed: false, acknowledged: false, orderId: "GPA.9", accountId: "7d7d7d7d-0000-4000-8000-000000000000",
      profileId: "7d7d7d7d-0000-4000-8000-000000000001",
    });
    expect((await device.post("/api/device/billing/play", { kind: "earlyUnlock", productId: "early_unlock", purchaseToken: "tok-foreign-01" })).status).toBe(409);
    await h.ctx.db.delete(phoneApps);
  });
});
