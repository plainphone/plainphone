// SPDX-License-Identifier: Apache-2.0
//
// The hosted plan and paid early unlock (docs/billing.md), shared by the dashboard and the parent
// app. Pure helpers only: no React, no requests. Nothing here is shown while `billing` is false.

import type { MessageKey } from "../i18n/translate";
import type { Locale } from "./api";
import { formatDateTime, intlLocale } from "./format";

export type PlanName = "unlimited" | "grandfathered" | "free" | "plus";

/** `GET /households/{hid}/plan`. Always answers; with billing off it is `billing: false`, `plan: "unlimited"`. */
export interface Plan {
  billing: boolean;
  plan: PlanName;
  source: "play" | "stripe" | "manual" | null;
  until: string | null;
  /** Null means no limit. */
  limits: { phones: number | null; trusted: number | null };
  usage: { phones: number; trusted: number };
  prioritySupport: boolean;
  /** Minor units including VAT. */
  prices: { currency: string; plus: number; earlyUnlock: number };
  channels: { stripe: boolean; play: boolean };
  canManage: boolean;
}

export type EarlyUnlockStatus = "created" | "scheduled" | "delivered" | "refund_due" | "refunded" | "expired";

export interface EarlyUnlockPurchase {
  /** The contract number on the receipt. */
  id: string;
  status: EarlyUnlockStatus;
  channel: "stripe" | "play";
  amount: number;
  currency: string;
  consentAt: string;
  paidAt: string | null;
  unlockAt: string | null;
  deliveredAt: string | null;
  withdrawnAt: string | null;
  refundedAt: string | null;
  /** Show the withdrawal control while true. */
  canWithdraw: boolean;
}

/** `earlyUnlock` on a pending change. Absent: show nothing at all. */
export interface EarlyUnlockOffer {
  available: boolean;
  reason: "savesNoTime" | "weeklyCap" | "inProgress" | null;
  price: number;
  currency: string;
  unlockMinutes: number;
  nextAvailableAt: string | null;
  purchase: EarlyUnlockPurchase | null;
}

export interface PlanLimit {
  error: "plan_limit";
  limit: "phones" | "trusted";
  max: number;
}

/** The body of a 402 answer when adding beyond the free plan, or null for anything else. */
export function planLimitOf(status: number, data: unknown): PlanLimit | null {
  if (status !== 402 || !data || typeof data !== "object") return null;
  const d = data as Partial<PlanLimit>;
  if (d.error !== "plan_limit" || (d.limit !== "phones" && d.limit !== "trusted")) return null;
  return { error: "plan_limit", limit: d.limit, max: typeof d.max === "number" ? d.max : 1 };
}

export function planLimitKey(limit: PlanLimit): MessageKey {
  return limit.limit === "phones" ? "plan.limitPhones" : "plan.limitTrusted";
}

/** A price with VAT, exact: whole amounts without decimals, anything else with two. */
export function formatPrice(minor: number, currency: string, locale: Locale): string {
  const digits = minor % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 100);
}

/** One line about the current plan. Null while billing is off. */
export function planNowKey(plan: Plan): MessageKey | null {
  if (!plan.billing) return null;
  if (plan.plan === "free") return "plan.now.free";
  if (plan.plan === "plus") return "plan.now.plus";
  return "plan.now.grandfathered";
}

/** "2 of 5", or "2, no limit". */
export function usageText(used: number, max: number | null, t: (k: MessageKey, p?: Record<string, string | number>) => string) {
  return max === null ? t("plan.usage.noLimit", { used }) : t("plan.usage.of", { used, max });
}

/** What to say about a purchase, or null when there is nothing to say. */
export function purchaseLine(p: EarlyUnlockPurchase, locale: Locale): { key: MessageKey; params?: Record<string, string> } | null {
  switch (p.status) {
    case "created":
      return { key: "early.waitingPayment" };
    case "scheduled":
      return p.unlockAt ? { key: "early.scheduled", params: { time: formatDateTime(p.unlockAt, locale) } } : { key: "early.waitingPayment" };
    case "delivered":
      return { key: "early.delivered" };
    case "refund_due":
      return { key: "early.refundDue" };
    case "refunded":
      return { key: "early.refunded" };
    case "expired":
      return { key: "early.expired" };
    default:
      return null;
  }
}
