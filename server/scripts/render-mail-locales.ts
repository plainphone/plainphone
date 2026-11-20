// SPDX-License-Identifier: Apache-2.0
//
// Renders the server mails in all five languages into one contact sheet per language, as
// HTML. `scripts/screenshot-mail-locales.sh` turns the sheets into light and dark PNGs for
// docs/screenshots/mail-locales/. Usage: tsx scripts/render-mail-locales.ts <out-dir>
// Everything here is made up: no real names, no real dates.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { LOCALES, type Locale } from "../src/lib/locale.js";
import { approvalRequestMail, inviteMail, loginMail, phoneAlertMail, sosMail } from "../src/lib/mail-templates.js";
import { pushWords } from "../src/lib/push-text.js";
import { weeklySummaryMail } from "../src/lib/summary-mail.js";
import type { SummaryData } from "../src/services/weekly-summary.js";

const out = resolve(process.argv[2] ?? "mail-locales");
// Links show a made-up address; only the logo, which the dashboard serves, is read from the repo.
const publicUrl = "https://app.example";
const logoDir = `file://${resolve(import.meta.dirname, "../../web/public")}`;
const withLocalLogo = (html: string) => html.replaceAll(`${publicUrl}/mail/`, `${logoDir}/mail/`);
mkdirSync(out, { recursive: true });

const data: SummaryData = {
  version: 1,
  phones: [{
    phoneId: "p1", name: "Robin",
    usage: { days: [], averageMinutes: 95, topApps: [{ packageName: "a", label: "Maps", minutes: 40 }, { packageName: "b", label: "Music", minutes: 30 }] },
    requests: { asked: 3, approved: 2, rejected: 1, byKind: {} },
    changes: { total: 2, byCategory: { time: 1, apps: 1 } },
    events: { protection: 0, offline: 1, checkin: 2 },
  }],
};

const sheet = (l: Locale) => {
  const urgent = pushWords.sos({ phoneName: "Robin", kind: "urgent" }, l);
  return [
    ["login", loginMail("parent@example.org", l, publicUrl, `${publicUrl}/login`, 15)],
    ["offline", phoneAlertMail("parent@example.org", l, publicUrl, { kind: "offline", phoneId: "p1", phoneName: "Robin", hours: 5, lastSeen: "08:10" })],
    ["sos", sosMail("parent@example.org", l, publicUrl, "p1", urgent.title, urgent.body)],
    ["summary", weeklySummaryMail("parent@example.org", l, publicUrl, "w1", data)],
    ["invite-parent", inviteMail("parent@example.org", l, publicUrl, `${publicUrl}/invite`, "parent", 7)],
    ["invite-trusted", inviteMail("parent@example.org", l, publicUrl, `${publicUrl}/invite`, "trusted", 7)],
    ["approval", approvalRequestMail("parent@example.org", l, publicUrl, "Robin")],
    ["protection-lock", phoneAlertMail("parent@example.org", l, publicUrl, { kind: "protection", phoneId: "p1", phoneName: "Robin", reason: "lock" })],
    ["protection-owner", phoneAlertMail("parent@example.org", l, publicUrl, { kind: "protection", phoneId: "p1", phoneName: "Robin", reason: "owner" })],
    ["protection-setup-undo", phoneAlertMail("parent@example.org", l, publicUrl, { kind: "protection", phoneId: "p1", phoneName: "Robin", reason: "setup-undo" })],
  ] as const;
};

for (const l of LOCALES) {
  const mails = sheet(l);
  for (const [name, mail] of mails) writeFileSync(`${out}/${l}-${name}.html`, withLocalLogo(mail.html));
  const frames = mails.map(([name]) => `<iframe src="${l}-${name}.html" title="${name}"></iframe>`).join("");
  writeFileSync(`${out}/${l}.html`, `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark">
<style>:root{color-scheme:light dark}body{margin:0;display:flex;flex-wrap:wrap;width:2800px;background:Canvas}iframe{border:0;width:560px;height:900px}</style>
${frames}`);
}
console.log(`wrote ${LOCALES.length} sheets to ${out}`);
