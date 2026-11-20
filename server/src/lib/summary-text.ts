// SPDX-License-Identifier: Apache-2.0
//
// The words of the weekly summary mail and push, in the five languages of the app. The
// dashboard and the parent app render the same numbers with their own i18n files.

import { type Locale, toLocale } from "./locale.js";

export type SummaryLocale = Locale;
export const toSummaryLocale = toLocale;

export type ChangeCategory = "time" | "apps" | "contacts" | "web" | "schedules" | "other";

interface Words {
  subject: string;
  preheader: string;
  heading: string;
  intro: string;
  /** "2 h 15 min" in the language's own units. */
  hours: (h: number, m: number) => string;
  screen: (average: string) => string;
  screenNone: string;
  topApps: (list: string) => string;
  requests: (asked: number, answered: number) => string;
  requestsNone: string;
  changes: (n: number, parts: string) => string;
  changesNone: string;
  protection: (n: number) => string;
  protectionNone: string;
  offline: (n: number) => string;
  checkins: (n: number) => string;
  categories: Record<ChangeCategory, string>;
  noPhones: string;
  button: string;
  after: string[];
  footer: string;
  pushTitle: string;
  pushBody: string;
}

export const summaryTable: Record<SummaryLocale, Words> = {
  en: {
    subject: "Your week with Plainphone",
    preheader: "Screen time, requests and changes from the past week.",
    heading: "Your week at a glance",
    intro: "Here is what happened on your family's phones this week.",
    hours: (h, m) => (h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`),
    screen: (a) => `Screen time: ${a} a day on average.`,
    screenNone: "No screen time was reported.",
    topApps: (l) => `Most used: ${l}.`,
    requests: (a, b) => `Requests: ${a} asked, ${b} answered.`,
    requestsNone: "No requests.",
    changes: (n, p) => `Rules changed ${n === 1 ? "once" : `${n} times`}${p ? ` (${p})` : ""}.`,
    changesNone: "No rule changes.",
    protection: (n) => `Protection was removed ${n === 1 ? "once" : `${n} times`}.`,
    protectionNone: "Protection stayed on.",
    offline: (n) => `Out of contact ${n === 1 ? "once" : `${n} times`}.`,
    checkins: (n) => `Check-ins answered: ${n}.`,
    categories: { time: "time limits", apps: "apps", contacts: "contacts", web: "web filter", schedules: "schedules", other: "other" },
    noPhones: "There are no phones in the household yet.",
    button: "Open the summary",
    after: [
      "You get one summary a week. Things that can wait are collected here. Anything that needs you still arrives at once.",
      "You can change the day or turn the summary off in your household settings.",
    ],
    footer: "Plainphone is free and open source. You get this mail because you are a parent in a Plainphone household.",
    pushTitle: "Your weekly summary is ready",
    pushBody: "See how the week went on your family's phones.",
  },
  da: {
    subject: "Din uge med Plainphone",
    preheader: "Skærmtid, anmodninger og ændringer fra den seneste uge.",
    heading: "Ugen på et øjeblik",
    intro: "Her er, hvad der er sket på familiens telefoner i denne uge.",
    hours: (h, m) => (h > 0 ? (m > 0 ? `${h} t. ${m} min.` : `${h} t.`) : `${m} min.`),
    screen: (a) => `Skærmtid: ${a} om dagen i gennemsnit.`,
    screenNone: "Der er ikke meldt skærmtid.",
    topApps: (l) => `Mest brugt: ${l}.`,
    requests: (a, b) => `Anmodninger: ${a} stillet, ${b} besvaret.`,
    requestsNone: "Ingen anmodninger.",
    changes: (n, p) => `Reglerne blev ændret ${n === 1 ? "én gang" : `${n} gange`}${p ? ` (${p})` : ""}.`,
    changesNone: "Ingen regelændringer.",
    protection: (n) => `Beskyttelsen blev fjernet ${n === 1 ? "én gang" : `${n} gange`}.`,
    protectionNone: "Beskyttelsen var slået til hele ugen.",
    offline: (n) => `Ikke i kontakt ${n === 1 ? "én gang" : `${n} gange`}.`,
    checkins: (n) => `Besvarede tjek: ${n}.`,
    categories: { time: "tidsgrænser", apps: "apps", contacts: "kontakter", web: "webfilter", schedules: "tidsplaner", other: "andet" },
    noPhones: "Der er endnu ingen telefoner i husstanden.",
    button: "Åbn oversigten",
    after: [
      "Du får én oversigt om ugen. Det, der kan vente, samles her. Alt, der kræver dig, kommer stadig med det samme.",
      "Du kan ændre dagen eller slå oversigten fra i husstandens indstillinger.",
    ],
    footer: "Plainphone er gratis og open source. Du får denne mail, fordi du er forælder i en Plainphone-husstand.",
    pushTitle: "Din ugeoversigt er klar",
    pushBody: "Se, hvordan ugen er gået på familiens telefoner.",
  },
  sv: {
    subject: "Din vecka med Plainphone",
    preheader: "Skärmtid, förfrågningar och ändringar från den senaste veckan.",
    heading: "Veckan i korthet",
    intro: "Här är vad som hänt på familjens telefoner den här veckan.",
    hours: (h, m) => (h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`),
    screen: (a) => `Skärmtid: ${a} per dag i genomsnitt.`,
    screenNone: "Ingen skärmtid har rapporterats.",
    topApps: (l) => `Mest använda: ${l}.`,
    requests: (a, b) => `Förfrågningar: ${a} ställda, ${b} besvarade.`,
    requestsNone: "Inga förfrågningar.",
    changes: (n, p) => `Reglerna ändrades ${n === 1 ? "en gång" : `${n} gånger`}${p ? ` (${p})` : ""}.`,
    changesNone: "Inga regeländringar.",
    protection: (n) => `Skyddet togs bort ${n === 1 ? "en gång" : `${n} gånger`}.`,
    protectionNone: "Skyddet var på hela veckan.",
    offline: (n) => `Ingen kontakt ${n === 1 ? "en gång" : `${n} gånger`}.`,
    checkins: (n) => `Besvarade incheckningar: ${n}.`,
    categories: { time: "tidsgränser", apps: "appar", contacts: "kontakter", web: "webbfilter", schedules: "scheman", other: "annat" },
    noPhones: "Det finns inga telefoner i hushållet än.",
    button: "Öppna sammanfattningen",
    after: [
      "Du får en sammanfattning i veckan. Sådant som kan vänta samlas här. Allt som kräver dig kommer fortfarande direkt.",
      "Du kan ändra dag eller stänga av sammanfattningen i hushållets inställningar.",
    ],
    footer: "Plainphone är gratis och öppen källkod. Du får det här mejlet eftersom du är förälder i ett Plainphone-hushåll.",
    pushTitle: "Din veckosammanfattning är klar",
    pushBody: "Se hur veckan gått på familjens telefoner.",
  },
  nb: {
    subject: "Uken din med Plainphone",
    preheader: "Skjermtid, forespørsler og endringer fra den siste uken.",
    heading: "Uken på et øyeblikk",
    intro: "Dette har skjedd på familiens telefoner denne uken.",
    hours: (h, m) => (h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`),
    screen: (a) => `Skjermtid: ${a} per dag i gjennomsnitt.`,
    screenNone: "Ingen skjermtid er rapportert.",
    topApps: (l) => `Mest brukt: ${l}.`,
    requests: (a, b) => `Forespørsler: ${a} stilt, ${b} besvart.`,
    requestsNone: "Ingen forespørsler.",
    changes: (n, p) => `Reglene ble endret ${n === 1 ? "én gang" : `${n} ganger`}${p ? ` (${p})` : ""}.`,
    changesNone: "Ingen regelendringer.",
    protection: (n) => `Beskyttelsen ble fjernet ${n === 1 ? "én gang" : `${n} ganger`}.`,
    protectionNone: "Beskyttelsen var på hele uken.",
    offline: (n) => `Ikke i kontakt ${n === 1 ? "én gang" : `${n} ganger`}.`,
    checkins: (n) => `Besvarte innsjekkinger: ${n}.`,
    categories: { time: "tidsgrenser", apps: "apper", contacts: "kontakter", web: "nettfilter", schedules: "tidsplaner", other: "annet" },
    noPhones: "Det er ingen telefoner i husstanden ennå.",
    button: "Åpne oversikten",
    after: [
      "Du får én oversikt i uken. Det som kan vente, samles her. Alt som krever deg, kommer fortsatt med en gang.",
      "Du kan endre dagen eller slå av oversikten i husstandens innstillinger.",
    ],
    footer: "Plainphone er gratis og åpen kildekode. Du får denne e-posten fordi du er forelder i en Plainphone-husstand.",
    pushTitle: "Ukeoversikten din er klar",
    pushBody: "Se hvordan uken har gått på familiens telefoner.",
  },
  de: {
    subject: "Ihre Woche mit Plainphone",
    preheader: "Bildschirmzeit, Anfragen und Änderungen der letzten Woche.",
    heading: "Die Woche auf einen Blick",
    intro: "Das ist diese Woche auf den Handys Ihrer Familie passiert.",
    hours: (h, m) => (h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`),
    screen: (a) => `Bildschirmzeit: durchschnittlich ${a} pro Tag.`,
    screenNone: "Es wurde keine Bildschirmzeit gemeldet.",
    topApps: (l) => `Am meisten genutzt: ${l}.`,
    requests: (a, b) => `Anfragen: ${a} gestellt, ${b} beantwortet.`,
    requestsNone: "Keine Anfragen.",
    changes: (n, p) => `Die Regeln wurden ${n === 1 ? "einmal" : `${n}-mal`} geändert${p ? ` (${p})` : ""}.`,
    changesNone: "Keine Regeländerungen.",
    protection: (n) => `Der Schutz wurde ${n === 1 ? "einmal" : `${n}-mal`} entfernt.`,
    protectionNone: "Der Schutz war die ganze Woche an.",
    offline: (n) => `${n === 1 ? "Einmal" : `${n}-mal`} ohne Kontakt.`,
    checkins: (n) => `Beantwortete Check-ins: ${n}.`,
    categories: { time: "Zeitlimits", apps: "Apps", contacts: "Kontakte", web: "Webfilter", schedules: "Zeitpläne", other: "Sonstiges" },
    noPhones: "Im Haushalt gibt es noch keine Handys.",
    button: "Zusammenfassung öffnen",
    after: [
      "Sie bekommen einmal pro Woche eine Zusammenfassung. Was warten kann, wird hier gesammelt. Alles, was Sie braucht, kommt weiterhin sofort.",
      "Den Tag ändern oder die Zusammenfassung ausschalten können Sie in den Haushaltseinstellungen.",
    ],
    footer: "Plainphone ist kostenlos und Open Source. Sie erhalten diese Mail, weil Sie Elternteil in einem Plainphone-Haushalt sind.",
    pushTitle: "Ihre Wochenzusammenfassung ist da",
    pushBody: "Sehen Sie, wie die Woche auf den Handys Ihrer Familie verlaufen ist.",
  },
};

export function summaryWords(locale: SummaryLocale): Words {
  return summaryTable[locale];
}
