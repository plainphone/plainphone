// SPDX-License-Identifier: Apache-2.0
//
// The words of the "review the rules" reminder (push and mail), in the five languages of the app
// (docs/age-presets.md). The dashboard and the parent app write the same suggestions with their
// own i18n files.

import type { DnsCategory } from "../db/schema.js";
import type { Suggestion } from "./age-presets.js";
import type { Locale } from "./locale.js";

interface Words {
  pushTitle: (phoneName: string) => string;
  pushBody: string;
  subject: (phoneName: string) => string;
  preheader: string;
  heading: (phoneName: string) => string;
  intro: string;
  /** "Ideas for what to open up next". */
  ideas: string;
  time: (from: string, to: string) => string;
  bedtime: (from: string, to: string) => string;
  school: string;
  category: (name: string) => string;
  talk: string;
  /** "1 h 30 min" in the language's own units. */
  duration: (h: number, m: number) => string;
  categories: Record<DnsCategory, string>;
  button: string;
  after: string[];
  footer: string;
}

const table: Record<Locale, Words> = {
  en: {
    pushTitle: (n) => `Time to review ${n}'s rules`,
    pushBody: "A calm moment to look at what could open up next.",
    subject: (n) => `Time to review the rules for ${n}`,
    preheader: "A few ideas for what to open up next.",
    heading: (n) => `Review the rules for ${n}`,
    intro: "A few months have passed. Children grow, and the rules can grow with them. This is a good moment to sit down together and look at what could open up next.",
    ideas: "Ideas for what to open up next",
    time: (a, b) => `More time a day: from ${a} to ${b}.`,
    bedtime: (a, b) => `Later bedtime: from ${a} to ${b}.`,
    school: "Take school time off, so the phone stays open during the day.",
    category: (c) => `Open ${c} in the web filter.`,
    talk: "Nothing needs to change. Ask what they would like to try next.",
    duration: (h, m) => (h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`),
    categories: { social: "social media", adult: "adult content", gambling: "gambling", games: "games", dating: "dating", video: "video" },
    button: "Review the rules",
    after: [
      "The goal is a child who needs no rules from you, and a phone that is released one day. You can do that from the phone's page whenever you are ready.",
      "You can change how often you are reminded, or turn the reminder off, on the phone's page.",
    ],
    footer: "Plainphone is free and open source. You get this mail because you are a parent in a Plainphone household.",
  },
  da: {
    pushTitle: (n) => `Tid til at se på ${n}s regler`,
    pushBody: "Et roligt øjeblik til at se, hvad der kan åbnes næste gang.",
    subject: (n) => `Tid til at se på reglerne for ${n}`,
    preheader: "Et par forslag til, hvad der kan åbnes næste gang.",
    heading: (n) => `Se på reglerne for ${n}`,
    intro: "Der er gået et par måneder. Børn vokser, og reglerne kan vokse med dem. Det er et godt tidspunkt at sætte sig sammen og se på, hvad der kan åbnes næste gang.",
    ideas: "Forslag til, hvad der kan åbnes næste gang",
    time: (a, b) => `Mere tid om dagen: fra ${a} til ${b}.`,
    bedtime: (a, b) => `Senere sengetid: fra ${a} til ${b}.`,
    school: "Tag skoletiden af, så telefonen er åben i løbet af dagen.",
    category: (c) => `Åbn ${c} i webfilteret.`,
    talk: "Der behøver ikke ændres noget. Spørg, hvad de gerne vil prøve næste gang.",
    duration: (h, m) => (h > 0 ? (m > 0 ? `${h} t. ${m} min.` : `${h} t.`) : `${m} min.`),
    categories: { social: "sociale medier", adult: "voksenindhold", gambling: "spil om penge", games: "spil", dating: "dating", video: "video" },
    button: "Se på reglerne",
    after: [
      "Målet er et barn, der ikke har brug for regler fra dig, og en telefon, der en dag bliver frigivet. Det kan du gøre fra telefonens side, når du er klar.",
      "Du kan ændre, hvor tit du får en påmindelse, eller slå den fra på telefonens side.",
    ],
    footer: "Plainphone er gratis og open source. Du får denne mail, fordi du er forælder i en Plainphone-husstand.",
  },
  sv: {
    pushTitle: (n) => `Dags att se över ${n}s regler`,
    pushBody: "Ett lugnt tillfälle att se vad som kan öppnas härnäst.",
    subject: (n) => `Dags att se över reglerna för ${n}`,
    preheader: "Några förslag på vad som kan öppnas härnäst.",
    heading: (n) => `Se över reglerna för ${n}`,
    intro: "Det har gått några månader. Barn växer, och reglerna kan växa med dem. Det är ett bra tillfälle att sätta sig ner tillsammans och se vad som kan öppnas härnäst.",
    ideas: "Förslag på vad som kan öppnas härnäst",
    time: (a, b) => `Mer tid per dag: från ${a} till ${b}.`,
    bedtime: (a, b) => `Senare läggdags: från ${a} till ${b}.`,
    school: "Ta bort skoltiden, så att telefonen är öppen under dagen.",
    category: (c) => `Öppna ${c} i webbfiltret.`,
    talk: "Inget behöver ändras. Fråga vad de vill prova härnäst.",
    duration: (h, m) => (h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`),
    categories: { social: "sociala medier", adult: "vuxeninnehåll", gambling: "spel om pengar", games: "spel", dating: "dejting", video: "video" },
    button: "Se över reglerna",
    after: [
      "Målet är ett barn som inte behöver några regler från dig, och en telefon som en dag friges. Det kan du göra från telefonens sida när du är redo.",
      "Du kan ändra hur ofta du får en påminnelse, eller stänga av den, på telefonens sida.",
    ],
    footer: "Plainphone är gratis och öppen källkod. Du får det här mejlet eftersom du är förälder i ett Plainphone-hushåll.",
  },
  nb: {
    pushTitle: (n) => `På tide å se på reglene til ${n}`,
    pushBody: "Et rolig øyeblikk for å se hva som kan åpnes neste gang.",
    subject: (n) => `På tide å se på reglene for ${n}`,
    preheader: "Noen forslag til hva som kan åpnes neste gang.",
    heading: (n) => `Se på reglene for ${n}`,
    intro: "Det har gått noen måneder. Barn vokser, og reglene kan vokse med dem. Det er et godt tidspunkt å sette seg ned sammen og se på hva som kan åpnes neste gang.",
    ideas: "Forslag til hva som kan åpnes neste gang",
    time: (a, b) => `Mer tid per dag: fra ${a} til ${b}.`,
    bedtime: (a, b) => `Senere leggetid: fra ${a} til ${b}.`,
    school: "Ta bort skoletiden, så telefonen er åpen i løpet av dagen.",
    category: (c) => `Åpne ${c} i nettfilteret.`,
    talk: "Ingenting må endres. Spør hva de har lyst til å prøve neste gang.",
    duration: (h, m) => (h > 0 ? (m > 0 ? `${h} t ${m} min` : `${h} t`) : `${m} min`),
    categories: { social: "sosiale medier", adult: "vokseninnhold", gambling: "pengespill", games: "spill", dating: "dating", video: "video" },
    button: "Se på reglene",
    after: [
      "Målet er et barn som ikke trenger regler fra deg, og en telefon som en dag frigis. Det kan du gjøre fra telefonens side når du er klar.",
      "Du kan endre hvor ofte du får en påminnelse, eller slå den av, på telefonens side.",
    ],
    footer: "Plainphone er gratis og åpen kildekode. Du får denne e-posten fordi du er forelder i en Plainphone-husstand.",
  },
  de: {
    pushTitle: (n) => `Zeit, die Regeln für ${n} anzusehen`,
    pushBody: "Ein ruhiger Moment, um zu schauen, was als Nächstes geöffnet werden kann.",
    subject: (n) => `Zeit, die Regeln für ${n} anzusehen`,
    preheader: "Ein paar Ideen, was als Nächstes geöffnet werden kann.",
    heading: (n) => `Die Regeln für ${n} ansehen`,
    intro: "Es sind einige Monate vergangen. Kinder wachsen, und die Regeln können mitwachsen. Jetzt ist ein guter Moment, sich gemeinsam hinzusetzen und zu schauen, was als Nächstes geöffnet werden kann.",
    ideas: "Ideen, was als Nächstes geöffnet werden kann",
    time: (a, b) => `Mehr Zeit pro Tag: von ${a} auf ${b}.`,
    bedtime: (a, b) => `Spätere Schlafenszeit: von ${a} auf ${b}.`,
    school: "Die Schulzeit abschalten, damit das Handy tagsüber offen bleibt.",
    category: (c) => `${c} im Webfilter öffnen.`,
    talk: "Es muss nichts geändert werden. Fragen Sie, was Ihr Kind als Nächstes ausprobieren möchte.",
    duration: (h, m) => (h > 0 ? (m > 0 ? `${h} Std. ${m} Min.` : `${h} Std.`) : `${m} Min.`),
    categories: { social: "Soziale Medien", adult: "Inhalte für Erwachsene", gambling: "Glücksspiel", games: "Spiele", dating: "Dating", video: "Video" },
    button: "Regeln ansehen",
    after: [
      "Das Ziel ist ein Kind, das keine Regeln von Ihnen mehr braucht, und ein Handy, das eines Tages freigegeben wird. Das können Sie auf der Seite des Handys tun, sobald Sie bereit sind.",
      "Wie oft Sie erinnert werden, können Sie auf der Seite des Handys ändern oder die Erinnerung ausschalten.",
    ],
    footer: "Plainphone ist kostenlos und Open Source. Sie erhalten diese Mail, weil Sie Elternteil in einem Plainphone-Haushalt sind.",
  },
};

export const reviewTable = table;

export function reviewWords(locale: Locale): Words {
  return table[locale];
}

const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** One suggestion as a short sentence. */
export function suggestionText(s: Suggestion, locale: Locale): string {
  const w = table[locale];
  const minutes = (m: number) => w.duration(Math.floor(m / 60), m % 60);
  switch (s.kind) {
    case "time": return w.time(minutes(s.from), minutes(s.to));
    case "bedtime": return w.bedtime(clock(s.from), clock(s.to));
    case "school": return w.school;
    case "category": return w.category(w.categories[s.category]);
    case "talk": return w.talk;
  }
}
