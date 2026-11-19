// SPDX-License-Identifier: Apache-2.0
import type { Mail } from "../providers/mail.js";
import type { PhoneSummary, SummaryData } from "../services/weekly-summary.js";
import { build } from "./mail-templates.js";
import { summaryWords, type ChangeCategory, type SummaryLocale } from "./summary-text.js";

/** The short lines for one phone. Only what has something to say, so a quiet week is a short mail. */
export function phoneLines(p: PhoneSummary, locale: SummaryLocale): string[] {
  const w = summaryWords(locale);
  const duration = (minutes: number) => w.hours(Math.floor(minutes / 60), minutes % 60);
  const lines: string[] = [];
  lines.push(p.usage ? w.screen(duration(p.usage.averageMinutes)) : w.screenNone);
  if (p.usage && p.usage.topApps.length > 0) {
    lines.push(w.topApps(p.usage.topApps.map((a) => `${a.label} (${duration(a.minutes)})`).join(", ")));
  }
  const answered = p.requests.approved + p.requests.rejected;
  lines.push(p.requests.asked === 0 && answered === 0 ? w.requestsNone : w.requests(p.requests.asked, answered));
  if (p.changes.total === 0) lines.push(w.changesNone);
  else {
    const parts = (Object.entries(p.changes.byCategory) as [ChangeCategory, number][])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([c, n]) => `${w.categories[c]} ${n}`)
      .join(", ");
    lines.push(w.changes(p.changes.total, parts));
  }
  lines.push(p.events.protection > 0 ? w.protection(p.events.protection) : w.protectionNone);
  if (p.events.offline > 0) lines.push(w.offline(p.events.offline));
  if (p.events.checkin > 0) lines.push(w.checkins(p.events.checkin));
  return lines;
}

export function weeklySummaryMail(
  to: string,
  locale: SummaryLocale,
  publicUrl: string,
  summaryId: string,
  data: SummaryData,
): Mail {
  const w = summaryWords(locale);
  return build(to, w.subject, {
    publicUrl,
    locale,
    preheader: w.preheader,
    heading: w.heading,
    paragraphs: [data.phones.length === 0 ? w.noPhones : w.intro],
    sections: data.phones.map((p) => ({ title: p.name, lines: phoneLines(p, locale) })),
    button: { label: w.button, url: `${publicUrl.replace(/\/+$/, "")}/summary?week=${encodeURIComponent(summaryId)}` },
    afterButton: w.after,
    footer: w.footer,
  });
}
