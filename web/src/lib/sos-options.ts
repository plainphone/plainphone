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
}

/** What the server answers for a phone that never saved a choice. An older server sends no settings at all. */
export const DEFAULT_SOS_SETTINGS: SosSettings = {
  hiddenPower: false,
  hiddenPresses: 4,
  hiddenClock: false,
  hiddenFeedback: "vibrate",
  quickMessagesEnabled: true,
  quickSuggestionsEnabled: true,
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

export type SosTrigger = "power" | "clock" | "code" | null | undefined;

/** The label and its placeholder values for how an SOS was sent, or null for the SOS screen. */
export function triggerLabel(trigger: SosTrigger, message?: string | null): { key: MessageKey; values?: Record<string, string> } | null {
  if (trigger === "power") return { key: "sos.triggerPower" };
  if (trigger === "clock") return { key: "sos.triggerClock" };
  if (trigger === "code") return { key: "sos.triggerCode", values: { text: message ?? "" } };
  return null;
}
