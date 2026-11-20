// SPDX-License-Identifier: Apache-2.0
//
// Every text the server writes itself (push, mail, weekly summary) exists in all five
// languages of the app (#160). A message that lacks one of them fails here.
import { describe, expect, it } from "vitest";
import { INTL_LOCALE, LOCALES, type Locale, toLocale } from "../src/lib/locale.js";
import {
  approvalRequestMail, approvalRequestText, footer, inviteMail, inviteText, loginMail, loginText, phoneAlertMail,
  phoneAlertText, sosButton, sosMail,
} from "../src/lib/mail-templates.js";
import { moreTimeActions, pushTables, pushWords, type SafetyNews } from "../src/lib/push-text.js";
import { summaryTable } from "../src/lib/summary-text.js";
import { pushMessage, type NotifyEvent } from "../src/services/notifications.js";

const sorted = (o: object) => Object.keys(o).sort();
const OTHER = LOCALES.filter((l) => l !== "en");
const PUBLIC_URL = "https://pp.example";

// A fixed instant: no test here depends on today's date.
const lastSeenAt = new Date("2026-03-03T07:10:00Z");
const SAFETY: SafetyNews[] = ["here", "ok", "call", "noReplyLocating", "noReplyNoLocation", "located"];

const events: Record<string, NotifyEvent> = {
  "protection lock": { type: "protection", phoneId: "p1", phoneName: "Robin", reason: "lock" },
  "protection owner": { type: "protection", phoneId: "p1", phoneName: "Robin", reason: "owner" },
  "protection setup-undo": { type: "protection", phoneId: "p1", phoneName: "Robin", reason: "setup-undo" },
  "protection setup-undo late": { type: "protection", phoneId: "p1", phoneName: "Robin", reason: "setup-undo", reportedLate: true },
  "offline hours": { type: "offline", phoneId: "p1", phoneName: "Robin", hours: 5, lastSeenAt, timezone: "Europe/Copenhagen" },
  "offline one hour": { type: "offline", phoneId: "p1", phoneName: "Robin", hours: 1, lastSeenAt, timezone: "Europe/Copenhagen" },
  "offline days": { type: "offline", phoneId: "p1", phoneName: "Robin", hours: 72, lastSeenAt, timezone: "Europe/Copenhagen" },
  approval: { type: "approval", phoneName: "Robin" },
  "request app": { type: "request", phoneId: "p1", phoneName: "Robin", what: "Maps", kind: "app" },
  "request contact": { type: "request", phoneId: "p1", phoneName: "Robin", what: "Sam", kind: "contact" },
  "request on phone": { type: "request-on-phone", phoneId: "p1", phoneName: "Robin", what: "Maps", kind: "app" },
  "request on phone daily limit": { type: "request-on-phone", phoneId: "p1", phoneName: "Robin", what: null, kind: "more-time" },
  "more time app": { type: "moreTime", requestId: "r1", phoneId: "p1", phoneName: "Robin", what: "Maps", reason: "Homework" },
  "more time total": { type: "moreTime", requestId: "r1", phoneId: "p1", phoneName: "Robin", what: null, reason: null },
  "sos urgent": { type: "sos", id: "s1", phoneId: "p1", phoneName: "Robin", kind: "urgent" },
  "sos help": { type: "sos", id: "s1", phoneId: "p1", phoneName: "Robin", kind: "help" },
  test: { type: "test" },
  summary: { type: "summary", summaryId: "w1" },
  ...Object.fromEntries(SAFETY.map((what) => [`safety ${what}`, { type: "safety", phoneId: "p1", phoneName: "Robin", what } as NotifyEvent])),
};

describe("locale table", () => {
  it("knows all five languages, with an English fallback", () => {
    expect(LOCALES).toEqual(["en", "da", "sv", "nb", "de"]);
    expect(sorted(INTL_LOCALE)).toEqual([...LOCALES].sort());
    expect(["da-DK", "sv-SE", "nb-NO", "nn", "no", "de-AT", "en-US", "fr", "", undefined, null].map(toLocale))
      .toEqual(["da", "sv", "nb", "nb", "nb", "de", "en", "en", "en", "en", "en"]);
  });
});

describe("every message has all five languages", () => {
  const tables: Record<string, object> = {
    ...Object.fromEntries(Object.entries(pushTables).map(([k, v]) => [`push ${k}`, v])),
    "mail footer": footer,
    "mail login": loginText,
    "mail invite": inviteText,
    "mail approval request": approvalRequestText,
    "mail phone alert": phoneAlertText,
    "mail SOS button": sosButton,
    "weekly summary": summaryTable,
  };
  it.each(Object.entries(tables))("%s", (_name, table) => {
    expect(sorted(table)).toEqual([...LOCALES].sort());
  });

  it("holds all the same keys in every language of the weekly summary", () => {
    for (const l of OTHER) expect(sorted(summaryTable[l])).toEqual(sorted(summaryTable.en));
  });
});

describe("push messages", () => {
  const rendered = (name: string, l: Locale) => pushMessage(events[name]!, l);

  it.each(Object.keys(events))("%s: a title and a body in each language, none copied from English", (name) => {
    const en = rendered(name, "en");
    for (const l of LOCALES) {
      const m = rendered(name, l);
      expect(m.title.trim()).not.toBe("");
      expect(m.body.trim()).not.toBe("");
      expect(`${m.title}${m.body}`).not.toMatch(/undefined|\[object|NaN/);
      // The same tag and link in every language: only the words change.
      expect({ url: m.url, tag: m.tag }).toEqual({ url: en.url, tag: en.tag });
      if (l !== "en") expect(`${m.title} ${m.body}`).not.toBe(`${en.title} ${en.body}`);
    }
  });

  it("answers in the parent's language and falls back to English only when it is unknown", () => {
    expect(pushMessage(events.approval!, toLocale("sv")).title).toBe("En förfrågan väntar på dig");
    expect(pushMessage(events.approval!, toLocale("nb-NO")).title).toBe("En forespørsel venter på deg");
    expect(pushMessage(events.approval!, toLocale("de")).title).toBe("Eine Anfrage wartet auf Sie");
    expect(pushMessage(events.approval!, toLocale("fr")).title).toBe("A request is waiting for you");
  });

  it("keeps the English and Danish texts as they were", () => {
    expect(rendered("offline hours", "en")).toMatchObject({ title: "Robin has not been in touch for 5 hours" });
    expect(rendered("offline days", "da").title).toBe("Robin har ikke været i kontakt i 3 dage");
    expect(rendered("more time app", "en").body).toBe('Maps is used up. "Homework" Answer here or open the app.');
    expect(rendered("more time total", "da").body).toBe("Den daglige grænse er brugt op. Svar her eller åbn appen.");
    expect(rendered("sos urgent", "da")).toMatchObject({ title: "Akut SOS fra Robin", body: "Jeg har brug for hjælp nu." });
  });

  it("writes a time in the language and time zone of the phone", () => {
    const body = (l: Locale) => pushWords.offline({ phoneName: "Robin", hours: 5, lastSeenAt, timezone: "Europe/Copenhagen" }, l).body;
    for (const l of LOCALES) expect(body(l)).toMatch(/08[.:]10/);
    expect(body("de")).toContain("Di.");
    expect(body("sv")).toContain("tis");
  });

  it("keeps SOS short and plain in every language", () => {
    for (const kind of ["urgent", "help"] as const) {
      for (const l of LOCALES) {
        const m = pushWords.sos({ phoneName: "Robin", kind }, l);
        expect(m.title).toContain("SOS");
        expect(m.title).toContain("Robin");
        expect(m.title.length).toBeLessThanOrEqual(30);
        expect(m.body.length).toBeLessThanOrEqual(30);
      }
    }
  });

  it("has the four answers on every 'more time' notification, with the ids the API takes", () => {
    for (const l of LOCALES) {
      expect(moreTimeActions(l).map((a) => a.id)).toEqual(["15", "60", "day", "no"]);
      for (const a of moreTimeActions(l)) expect(a.title.trim()).not.toBe("");
    }
  });
});

describe("mails", () => {
  const privacy = { en: "Privacy", da: "Privatliv", sv: "Integritet", nb: "Personvern", de: "Datenschutz" };
  const mails = (l: Locale) => ({
    login: loginMail("a@example.org", l, PUBLIC_URL, `${PUBLIC_URL}/l`, 15),
    "invite parent": inviteMail("a@example.org", l, PUBLIC_URL, `${PUBLIC_URL}/i`, "parent", 7),
    "invite trusted": inviteMail("a@example.org", l, PUBLIC_URL, `${PUBLIC_URL}/i`, "trusted", 7),
    approval: approvalRequestMail("a@example.org", l, PUBLIC_URL, "Robin"),
    "protection lock": phoneAlertMail("a@example.org", l, PUBLIC_URL, { kind: "protection", phoneId: "p1", phoneName: "Robin", reason: "lock" }),
    "protection owner": phoneAlertMail("a@example.org", l, PUBLIC_URL, { kind: "protection", phoneId: "p1", phoneName: "Robin", reason: "owner" }),
    "protection undone late": phoneAlertMail("a@example.org", l, PUBLIC_URL, { kind: "protection", phoneId: "p1", phoneName: "Robin", reason: "setup-undo", reportedLate: true }),
    offline: phoneAlertMail("a@example.org", l, PUBLIC_URL, { kind: "offline", phoneId: "p1", phoneName: "Robin", hours: 5, lastSeen: "Tue 08:10" }),
    sos: sosMail("a@example.org", l, PUBLIC_URL, "p1", "SOS from Robin", "I need help."),
  });

  it.each(Object.keys(mails("en")))("%s: subject, HTML and text in each language", (name) => {
    const en = (mails("en") as Record<string, ReturnType<typeof loginMail>>)[name]!;
    for (const l of LOCALES) {
      const m = (mails(l) as Record<string, ReturnType<typeof loginMail>>)[name]!;
      expect(m.html).toContain(`<html lang="${l}"`);
      expect(m.html).toContain(`>${privacy[l]}</a>`);
      expect(m.text).toContain(`${privacy[l]}: https://plainphone.org`);
      expect(m.text).toContain(footer[l]);
      expect(`${m.subject}${m.html}${m.text}`).not.toMatch(/undefined|\[object|NaN/);
      // The SOS text comes in as an argument from the push table, so only the chrome differs.
      if (l !== "en") expect(m.text).not.toBe(en.text);
      if (l !== "en" && name !== "sos") expect(m.subject).not.toBe(en.subject);
    }
  });

  it("writes the SOS mail from the same words as the SOS push", () => {
    for (const l of LOCALES) {
      const push = pushWords.sos({ phoneName: "Robin", kind: "urgent" }, l);
      const mail = sosMail("a@example.org", l, PUBLIC_URL, "p1", push.title, push.body);
      expect(mail.subject).toBe(push.title);
      expect(mail.text).toContain(push.body);
      expect(mail.text).toContain(`${sosButton[l]}: ${PUBLIC_URL}/phones/p1`);
    }
  });
});
