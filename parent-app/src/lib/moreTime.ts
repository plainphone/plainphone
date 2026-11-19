// SPDX-License-Identifier: Apache-2.0
//
// Answering a request for more time: the API call, and the check of what a push payload
// asks for. Used by the request list and by the answer buttons on the notification.
import { client, unwrap } from "../api/client";
import { MORE_TIME_ANSWERS, type MoreTimeAnswer, type MoreTimeAnswerResult } from "../shared/lib/more-time";

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

/** Idempotent on the server: a later answer changes nothing and comes back with `won: false`. */
export function answerMoreTime(pid: string, rid: string, answer: MoreTimeAnswer): Promise<MoreTimeAnswerResult> {
  return unwrap<MoreTimeAnswerResult>(client.POST("/phones/{pid}/more-time-requests/{rid}/answer", {
    params: { path: { pid, rid } },
    body: { answer },
  }));
}
