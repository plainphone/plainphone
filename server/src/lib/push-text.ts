// SPDX-License-Identifier: Apache-2.0
//
// The words of every push to a parent, in the five languages of the app. One table per
// message, keyed by language; `satisfies Record<Locale, …>` makes a missing language a
// compile error and test/locale-completeness.test.ts checks it at run time too. SOS
// texts stay short in every language: they are read in a hurry.

import { INTL_LOCALE, type Locale } from "./locale.js";

export interface Words {
  title: string;
  body: string;
}

/** What a parent hears about a ring or an "Are you okay?" (docs/location.md). */
export type SafetyNews = "here" | "ok" | "call" | "noReplyLocating" | "noReplyNoLocation" | "located";

export interface PushFacts {
  protection: { phoneName: string; reason: "lock" | "owner" | "setup-undo" | "lifted"; reportedLate?: boolean };
  offline: { phoneName: string; hours: number; lastSeenAt: Date; timezone: string };
  neverConnected: { phoneName: string };
  approval: { phoneName: string };
  request: { phoneName: string; what: string; kind: "app" | "contact" };
  /** `what` is null for the daily limit. */
  requestOnPhone: { phoneName: string; what: string | null };
  safety: { phoneName: string; what: SafetyNews };
  sos: { phoneName: string; kind: "urgent" | "help"; trigger?: "power" | "clock" | "code" | null; message?: string | null };
  /** A quick message, or the child's suggestion for a new one. */
  quickMessage: { phoneName: string; text: string };
  /** A Self phone used one of its emergency openings (docs/emergency-openings.md). `appName` is null when the server does not know the app. */
  emergencyOpening: { phoneName: string; appName: string | null; minutes: number; used: number; allowance: number };
}

/** "Tue 08:10" in the phone's own time zone. */
export function lastSeen(e: { lastSeenAt: Date; timezone: string }, locale: Locale): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    }).format(e.lastSeenAt);
  try {
    return fmt(e.timezone);
  } catch {
    return fmt("UTC");
  }
}

const units: Record<Locale, { hour: [string, string]; day: string }> = {
  en: { hour: ["hour", "hours"], day: "days" },
  da: { hour: ["time", "timer"], day: "dage" },
  sv: { hour: ["timme", "timmar"], day: "dagar" },
  nb: { hour: ["time", "timer"], day: "dager" },
  de: { hour: ["Stunde", "Stunden"], day: "Tage" },
};

/** How long a phone has been quiet: hours, or whole days from two days on. */
export function silence(hours: number, locale: Locale): string {
  const u = units[locale];
  if (hours >= 48) return `${Math.floor(hours / 24)} ${u.day}`;
  return `${hours} ${u.hour[hours === 1 ? 0 : 1]}`;
}

const protection = {
  en: (e) => ({
    title: e.reason === "lifted" ? `${e.phoneName}: account changes may still be allowed` : `Protection removed on ${e.phoneName}`,
    body:
      e.reason === "lifted"
        ? "An approved sign-in window ended at its deadline, but the phone has not reported since. Open Plainphone on the phone to restore the lock."
        : e.reason === "setup-undo"
        ? (e.reportedLate ? "Set-up was undone on the phone. The report arrived late." : "Set-up was undone on the phone.")
        : e.reason === "owner"
          ? "Plainphone no longer controls this phone. Open the app to see what happened."
          : "The lock on this phone is not intact. Open the app to see what happened.",
  }),
  da: (e) => ({
    title: e.reason === "lifted" ? `${e.phoneName}: kontoændringer kan stadig være tilladt` : `Beskyttelsen er fjernet på ${e.phoneName}`,
    body:
      e.reason === "lifted"
        ? "Et godkendt tidsvindue til login sluttede ved fristen, men telefonen har ikke meldt sig siden. Åbn Plainphone på telefonen for at genskabe låsen."
        : e.reason === "setup-undo"
        ? (e.reportedLate ? "Opsætningen blev fortrudt på telefonen. Beskeden kom forsinket." : "Opsætningen blev fortrudt på telefonen.")
        : e.reason === "owner"
          ? "Plainphone styrer ikke længere telefonen. Åbn appen for at se, hvad der er sket."
          : "Låsen på telefonen er ikke intakt. Åbn appen for at se, hvad der er sket.",
  }),
  sv: (e) => ({
    title: e.reason === "lifted" ? `${e.phoneName}: kontoändringar kan fortfarande vara tillåtna` : `Skyddet har tagits bort på ${e.phoneName}`,
    body:
      e.reason === "lifted"
        ? "Ett godkänt inloggningsfönster tog slut vid tidsgränsen, men telefonen har inte hört av sig sedan dess. Öppna Plainphone på telefonen för att återställa låset."
        : e.reason === "setup-undo"
        ? (e.reportedLate ? "Inställningen ångrades på telefonen. Meddelandet kom försenat." : "Inställningen ångrades på telefonen.")
        : e.reason === "owner"
          ? "Plainphone styr inte längre telefonen. Öppna appen för att se vad som hänt."
          : "Låset på telefonen är inte intakt. Öppna appen för att se vad som hänt.",
  }),
  nb: (e) => ({
    title: e.reason === "lifted" ? `${e.phoneName}: kontoendringer kan fortsatt være tillatt` : `Beskyttelsen er fjernet på ${e.phoneName}`,
    body:
      e.reason === "lifted"
        ? "Et godkjent tidsvindu for innlogging gikk ut ved fristen, men telefonen har ikke meldt seg siden. Åpne Plainphone på telefonen for å gjenopprette låsen."
        : e.reason === "setup-undo"
        ? (e.reportedLate ? "Oppsettet ble angret på telefonen. Meldingen kom forsinket." : "Oppsettet ble angret på telefonen.")
        : e.reason === "owner"
          ? "Plainphone styrer ikke lenger telefonen. Åpne appen for å se hva som har skjedd."
          : "Låsen på telefonen er ikke intakt. Åpne appen for å se hva som har skjedd.",
  }),
  de: (e) => ({
    title: e.reason === "lifted" ? `${e.phoneName}: Kontoänderungen sind möglicherweise noch erlaubt` : `Schutz auf ${e.phoneName} entfernt`,
    body:
      e.reason === "lifted"
        ? "Ein genehmigtes Anmeldefenster ist zur Frist abgelaufen, aber das Handy hat sich seitdem nicht gemeldet. Öffnen Sie Plainphone auf dem Handy, um die Sperre wiederherzustellen."
        : e.reason === "setup-undo"
        ? (e.reportedLate ? "Die Einrichtung wurde auf dem Handy rückgängig gemacht. Die Meldung kam verspätet." : "Die Einrichtung wurde auf dem Handy rückgängig gemacht.")
        : e.reason === "owner"
          ? "Plainphone steuert dieses Handy nicht mehr. Öffnen Sie die App, um zu sehen, was passiert ist."
          : "Die Sperre auf diesem Handy ist nicht intakt. Öffnen Sie die App, um zu sehen, was passiert ist.",
  }),
} satisfies Record<Locale, (e: PushFacts["protection"]) => Words>;

const offline = {
  en: (e) => ({
    title: `${e.phoneName} has not been in touch for ${silence(e.hours, "en")}`,
    body: `Last contact ${lastSeen(e, "en")}. It may be switched off, out of battery or reset.`,
  }),
  da: (e) => ({
    title: `${e.phoneName} har ikke været i kontakt i ${silence(e.hours, "da")}`,
    body: `Sidst i kontakt ${lastSeen(e, "da")}. Den kan være slukket, løbet tør for strøm eller nulstillet.`,
  }),
  sv: (e) => ({
    title: `${e.phoneName} har inte hörts av på ${silence(e.hours, "sv")}`,
    body: `Senast i kontakt ${lastSeen(e, "sv")}. Den kan vara avstängd, ha slut på batteri eller ha återställts.`,
  }),
  nb: (e) => ({
    title: `${e.phoneName} har ikke vært i kontakt på ${silence(e.hours, "nb")}`,
    body: `Sist i kontakt ${lastSeen(e, "nb")}. Den kan være slått av, tom for strøm eller tilbakestilt.`,
  }),
  de: (e) => ({
    title: `${e.phoneName} war ${silence(e.hours, "de")} lang nicht erreichbar`,
    body: `Letzter Kontakt: ${lastSeen(e, "de")}. Das Handy kann ausgeschaltet, leer oder zurückgesetzt worden sein.`,
  }),
} satisfies Record<Locale, (e: PushFacts["offline"]) => Words>;

const neverConnected = {
  en: (e) => ({
    title: `${e.phoneName} has not connected yet`,
    body: "Set-up was confirmed on the phone, but it has not been in touch. Open Plainphone on the phone, or remove it from the list.",
  }),
  da: (e) => ({
    title: `${e.phoneName} er ikke forbundet endnu`,
    body: "Opsætningen blev bekræftet på telefonen, men den har ikke været i kontakt. Åbn Plainphone på telefonen, eller fjern den fra listen.",
  }),
  sv: (e) => ({
    title: `${e.phoneName} har inte anslutit än`,
    body: "Installationen bekräftades på telefonen, men den har inte hörts av. Öppna Plainphone på telefonen eller ta bort den från listan.",
  }),
  nb: (e) => ({
    title: `${e.phoneName} er ikke koblet til ennå`,
    body: "Oppsettet ble bekreftet på telefonen, men den har ikke vært i kontakt. Åpne Plainphone på telefonen, eller fjern den fra listen.",
  }),
  de: (e) => ({
    title: `${e.phoneName} hat sich noch nicht verbunden`,
    body: "Die Einrichtung wurde auf dem Handy bestätigt, aber es hat sich noch nicht gemeldet. Öffnen Sie Plainphone auf dem Handy oder entfernen Sie es aus der Liste.",
  }),
} satisfies Record<Locale, (e: PushFacts["neverConnected"]) => Words>;

const approval = {
  en: (e) => ({ title: "A request is waiting for you", body: `Someone asks to loosen a rule on "${e.phoneName}".` }),
  da: (e) => ({ title: "En anmodning venter på dig", body: `Nogen beder om at løsne en regel på "${e.phoneName}".` }),
  sv: (e) => ({ title: "En förfrågan väntar på dig", body: `Någon vill lätta på en regel på "${e.phoneName}".` }),
  nb: (e) => ({ title: "En forespørsel venter på deg", body: `Noen ber om å løsne en regel på "${e.phoneName}".` }),
  de: (e) => ({ title: "Eine Anfrage wartet auf Sie", body: `Jemand möchte eine Regel auf „${e.phoneName}“ lockern.` }),
} satisfies Record<Locale, (e: PushFacts["approval"]) => Words>;

const request = {
  en: (e) => ({
    title: `${e.phoneName} asks for ${e.kind === "app" ? "an app" : "a contact"}`,
    body: `${e.what}. Open the app to approve or decline.`,
  }),
  da: (e) => ({
    title: `${e.phoneName} beder om ${e.kind === "app" ? "en app" : "en kontakt"}`,
    body: `${e.what}. Åbn appen for at godkende eller afvise.`,
  }),
  sv: (e) => ({
    title: `${e.phoneName} ber om ${e.kind === "app" ? "en app" : "en kontakt"}`,
    body: `${e.what}. Öppna appen för att godkänna eller avslå.`,
  }),
  nb: (e) => ({
    title: `${e.phoneName} ber om ${e.kind === "app" ? "en app" : "en kontakt"}`,
    body: `${e.what}. Åpne appen for å godkjenne eller avslå.`,
  }),
  de: (e) => ({
    title: `${e.phoneName} bittet um ${e.kind === "app" ? "eine App" : "einen Kontakt"}`,
    body: `${e.what}. Öffnen Sie die App, um zuzustimmen oder abzulehnen.`,
  }),
} satisfies Record<Locale, (e: PushFacts["request"]) => Words>;

const requestOnPhone = {
  en: (e) => ({ title: `Approved on ${e.phoneName}`, body: `${e.what ?? "The daily limit"}. A parent approved it on the phone with the PIN. Nothing more to do.` }),
  da: (e) => ({ title: `Godkendt på ${e.phoneName}`, body: `${e.what ?? "Den daglige grænse"}. En forælder godkendte det på telefonen med pinkoden. Du skal ikke gøre mere.` }),
  sv: (e) => ({ title: `Godkänt på ${e.phoneName}`, body: `${e.what ?? "Den dagliga gränsen"}. En förälder godkände det på telefonen med pinkoden. Du behöver inte göra något mer.` }),
  nb: (e) => ({ title: `Godkjent på ${e.phoneName}`, body: `${e.what ?? "Den daglige grensen"}. En forelder godkjente det på telefonen med pinkoden. Du trenger ikke å gjøre mer.` }),
  de: (e) => ({ title: `Auf ${e.phoneName} genehmigt`, body: `${e.what ?? "Das Tageslimit"}. Ein Elternteil hat es am Handy mit der PIN genehmigt. Sie müssen nichts weiter tun.` }),
} satisfies Record<Locale, (e: PushFacts["requestOnPhone"]) => Words>;

/** "More time": the phone asks for more time. `what` is the app's name, or null for the daily limit. */
interface MoreTimeWords {
  title: (phone: string) => string;
  total: string;
  app: (app: string) => string;
  quote: (reason: string) => string;
  tail: string;
  /** The buttons. The ids are the answers the API takes. */
  actions: { id: string; title: string }[];
}

const moreTime = {
  en: {
    title: (phone) => `${phone} asks for more time`,
    total: "The daily limit is used up.",
    app: (app) => `${app} is used up.`,
    quote: (reason) => `"${reason}"`,
    tail: "Answer here or open the app.",
    actions: [{ id: "15", title: "15 min" }, { id: "60", title: "1 hour" }, { id: "day", title: "Rest of the day" }, { id: "no", title: "No" }],
  },
  da: {
    title: (phone) => `${phone} beder om mere tid`,
    total: "Den daglige grænse er brugt op.",
    app: (app) => `${app} er brugt op.`,
    quote: (reason) => `”${reason}”`,
    tail: "Svar her eller åbn appen.",
    actions: [{ id: "15", title: "15 min" }, { id: "60", title: "1 time" }, { id: "day", title: "Resten af dagen" }, { id: "no", title: "Nej" }],
  },
  sv: {
    title: (phone) => `${phone} ber om mer tid`,
    total: "Den dagliga gränsen är slut.",
    app: (app) => `Tiden för ${app} är slut.`,
    quote: (reason) => `”${reason}”`,
    tail: "Svara här eller öppna appen.",
    actions: [{ id: "15", title: "15 min" }, { id: "60", title: "1 timme" }, { id: "day", title: "Resten av dagen" }, { id: "no", title: "Nej" }],
  },
  nb: {
    title: (phone) => `${phone} ber om mer tid`,
    total: "Den daglige grensen er brukt opp.",
    app: (app) => `Tiden for ${app} er brukt opp.`,
    quote: (reason) => `«${reason}»`,
    tail: "Svar her eller åpne appen.",
    actions: [{ id: "15", title: "15 min" }, { id: "60", title: "1 time" }, { id: "day", title: "Resten av dagen" }, { id: "no", title: "Nei" }],
  },
  de: {
    title: (phone) => `${phone} bittet um mehr Zeit`,
    total: "Das Tageslimit ist aufgebraucht.",
    app: (app) => `Die Zeit für ${app} ist aufgebraucht.`,
    quote: (reason) => `„${reason}“`,
    tail: "Antworten Sie hier oder öffnen Sie die App.",
    actions: [{ id: "15", title: "15 Min." }, { id: "60", title: "1 Stunde" }, { id: "day", title: "Rest des Tages" }, { id: "no", title: "Nein" }],
  },
} satisfies Record<Locale, MoreTimeWords>;

const safety = {
  en: (e) => ({
    here: { title: `${e.phoneName}: "I'm here"`, body: "The button on the phone was pressed." },
    ok: { title: `${e.phoneName}: "Yes, I'm okay"`, body: "No position was sent." },
    call: { title: `${e.phoneName}: "Call me"`, body: "The phone is calling you now." },
    noReplyLocating: { title: `No answer from ${e.phoneName}`, body: "The phone is sending its position." },
    noReplyNoLocation: { title: `No answer from ${e.phoneName}`, body: "\"Are you okay?\" was not answered in time." },
    located: { title: `Position of ${e.phoneName}`, body: "\"Are you okay?\" was not answered. Open the app to see where the phone is." },
  })[e.what],
  da: (e) => ({
    here: { title: `${e.phoneName}: ”Jeg er her”`, body: "Der blev trykket på knappen på telefonen." },
    ok: { title: `${e.phoneName}: ”Ja, jeg er okay”`, body: "Der blev ikke sendt nogen placering." },
    call: { title: `${e.phoneName}: ”Ring til mig”`, body: "Telefonen ringer til dig nu." },
    noReplyLocating: { title: `Intet svar fra ${e.phoneName}`, body: "Telefonen sender sin placering." },
    noReplyNoLocation: { title: `Intet svar fra ${e.phoneName}`, body: "”Er du okay?” blev ikke besvaret i tide." },
    located: { title: `Placering af ${e.phoneName}`, body: "”Er du okay?” blev ikke besvaret. Åbn appen for at se, hvor telefonen er." },
  })[e.what],
  sv: (e) => ({
    here: { title: `${e.phoneName}: ”Jag är här”`, body: "Knappen på telefonen trycktes." },
    ok: { title: `${e.phoneName}: ”Ja, jag är okej”`, body: "Ingen position skickades." },
    call: { title: `${e.phoneName}: ”Ring mig”`, body: "Telefonen ringer dig nu." },
    noReplyLocating: { title: `Inget svar från ${e.phoneName}`, body: "Telefonen skickar sin position." },
    noReplyNoLocation: { title: `Inget svar från ${e.phoneName}`, body: "”Är du okej?” besvarades inte i tid." },
    located: { title: `Position för ${e.phoneName}`, body: "”Är du okej?” besvarades inte. Öppna appen för att se var telefonen är." },
  })[e.what],
  nb: (e) => ({
    here: { title: `${e.phoneName}: «Jeg er her»`, body: "Knappen på telefonen ble trykket." },
    ok: { title: `${e.phoneName}: «Ja, jeg har det bra»`, body: "Ingen posisjon ble sendt." },
    call: { title: `${e.phoneName}: «Ring meg»`, body: "Telefonen ringer deg nå." },
    noReplyLocating: { title: `Ingen svar fra ${e.phoneName}`, body: "Telefonen sender posisjonen sin." },
    noReplyNoLocation: { title: `Ingen svar fra ${e.phoneName}`, body: "«Har du det bra?» ble ikke besvart i tide." },
    located: { title: `Posisjonen til ${e.phoneName}`, body: "«Har du det bra?» ble ikke besvart. Åpne appen for å se hvor telefonen er." },
  })[e.what],
  de: (e) => ({
    here: { title: `${e.phoneName}: „Ich bin hier“`, body: "Die Taste am Handy wurde gedrückt." },
    ok: { title: `${e.phoneName}: „Ja, mir geht es gut“`, body: "Es wurde kein Standort gesendet." },
    call: { title: `${e.phoneName}: „Ruf mich an“`, body: "Das Handy ruft Sie jetzt an." },
    noReplyLocating: { title: `Keine Antwort von ${e.phoneName}`, body: "Das Handy sendet seinen Standort." },
    noReplyNoLocation: { title: `Keine Antwort von ${e.phoneName}`, body: "„Geht es dir gut?“ wurde nicht rechtzeitig beantwortet." },
    located: { title: `Standort von ${e.phoneName}`, body: "„Geht es dir gut?“ wurde nicht beantwortet. Öffnen Sie die App, um zu sehen, wo das Handy ist." },
  })[e.what],
} satisfies Record<Locale, (e: PushFacts["safety"]) => Words>;

/** How a hidden SOS was sent, after the urgent line; a code word quotes the quick message. */
const sosTrigger = {
  en: { power: "Sent quietly with the power button.", clock: "Sent quietly from the clock on the home screen.", code: (m: string) => `Code word: "${m}"` },
  da: { power: "Sendt i det skjulte med tænd/sluk-knappen.", clock: "Sendt i det skjulte fra uret på startskærmen.", code: (m: string) => `Kodeord: ”${m}”` },
  sv: { power: "Skickat i tysthet med strömknappen.", clock: "Skickat i tysthet från klockan på hemskärmen.", code: (m: string) => `Kodord: ”${m}”` },
  nb: { power: "Sendt i det stille med av/på-knappen.", clock: "Sendt i det stille fra klokken på startskjermen.", code: (m: string) => `Kodeord: «${m}»` },
  de: { power: "Unbemerkt mit der Ein-/Aus-Taste gesendet.", clock: "Unbemerkt über die Uhr auf dem Startbildschirm gesendet.", code: (m: string) => `Codewort: „${m}“` },
} satisfies Record<Locale, { power: string; clock: string; code: (m: string) => string }>;

function withTrigger(e: PushFacts["sos"], l: Locale, w: Words): Words {
  const t = sosTrigger[l];
  const extra = e.trigger === "code" && e.message ? t.code(e.message) : e.trigger === "power" ? t.power : e.trigger === "clock" ? t.clock : null;
  return extra ? { title: w.title, body: `${w.body} ${extra}` } : w;
}

const sos = {
  en: (e) => withTrigger(e, "en", { title: `${e.kind === "urgent" ? "Urgent SOS" : "SOS"} from ${e.phoneName}`, body: e.kind === "urgent" ? "I need help now." : "I need help." }),
  da: (e) => withTrigger(e, "da", { title: `${e.kind === "urgent" ? "Akut SOS" : "SOS"} fra ${e.phoneName}`, body: e.kind === "urgent" ? "Jeg har brug for hjælp nu." : "Jeg har brug for hjælp." }),
  sv: (e) => withTrigger(e, "sv", { title: `${e.kind === "urgent" ? "Akut SOS" : "SOS"} från ${e.phoneName}`, body: e.kind === "urgent" ? "Jag behöver hjälp nu." : "Jag behöver hjälp." }),
  nb: (e) => withTrigger(e, "nb", { title: `${e.kind === "urgent" ? "Akutt SOS" : "SOS"} fra ${e.phoneName}`, body: e.kind === "urgent" ? "Jeg trenger hjelp nå." : "Jeg trenger hjelp." }),
  de: (e) => withTrigger(e, "de", { title: `${e.kind === "urgent" ? "Dringendes SOS" : "SOS"} von ${e.phoneName}`, body: e.kind === "urgent" ? "Ich brauche jetzt Hilfe." : "Ich brauche Hilfe." }),
} satisfies Record<Locale, (e: PushFacts["sos"]) => Words>;

/** An ordinary quick message from the child's phone (docs/sos.md). */
const quickMessage = {
  en: (e) => ({ title: `${e.phoneName}: "${e.text}"`, body: "Quick message from the phone." }),
  da: (e) => ({ title: `${e.phoneName}: ”${e.text}”`, body: "Hurtigbesked fra telefonen." }),
  sv: (e) => ({ title: `${e.phoneName}: ”${e.text}”`, body: "Snabbmeddelande från telefonen." }),
  nb: (e) => ({ title: `${e.phoneName}: «${e.text}»`, body: "Hurtigmelding fra telefonen." }),
  de: (e) => ({ title: `${e.phoneName}: „${e.text}“`, body: "Schnellnachricht vom Handy." }),
} satisfies Record<Locale, (e: PushFacts["quickMessage"]) => Words>;

const quickSuggestion = {
  en: (e) => ({ title: `${e.phoneName} suggests a quick message`, body: `"${e.text}". Open the app to approve or decline.` }),
  da: (e) => ({ title: `${e.phoneName} foreslår en hurtigbesked`, body: `”${e.text}”. Åbn appen for at godkende eller afvise.` }),
  sv: (e) => ({ title: `${e.phoneName} föreslår ett snabbmeddelande`, body: `”${e.text}”. Öppna appen för att godkänna eller avslå.` }),
  nb: (e) => ({ title: `${e.phoneName} foreslår en hurtigmelding`, body: `«${e.text}». Åpne appen for å godkjenne eller avslå.` }),
  de: (e) => ({ title: `${e.phoneName} schlägt eine Schnellnachricht vor`, body: `„${e.text}“. Öffnen Sie die App, um zuzustimmen oder abzulehnen.` }),
} satisfies Record<Locale, (e: PushFacts["quickMessage"]) => Words>;

/** "I'm home" from the family inbox, without a position (docs/family-inbox.md). */
const checkIn = {
  en: (e) => ({ title: `${e.phoneName}: I'm home`, body: "Check-in from the family inbox." }),
  da: (e) => ({ title: `${e.phoneName}: Jeg er hjemme`, body: "Tjek ind fra familieindbakken." }),
  sv: (e) => ({ title: `${e.phoneName}: Jag är hemma`, body: "Incheckning från familjens inkorg." }),
  nb: (e) => ({ title: `${e.phoneName}: Jeg er hjemme`, body: "Innsjekk fra familieinnboksen." }),
  de: (e) => ({ title: `${e.phoneName}: Ich bin zu Hause`, body: "Check-in aus dem Familienpostfach." }),
} satisfies Record<Locale, (e: { phoneName: string }) => Words>;

/** The Self phone opened a blocked app for a short while; the trusted person is told, not asked. */
const emergencyOpening = {
  en: (e) => ({ title: `${e.phoneName}: emergency opening`, body: `${e.appName ?? "An app"} was opened for ${e.minutes} minutes. ${e.used} of ${e.allowance} used this month.` }),
  da: (e) => ({ title: `${e.phoneName}: nødåbning`, body: `${e.appName ?? "En app"} blev åbnet i ${e.minutes} minutter. ${e.used} af ${e.allowance} brugt denne måned.` }),
  sv: (e) => ({ title: `${e.phoneName}: nödöppning`, body: `${e.appName ?? "En app"} öppnades i ${e.minutes} minuter. ${e.used} av ${e.allowance} använda den här månaden.` }),
  nb: (e) => ({ title: `${e.phoneName}: nødåpning`, body: `${e.appName ?? "En app"} ble åpnet i ${e.minutes} minutter. ${e.used} av ${e.allowance} brukt denne måneden.` }),
  de: (e) => ({ title: `${e.phoneName}: Notöffnung`, body: `${e.appName ?? "Eine App"} wurde für ${e.minutes} Minuten geöffnet. ${e.used} von ${e.allowance} in diesem Monat genutzt.` }),
} satisfies Record<Locale, (e: PushFacts["emergencyOpening"]) => Words>;

const test = {
  en: { title: "Notifications work", body: "This device will get Plainphone notifications." },
  da: { title: "Notifikationer virker", body: "Denne enhed får notifikationer fra Plainphone." },
  sv: { title: "Aviseringar fungerar", body: "Den här enheten får aviseringar från Plainphone." },
  nb: { title: "Varsler fungerer", body: "Denne enheten får varsler fra Plainphone." },
  de: { title: "Benachrichtigungen funktionieren", body: "Dieses Gerät erhält Benachrichtigungen von Plainphone." },
} satisfies Record<Locale, Words>;

/** Every push message, one table each. The completeness test walks this. */
export const pushTables = { protection, offline, neverConnected, approval, request, requestOnPhone, moreTime, safety, sos, sosTrigger, quickMessage, quickSuggestion, checkIn, emergencyOpening, test };

export const pushWords = {
  protection: (e: PushFacts["protection"], l: Locale): Words => protection[l](e),
  offline: (e: PushFacts["offline"], l: Locale): Words => offline[l](e),
  neverConnected: (e: PushFacts["neverConnected"], l: Locale): Words => neverConnected[l](e),
  approval: (e: PushFacts["approval"], l: Locale): Words => approval[l](e),
  request: (e: PushFacts["request"], l: Locale): Words => request[l](e),
  requestOnPhone: (e: PushFacts["requestOnPhone"], l: Locale): Words => requestOnPhone[l](e),
  safety: (e: PushFacts["safety"], l: Locale): Words => safety[l](e),
  sos: (e: PushFacts["sos"], l: Locale): Words => sos[l](e),
  quickMessage: (e: PushFacts["quickMessage"], l: Locale): Words => quickMessage[l](e),
  quickSuggestion: (e: PushFacts["quickMessage"], l: Locale): Words => quickSuggestion[l](e),
  checkIn: (e: { phoneName: string }, l: Locale): Words => checkIn[l](e),
  emergencyOpening: (e: PushFacts["emergencyOpening"], l: Locale): Words => emergencyOpening[l](e),
  test: (l: Locale): Words => test[l],
  moreTime: (e: { phoneName: string; what: string | null; reason: string | null }, l: Locale): Words => {
    const m = moreTime[l];
    return {
      title: m.title(e.phoneName),
      body: `${e.what === null ? m.total : m.app(e.what)}${e.reason ? ` ${m.quote(e.reason)}` : ""} ${m.tail}`,
    };
  },
};

export const moreTimeActions = (l: Locale) => moreTime[l].actions;
