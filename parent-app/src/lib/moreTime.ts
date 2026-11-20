// SPDX-License-Identifier: Apache-2.0
//
// Answering a request for more time: the API call, and the check of what a push payload
// asks for. Used by the request list and by the answer buttons on the notification.
import { client, unwrap } from "../api/client";
import type { TFn } from "../i18n/I18n";
import { MORE_TIME_ANSWERS, type MoreTimeAnswer, type MoreTimeAnswerResult, resultOf } from "../shared/lib/more-time";

const ID = /^[0-9a-f-]{36}$/i;

export function isMoreTimeAnswer(value: unknown): value is MoreTimeAnswer {
  return typeof value === "string" && (MORE_TIME_ANSWERS as readonly string[]).includes(value);
}

/** The phone and request a "more-time" push is about. Null for anything else or a malformed id. */
export function moreTimeTarget(data: unknown): { phoneId: string; requestId: string } | null {
  const d = (data ?? {}) as { type?: unknown; phoneId?: unknown; requestId?: unknown };
  if (d.type !== "more-time") return null;
  if (typeof d.phoneId !== "string" || !ID.test(d.phoneId)) return null;
  if (typeof d.requestId !== "string" || !ID.test(d.requestId)) return null;
  return { phoneId: d.phoneId, requestId: d.requestId };
}

/**
 * Idempotent on the server: a later answer changes nothing and comes back with `won: false`.
 * `fromNotification` tells the server to send a follow-up when the phone has applied the answer.
 */
export function answerMoreTime(pid: string, rid: string, answer: MoreTimeAnswer, fromNotification = false): Promise<MoreTimeAnswerResult> {
  return unwrap<MoreTimeAnswerResult>(client.POST("/phones/{pid}/more-time-requests/{rid}/answer", {
    params: { path: { pid, rid } },
    body: { answer, ...(fromNotification ? { source: "notification" as const } : {}) },
  }));
}

/** The notification tag of a request: the buttons, this follow-up and the server's receipt share it, so each replaces the one before. */
export const moreTimeTag = (requestId: string) => `moretime-${requestId.replaceAll("-", "")}`;

/**
 * What to tell the parent after tapping a button, from the decided request. First answer wins: when someone
 * else was first their answer is shown, not an error. `failed` means the parent has something to do (an expired request).
 * `confirms` is false when the phone sends no receipts, so nothing is promised.
 */
export function followUp(result: MoreTimeAnswerResult, t: TFn, confirms: boolean): { text: string; failed: boolean } {
  if (result.status === "expired") return { text: t("moreTime.pushExpired"), failed: true };
  const done = resultOf(result);
  if (!done || (result.status !== "approved" && result.status !== "declined")) return { text: t("moreTime.pushFailed"), failed: true };
  const line = t(done.key, { minutes: done.minutes ?? 0 });
  if (!result.won && !result.answeredByYou) return { text: `${t("moreTime.pushOther")}: ${line}`, failed: false };
  // A decline changes nothing on the phone, so there is nothing for it to confirm.
  return { text: result.status === "approved" && confirms ? `${line}. ${t("moreTime.pushWait")}` : line, failed: false };
}
