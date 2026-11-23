# Billing (behind a flag)

Plainphone, its source code and the Android app stay free under Apache-2.0. The hosted service at
app.plainphone.org may later charge a paid plan per household (#97), and Myself phones may later
offer a paid early unlock (#103). **Both are switched off.** `BILLING_ENABLED` defaults to `false`,
and while it is off:

- every household reports the `unlimited` plan and nothing is limited,
- no billing UI is shown in the dashboard, the parent app or on the phone,
- every billing route answers 404, and no payment provider is built or called,
- the rules a phone receives are byte for byte what they were before.

Self-hosted servers keep it off. Nothing here needs a payment provider to run Plainphone.

The decisions behind it are in [research/monetization.md](research/monetization.md) and
[research/buy-free.md](research/buy-free.md). Prices are configuration (see below), not copy.

## What a paywall never touches

A paid plan only ever limits **adding** a phone or a trusted person. These are never gated, also on
the free plan, also over its limit, also when a paid plan lapses (the list is `NEVER_GATED` in
[`server/src/services/billing.ts`](../server/src/services/billing.ts), and
[`server/test/billing-exempt.test.ts`](../server/test/billing-exempt.test.ts) calls each of them
with billing on and the free plan exceeded):

- rules sync and locking, release and removal of a phone,
- SOS, rings, check-ins, 112, emergency numbers and the help lines,
- emergency openings on Myself phones,
- pending changes (cancel, approve, reject) and the delay key itself,
- edits to the rules of existing phones,
- moving a phone to another server or receiving one,
- household members (the parents' reachability and access),
- account and data deletion.

Existing phones are never switched off, locked or hidden because of a plan.

## The household plan (#97)

| Plan | When | Limits |
|---|---|---|
| `unlimited` | `BILLING_ENABLED` is off | none |
| `grandfathered` | the household was created before `BILLING_GRANDFATHER_BEFORE` | none, for good |
| `free` | otherwise | `BILLING_FREE_PHONES` phones (1), `BILLING_FREE_TRUSTED` trusted people (1) |
| `plus` | a paid subscription or a manual grant is active | none, plus priority support |

The household row holds `plan` (`free` or `plus`), `plan_source` (`play`, `stripe` or `manual`) and
`plan_until`. One function answers "is this allowed": `isAllowed()` in `services/billing.ts`. It is
called when a phone is claimed or enrolled, when a trusted person is set on a key and when a helper
invitation is made; it answers `402 {error: "plan_limit", limit, max}` when the free plan is full.
Someone who already helps on one phone of the household can help on another at no extra cost.

**Longer history is not built.** Histories are 30 days for every household today
([account-deletion.md](account-deletion.md)); the paid plan does not change that yet.

A manual grant (`plan = 'plus', plan_source = 'manual'`, `plan_until` null or a date) is set by hand
in the database and is never changed by a provider event.

### Paying

- **Web dashboard (sideloaded phones):** Stripe Checkout on the plan page (`/plan`), through
  Mahoje's Stripe account. The Stripe customer portal handles changes and cancellation.
- **Play installs:** a Google Play subscription, bought in the Play build of the phone app
  (the `play` flavor, see [ci-build.md](ci-build.md)). The purchase carries the household id
  as `obfuscatedAccountId`.
- **The parent app** (App Store and Google Play) shows the plan read-only. It never shows a price
  to buy, a checkout, or a pointer to buying on the web (store rules). A test
  (`parent-app/__tests__/no-steering.test.ts`) fails if it does.

The plan is only ever taken from the provider: a Stripe webhook with a valid signature, or a Play
purchase looked up with the Google Play Developer API. The success page after checkout grants
nothing. Both webhooks are idempotent (`billing_events` keeps each event or Pub/Sub message id), and
an event older than the stored state is ignored. A cancelled subscription keeps the paid plan until
the end of the paid period. Deleting an account that is the only member of a paying household
cancels its subscription at the provider.

## Paid early unlock on Myself (#103)

On a **Myself** phone with its **own delay key**, a change that waits can be unlocked about ten
minutes after payment. It is never offered on a child phone, never when a trusted person (buddy)
holds the key, also while their invitation is pending, and never for a change to the key itself.

- **Switch per phone:** "Offer early unlock" on the key page (`payUnlockEnabled`). Off by default.
  Turning it on loosens the key, so it waits for the key like any other loosening. The rules carry
  `earlyUnlock` only while billing is on and the switch is on; the phone shows nothing without it.
- **Fixed price:** `BILLING_EARLY_UNLOCK_PRICE_MINOR` (working value 1000 = 10 kr. incl. VAT).
- **At most one paid unlock per phone in any 7 days.** A second payment that slips past the cap (two
  checkouts opened at once) is refunded.
- **Only when it saves time:** not offered when the change would apply within about 25 minutes.
- **Keep waiting is free and as prominent** as the pay button. No pressure copy, no repeat prompts,
  and no charity wording anywhere in the flow. A separate, unlinked
  [giving page](../site/content/giving.mjs) lists organisations to give to directly; Mahoje never
  handles that money and giving unlocks nothing.
- **Channels:** Stripe Checkout in the web dashboard; Google Play Billing in the Play build of the
  phone app. A phone cannot start a Stripe checkout, and the Play source set is checked for Stripe
  and checkout links by a unit test.

### Consent, withdrawal and refunds

Forbrugeraftaleloven § 18 (2) and § 20 a: before paying, the buyer sees the price incl. VAT, when
the unlock happens, the weekly cap and where the withdrawal control is, and ticks an **unticked**
consent box ("I ask for the early unlock to start now, before the 14-day withdrawal period ends. I
understand that I lose my right to withdraw once the early unlock has been delivered."). The API
refuses a purchase without `consent: true`.

While the unlock is scheduled, the waiting change shows **Withdraw from contract** (Fortryd aftale).
The confirm step shows the contract number (the purchase id), where the receipt goes and an
optional name field (written only into the receipt mail), then **Confirm withdrawal** (Bekræft
fortrydelse). Withdrawal restores the original wait and refunds the full amount. Both the purchase
and the withdrawal are confirmed by mail (a durable receipt with the consent text, the times and
the contract number). Withdrawal and reading the receipt keep working if billing is switched off
again. Once the phone has applied the change (also when it fetched its rules before the sweeper
marked the purchase delivered), the right of withdrawal has ended and a withdrawal is refused. A
checkout that was never paid is no contract: the offer shows again, and closing it sends no receipt.

A paid unlock that cannot be delivered (the change was cancelled or failed), that came in late,
or that was a duplicate is refunded. A second, different payment for a purchase that is already
paid (two purchase flows for the same offer) gets its own refund record, so the first payment's
record stays as it was. Refunds use an idempotency key (Stripe) or the order id
(Play), so a retry never refunds twice; a failed refund call stays `refund_due` and the sweeper
retries it. A checkout retry returns the same session, so a double click never charges twice.

| Status | Meaning |
|---|---|
| `created` | checkout started, not paid; expires after an hour |
| `scheduled` | paid; the change applies at `unlock_at` |
| `delivered` | the change applied; the right of withdrawal has ended |
| `refund_due` | withdrawn or undeliverable; refund pending |
| `refunded` | money returned |
| `expired` | never paid |

## What is stored

No card data, ever. Payments are handled by Stripe or Google Play.

- `households.plan`, `plan_source`, `plan_until`.
- `billing_subscriptions`: provider, the provider's subscription id (Stripe) or purchase token
  (Play), the Stripe customer id, product, status, end of the paid period. Deleted with the
  household.
- `billing_events`: provider event ids and their type, for idempotency. No payload.
- `early_unlocks`: channel, amount, currency, status, the provider's checkout/order id and payment
  reference, and the times of consent, payment, unlock, delivery, withdrawal and refund. It is the
  purchase record for bookkeeping, so it is kept when the phone, household or account is deleted;
  the links to them become null. Nothing in it names a person.

The older `unlock_payments` table and `PAYMENTS_ENABLED` flag (D13, pay to unlock with a recipient)
are unused; the early unlock replaces them.

## Configuration

All values come from the environment; never commit them.

| Variable | Default | Meaning |
|---|---|---|
| `BILLING_ENABLED` | `false` | Master switch. Needs `BILLING_GRANDFATHER_BEFORE`; without it billing stays off and `/api/health` lists `billing: BILLING_ENABLED needs BILLING_GRANDFATHER_BEFORE` |
| `BILLING_GRANDFATHER_BEFORE` | | ISO time, e.g. `2027-03-01T00:00:00Z`. Households created before it keep everything free. An invalid value is dropped and reported, so billing stays off |
| `BILLING_FREE_PHONES` | `1` | Phones on the free plan. `HOUSEHOLD_PHONE_CAP` ([operations.md](operations.md#phones-per-household)) applies on top, to every plan |
| `BILLING_FREE_TRUSTED` | `1` | Trusted people (buddies) on the free plan |
| `BILLING_CURRENCY` | `DKK` | Currency of the prices below |
| `BILLING_PLUS_PRICE_MINOR` | `2900` | Shown price of the paid plan per household per month, in øre/cents |
| `BILLING_EARLY_UNLOCK_PRICE_MINOR` | `1000` | Price of an early unlock incl. VAT (Stripe charges this amount) |
| `STRIPE_SECRET_KEY` | | `sk_…` or a restricted `rk_…` key with Checkout, Refunds, Subscriptions and Billing portal access |
| `STRIPE_WEBHOOK_SECRET` | | `whsec_…` of the endpoint `<PUBLIC_URL>/api/billing/stripe/webhook` |
| `STRIPE_PRICE_PLUS` | | The recurring Price id (`price_…`) of the paid plan |
| `PLAY_PACKAGE_NAME` | `org.plainphone.app` | The Play app that sells |
| `PLAY_SERVICE_ACCOUNT_JSON` / `PLAY_SERVICE_ACCOUNT_FILE` | | A service account with access to the Google Play Developer API for that app |
| `PLAY_PRODUCT_PLUS` | `plus_household` | Subscription product id in Play Console |
| `PLAY_PRODUCT_EARLY_UNLOCK` | `early_unlock` | One-time (consumable) product id in Play Console |
| `PLAY_RTDN_TOKEN` | | At least 24 random characters (a shorter value is dropped and reported, and RTDN is refused). The Pub/Sub push endpoint is `<PUBLIC_URL>/api/billing/play/rtdn?token=<PLAY_RTDN_TOKEN>` |

Stripe webhook events to send: `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.expired`,
`customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`,
`customer.subscription.paused`, `customer.subscription.resumed`, `charge.refunded`.

## Before the flag goes on

These need a decision or a go from Mahoje, after the trial with 10 to 20 families:

1. Final prices, store prices and tax setup (Play handles EU VAT for Play sales; Stripe Tax or
   manual VAT for card sales).
2. The grandfathering cutoff, and whether grandfathered households keep everything for good.
3. Stripe account, products, webhook endpoint and customer portal settings; Play Console products,
   a service account, and the Pub/Sub topic for real-time notifications.
4. Counsel's check of the withdrawal flow and its wording, and who provides the withdrawal function
   for Play purchases.
5. Permission from each organisation on the giving page before it is linked and indexed.
6. Then set `BILLING_ENABLED=true` with the cutoff.
