// SPDX-License-Identifier: Apache-2.0
//
// Requests for more time, as the dashboard shows them. Pure helpers, so the copy rules are testable.
import type { MessageKey } from "@plainphone/i18n/en";

export type MoreTimeAnswer = "15" | "60" | "day" | "no";

export const MORE_TIME_ANSWERS: readonly MoreTimeAnswer[] = ["15", "60", "day", "no"];

export interface MoreTimeRequest {
  id: string;
  phoneId: string;
  /** "*" is the daily cap. */
  packageName: string;
  /** Null for the daily cap. */
  appLabel: string | null;
  reason: string | null;
  day: string;
  status: "pending" | "approved" | "declined" | "expired";
  answer: MoreTimeAnswer | null;
  grantedMinutes: number | null;
  createdAt: string;
  decidedAt: string | null;
  /** Null while open, expired, or from an older server. */
  answeredByYou: boolean | null;
  /** "phone" when a parent approved it on the phone with the parent PIN. */
  decidedVia?: "parent" | "phone" | null;
}

/** The answer call returns the decided request; `won: false` means someone else (or an earlier tap) decided first. */
export type MoreTimeAnswerResult = MoreTimeRequest & { won: boolean };

export const ANSWER_KEY: Record<MoreTimeAnswer, MessageKey> = {
  "15": "moreTime.a15",
  "60": "moreTime.a60",
  day: "moreTime.aDay",
  no: "moreTime.aNo",
};

/** What happened to a request, as a message key plus its placeholders. Null while it is open. */
export function resultOf(r: MoreTimeRequest): { key: MessageKey; minutes?: number } | null {
  if (r.status === "pending") return null;
  if (r.status === "expired") return { key: "moreTime.resultExpired" };
  if (r.status === "declined") return { key: "moreTime.resultDeclined" };
  if (r.answer === "day") return { key: "moreTime.resultDay" };
  return { key: "moreTime.resultApproved", minutes: r.grantedMinutes ?? Number(r.answer ?? 0) };
}

/** Who answered. Expired and open requests were answered by nobody. */
export function byKey(r: MoreTimeRequest): MessageKey | null {
  if (r.status === "pending" || r.status === "expired") return null;
  if (r.decidedVia === "phone") return "requests.tagOnPhone";
  if (r.answeredByYou === null) return null;
  return r.answeredByYou ? "moreTime.byYou" : "moreTime.byOther";
}

/** Replace a request by id with its newer state, keeping the order. */
export function merge(list: MoreTimeRequest[], next: MoreTimeRequest): MoreTimeRequest[] {
  return list.map((r) => (r.id === next.id ? { ...r, ...next } : r));
}
