// SPDX-License-Identifier: Apache-2.0
import type { Mail } from "../providers/mail.js";
import type { Suggestion } from "./age-presets.js";
import type { Locale } from "./locale.js";
import { build } from "./mail-templates.js";
import { reviewWords, suggestionText } from "./review-words.js";

/** The calm "review the rules" mail (docs/age-presets.md): a few ideas and a button to the phone's page. */
export function reviewReminderMail(
  to: string,
  locale: Locale,
  publicUrl: string,
  phone: { id: string; name: string },
  suggestions: Suggestion[],
): Mail {
  const w = reviewWords(locale);
  return build(to, w.subject(phone.name), {
    publicUrl,
    locale,
    preheader: w.preheader,
    heading: w.heading(phone.name),
    paragraphs: [w.intro],
    sections: [{ title: w.ideas, lines: suggestions.map((s) => suggestionText(s, locale)) }],
    button: { label: w.button, url: `${publicUrl.replace(/\/+$/, "")}/phones/${encodeURIComponent(phone.id)}` },
    afterButton: w.after,
    footer: w.footer,
  });
}
