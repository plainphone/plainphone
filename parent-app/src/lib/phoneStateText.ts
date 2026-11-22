// SPDX-License-Identifier: Apache-2.0
import type { Locale } from "../api/models";
import type { T } from "@plainphone/i18n/translate";
import { formatRelative } from "../shared/lib/format";
import { phoneState, type PhoneStateInput } from "../shared/lib/phone-state";

/** The one-line state and the sentence behind it, worded like the dashboard. */
export function phoneStateText(phone: PhoneStateInput, now: number, t: T, locale: Locale) {
  const s = phoneState(phone, now);
  const args = { when: s.at ? formatRelative(s.at, now, locale) : "" };
  return { state: s.state, title: t(s.title, args), hint: t(s.hint, args), attention: s.attention };
}
