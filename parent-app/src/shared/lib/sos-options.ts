// SPDX-License-Identifier: Apache-2.0
//
// Hidden SOS and quick messages (docs/sos.md): the per-phone switches, the quick-message list
// and the labels for how a hidden SOS was sent. Platform-free, shared with the parent app.
import type { MessageKey } from "../i18n/en";

export interface SosSettings {
  hiddenPower: boolean;
  hiddenPresses: 3 | 4 | 5 | 6;
  hiddenClock: boolean;
  hiddenFeedback: "vibrate" | "none";
  quickMessagesEnabled: boolean;
  quickSuggestionsEnabled: boolean;
  /** The family inbox and its check-in (docs/family-inbox.md). */
  familyInbox: boolean;
  checkIns: boolean;
  /** The child may ask a parent to call back; true only with a confirmed number (docs/sos.md). */
  callbackRequests: boolean;
  callbackConfirmed: boolean;
}

/** What the server answers for a phone that never saved a choice. An older server sends no settings at all. */
export const DEFAULT_SOS_SETTINGS: SosSettings = {
  hiddenPower: false,
  hiddenPresses: 4,
  hiddenClock: false,
  hiddenFeedback: "vibrate",
  quickMessagesEnabled: false,
  quickSuggestionsEnabled: true,
  familyInbox: false,
  checkIns: false,
  callbackRequests: false,
  callbackConfirmed: false,
};

export const PRESS_CHOICES = [3, 4, 5, 6] as const;
export const MAX_QUICK_MESSAGES = 6;
export const QUICK_MESSAGE_LENGTH = 60;

export interface QuickMessage {
  id: string;
  text: string;
  meansSos: boolean;
  createdAt: string;
}
export interface QuickSuggestion {
  id: string;
  text: string;
  createdAt: string;
}
export interface QuickMessages {
  messages: QuickMessage[];
  suggestions: QuickSuggestion[];
}

/** The three one-tap starters shown while the list is empty. */
export const STARTER_MESSAGES: readonly MessageKey[] = ["qm.pick1", "qm.pick2", "qm.pick3"];

/** "Call me" is the callback request while that is on, so it is not offered as a second, text-only action. */
export const starterMessages = (settings: Pick<SosSettings, "callbackRequests">): readonly MessageKey[] =>
  settings.callbackRequests ? STARTER_MESSAGES.filter((key) => key !== "qm.pick3") : STARTER_MESSAGES;

export type SosTrigger = "power" | "clock" | "code" | null | undefined;

/** The label and its placeholder values for how an SOS was sent, or null for the SOS screen. */
export function triggerLabel(trigger: SosTrigger, message?: string | null): { key: MessageKey; values?: Record<string, string> } | null {
  if (trigger === "power") return { key: "sos.triggerPower" };
  if (trigger === "clock") return { key: "sos.triggerClock" };
  if (trigger === "code") return { key: "sos.triggerCode", values: { text: message ?? "" } };
  return null;
}

// --- The family inbox (docs/family-inbox.md) ---------------------------------------

/** A parent's reply is as short as a quick message. */
export const REPLY_LENGTH = 60;

export interface FamilyMessage {
  id: string;
  from: "child" | "parent";
  kind: "quick" | "checkin" | "reply";
  text: string;
  sentAt: string;
  /** Child messages: parent devices that got a push; 0 means the phone sent an SMS. */
  delivered?: number | null;
  /** Parent replies: the name the parent signed with, and when the phone got it. */
  author?: string | null;
  receivedAt?: string | null;
}

export interface FamilyInboxThread {
  familyInbox: boolean;
  quickMessages: boolean;
  checkIns: boolean;
  recipients: string[];
  messages: FamilyMessage[];
}

/** Where a message is, as a parent sees it: a key, and the time for "On the phone {time}". */
export function familyState(m: FamilyMessage): { key: MessageKey; at?: string } {
  if (m.from === "parent") return m.receivedAt ? { key: "inbox.received", at: m.receivedAt } : { key: "inbox.waiting" };
  if (m.delivered === 0) return { key: "inbox.sms" };
  return { key: m.delivered ? "inbox.delivered" : "inbox.sent" };
}

// --- Asking a parent to call (docs/sos.md#asking-a-parent-to-call) ---------------------

export type CallbackState = "queued" | "sent" | "expired" | "done";

export interface CallbackRequest {
  id: string;
  state: CallbackState;
  createdAt: string;
  expiresAt: string;
  doneAt: string | null;
  doneVia: "number" | "other" | null;
  /** The saved number now: fine to dial, cleared since, or changed since the request was made. */
  number: "ok" | "missing" | "changed";
}

export interface CallbackList {
  callbackNumber: string | null;
  requests: CallbackRequest[];
}

/** Open requests need an answer; the rest is history. */
export const isOpenCallback = (r: CallbackRequest) => r.state === "queued" || r.state === "sent";

/** One line for where a request is. */
export function callbackStateKey(r: CallbackRequest): MessageKey {
  if (r.state === "done") return r.doneVia === "number" ? "cb.doneNumber" : r.doneVia === "other" ? "cb.doneOther" : "cb.done";
  return r.state === "expired" ? "cb.expired" : r.state === "sent" ? "cb.sent" : "cb.queued";
}

/** What a failed answer means: the server's reason is "expired", "changed" or "missing". */
export function callbackRefusalKey(reason: string): MessageKey {
  return reason === "expired" ? "cb.expiredNow" : reason === "missing" ? "cb.missing" : "cb.changedNow";
}
