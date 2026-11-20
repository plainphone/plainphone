// SPDX-License-Identifier: Apache-2.0
//
// The words of the follow-up to an answer given from a notification (docs/more-time.md): what was
// answered, that the phone will confirm, why an answer did not go through, and "Active on the
// phone at 14:05". The same lines as the dashboard and parent app (`moreTime.result*`,
// `receipt.*`), in the five languages. The service worker has no i18n of its own, so the server
// sends the lines it may need along with the request.

import type { Locale } from "./locale.js";

type Answer = "15" | "60" | "day" | "no";

interface Words {
  done: Record<Answer, string>;
  wait: string;
  other: string;
  expired: string;
  failed: string;
  active: (time: string) => string;
  clockAhead: (time: string) => string;
}

const WORDS: Record<Locale, Words> = {
  en: {
    done: { "15": "15 more minutes given", "60": "60 more minutes given", day: "Given the rest of the day", no: "Declined" },
    wait: "The phone will confirm when it is active.",
    other: "Already answered by another parent",
    expired: "This request had expired",
    failed: "Could not answer, open Plainphone",
    active: (time) => `Active on the phone at ${time}`,
    clockAhead: (time) => `The phone confirmed the rules at ${time}. Check the time on the phone.`,
  },
  da: {
    done: { "15": "15 minutter ekstra givet", "60": "60 minutter ekstra givet", day: "Fik resten af dagen", no: "Afvist" },
    wait: "Telefonen bekræfter, når det er aktivt.",
    other: "Allerede besvaret af en anden forælder",
    expired: "Anmodningen var udløbet",
    failed: "Kunne ikke svare, åbn Plainphone",
    active: (time) => `Aktive på telefonen kl. ${time}`,
    clockAhead: (time) => `Telefonen bekræftede reglerne kl. ${time}. Tjek uret på telefonen.`,
  },
  sv: {
    done: { "15": "15 extra minuter givna", "60": "60 extra minuter givna", day: "Fick resten av dagen", no: "Nekad" },
    wait: "Telefonen bekräftar när det är aktivt.",
    other: "Redan besvarad av en annan förälder",
    expired: "Förfrågan hade gått ut",
    failed: "Kunde inte svara, öppna Plainphone",
    active: (time) => `Aktiva på telefonen kl. ${time}`,
    clockAhead: (time) => `Telefonen bekräftade reglerna kl. ${time}. Kontrollera klockan på telefonen.`,
  },
  nb: {
    done: { "15": "15 ekstra minutter gitt", "60": "60 ekstra minutter gitt", day: "Fikk resten av dagen", no: "Avslått" },
    wait: "Telefonen bekrefter når det er aktivt.",
    other: "Allerede besvart av en annen forelder",
    expired: "Forespørselen var utløpt",
    failed: "Kunne ikke svare, åpne Plainphone",
    active: (time) => `Aktive på telefonen kl. ${time}`,
    clockAhead: (time) => `Telefonen bekreftet reglene kl. ${time}. Sjekk klokken på telefonen.`,
  },
  de: {
    done: { "15": "15 Minuten mehr gewährt", "60": "60 Minuten mehr gewährt", day: "Rest des Tages gewährt", no: "Abgelehnt" },
    wait: "Das Telefon bestätigt, sobald es aktiv ist.",
    other: "Bereits von einem anderen Elternteil beantwortet",
    expired: "Die Anfrage war abgelaufen",
    failed: "Antwort nicht möglich, öffnen Sie Plainphone",
    active: (time) => `Auf dem Telefon aktiv seit ${time} Uhr`,
    clockAhead: (time) => `Das Telefon hat die Regeln um ${time} Uhr bestätigt. Prüfen Sie die Uhrzeit auf dem Telefon.`,
  },
};

export function moreTimeWords(locale: Locale): Words {
  return WORDS[locale];
}

/** The lines the service worker needs to follow up on a tap, as plain strings it can show as they are. */
export function followUpWords(locale: Locale, receipts: boolean) {
  const w = WORDS[locale];
  return { done: w.done, ...(receipts ? { wait: w.wait } : {}), other: w.other, expired: w.expired, failed: w.failed };
}

/** "14:05" in the phone's time zone, the clock the child holds. */
export function clockTime(at: Date, timezone: string, locale: Locale): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat(locale === "nb" ? "nb-NO" : locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(at);
  try {
    return fmt(timezone);
  } catch {
    return fmt("UTC");
  }
}
