// SPDX-License-Identifier: Apache-2.0
import type { Mail } from "../providers/mail.js";

import type { Locale } from "./locale.js";
import { silence } from "./push-text.js";


function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The logo is the brand direction C lockup (docs/brand/README.md), rendered by
 * web/scripts/make-icons.mjs into web/public/mail/. Every instance serves it from its own
 * dashboard, so a self-hosted server shows the same logo without depending on plainphone.org.
 */
const logoUrl = (publicUrl: string, dark: boolean) =>
  `${publicUrl.replace(/\/+$/, "")}/mail/lockup${dark ? "-dark" : ""}@2x.png`;
/** Schibsted Grotesk where the reader has it, otherwise the system font. */
const FONT = "'Schibsted Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const privacyUrl = {
  en: "https://plainphone.org/privacy/",
  da: "https://plainphone.org/da/privacy/",
  sv: "https://plainphone.org/sv/privacy/",
  nb: "https://plainphone.org/nb/privacy/",
  de: "https://plainphone.org/de/privacy/",
} as const;
const privacyLabel = { en: "Privacy", da: "Privatliv", sv: "Integritet", nb: "Personvern", de: "Datenschutz" } as const;
const siteUrl = (locale: Locale) => `https://plainphone.org${locale === "en" ? "/" : `/${locale}/`}`;

interface LayoutInput {
  publicUrl: string;
  locale: Locale;
  preheader: string;
  heading: string;
  paragraphs: string[];
  /** Titled blocks of short lines after the paragraphs, for example one per phone. */
  sections?: { title: string; lines: string[] }[];
  button: { label: string; url: string };
  afterButton: string[];
  footer: string;
  /** Ink instead of signal green in dark (SOS): green only means "on", never alarm. */
  neutral?: boolean;
}

/**
 * The one layout every Plainphone mail uses: tables and inline styles for old
 * clients, a hosted 2x PNG logo, a bulletproof button, a preheader and dark mode.
 * Colours are the common tokens of brand direction C (docs/design-tokens.md): graphite
 * on paper in light, and in dark the signal green as the action colour, like the dashboard
 * (except `neutral` mails such as SOS, which keep an ink button).
 */
export function layout(input: LayoutInput): string {
  const logo = logoUrl(input.publicUrl, false);
  const logoDark = logoUrl(input.publicUrl, true);
  const n = input.neutral ? " pp-neutral" : "";
  const p = (text: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#141414;" class="pp-text">${esc(text)}</p>`;
  const section = (s: { title: string; lines: string[] }) =>
    `<h2 class="pp-heading" style="margin:24px 0 8px;font-size:17px;line-height:1.3;font-weight:700;color:#141414;">${esc(s.title)}</h2>\n    ${s.lines.map(p).join("\n    ")}`;
  const small = (text: string) =>
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#525252;" class="pp-muted">${esc(text)}</p>`;
  return `<!doctype html>
<html lang="${input.locale}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(input.heading)}</title>
<style>
  :root { color-scheme: light dark; }
  @media (prefers-color-scheme: dark) {
    .pp-body, .pp-outer { background:#0f0f0f !important; }
    .pp-card { background:#1b1b1b !important; border-color:#7c7c78 !important; }
    .pp-text, .pp-heading { color:#f2f2ef !important; }
    .pp-muted { color:#b3b3ae !important; }
    .pp-button { background:#c5f04a !important; }
    .pp-button a { color:#141414 !important; }
    .pp-link { color:#c5f04a !important; }
    .pp-button.pp-neutral { background:#f2f2ef !important; }
    .pp-link.pp-neutral { color:#f2f2ef !important; }
    .pp-logo-light { display:none !important; }
    .pp-logo-dark { display:block !important; max-height:none !important; overflow:visible !important; }
  }
  @media (max-width:600px) { .pp-card { padding:28px 20px !important; } }
</style>
</head>
<body class="pp-body" style="margin:0;padding:0;background:#f5f5f3;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(input.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="pp-outer" style="background:#f5f5f3;">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
  <tr><td style="padding:0 4px 20px;">
    <img src="${esc(logo)}" width="130" height="32" alt="Plainphone" class="pp-logo-light" style="display:block;border:0;outline:none;text-decoration:none;height:32px;width:130px;">
    <!--[if !mso]><!--><div class="pp-logo-dark" style="display:none;max-height:0;overflow:hidden;"><img src="${esc(logoDark)}" width="130" height="32" alt="Plainphone" style="display:block;border:0;outline:none;text-decoration:none;height:32px;width:130px;"></div><!--<![endif]-->
  </td></tr>
  <tr><td class="pp-card" style="background:#ffffff;border:1.5px solid #141414;border-radius:6px;padding:36px 32px;font-family:${FONT};">
    <h1 class="pp-heading" style="margin:0 0 20px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.01em;color:#141414;">${esc(input.heading)}</h1>
    ${input.paragraphs.map(p).join("\n    ")}
    ${(input.sections ?? []).map(section).join("\n    ")}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
    <tr><td class="pp-button${n}" bgcolor="#141414" style="border-radius:24px;background:#141414;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${esc(input.button.url)}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="50%" fillcolor="#141414" stroke="f"><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${esc(input.button.label)}</center></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="${esc(input.button.url)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:24px;font-family:${FONT};">${esc(input.button.label)}</a><!--<![endif]-->
    </td></tr>
    </table>
    ${input.afterButton.map(small).join("\n    ")}
    <p style="margin:0;font-size:13px;line-height:1.6;color:#525252;word-break:break-all;" class="pp-muted"><a href="${esc(input.button.url)}" class="pp-link${n}" style="color:#141414;">${esc(input.button.url)}</a></p>
  </td></tr>
  <tr><td style="padding:20px 4px 0;font-family:${FONT};">
    <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#525252;" class="pp-muted">${esc(input.footer)}</p>
    <p style="margin:0;font-size:12px;line-height:1.6;color:#525252;" class="pp-muted"><a href="${privacyUrl[input.locale]}" class="pp-link${n}" style="color:#141414;">${privacyLabel[input.locale]}</a> &middot; <a href="${siteUrl(input.locale)}" class="pp-link${n}" style="color:#141414;">plainphone.org</a></p>
  </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

export function text(input: LayoutInput): string {
  return [
    input.heading,
    "",
    ...input.paragraphs.flatMap((s) => [s, ""]),
    ...(input.sections ?? []).flatMap((s) => [s.title, ...s.lines.map((l) => `- ${l}`), ""]),
    `${input.button.label}: ${input.button.url}`,
    "",
    ...input.afterButton.flatMap((s) => [s, ""]),
    "--",
    input.footer,
    `${privacyLabel[input.locale]}: ${privacyUrl[input.locale]}`,
  ].join("\n");
}

export function build(to: string, subject: string, input: LayoutInput): Mail {
  return { to, subject, html: layout(input), text: text(input) };
}

export const footer = {
  en: "Plainphone is free and open source. You get this mail because someone entered this address on Plainphone.",
  da: "Plainphone er gratis og open source. Du får denne mail, fordi nogen har skrevet din adresse på Plainphone.",
  sv: "Plainphone är gratis och öppen källkod. Du får det här mejlet eftersom någon har angett den här adressen på Plainphone.",
  nb: "Plainphone er gratis og åpen kildekode. Du får denne e-posten fordi noen har skrevet inn denne adressen på Plainphone.",
  de: "Plainphone ist kostenlos und Open Source. Sie erhalten diese Mail, weil jemand diese Adresse bei Plainphone eingegeben hat.",
} satisfies Record<Locale, string>;

interface LoginWords {
  subject: string;
  preheader: (minutes: number) => string;
  heading: string;
  paragraph: string;
  button: string;
  ignore: string;
}

/** The sign-in mail. */
export const loginText = {
  en: {
    subject: "Your Plainphone sign-in link",
    preheader: (m) => `The link works for ${m} minutes and only once.`,
    heading: "Sign in to Plainphone",
    paragraph: "Press the button to sign in. You do not need a password.",
    button: "Sign in",
    ignore: "If you did not ask to sign in, you can ignore this mail. Nothing happens to your account.",
  },
  da: {
    subject: "Dit login til Plainphone",
    preheader: (m) => `Linket virker i ${m} minutter og kun én gang.`,
    heading: "Log ind på Plainphone",
    paragraph: "Tryk på knappen for at logge ind. Du skal ikke bruge en adgangskode.",
    button: "Log ind",
    ignore: "Har du ikke bedt om at logge ind, kan du se bort fra mailen. Der sker ikke noget med din konto.",
  },
  sv: {
    subject: "Din inloggningslänk till Plainphone",
    preheader: (m) => `Länken fungerar i ${m} minuter och bara en gång.`,
    heading: "Logga in på Plainphone",
    paragraph: "Tryck på knappen för att logga in. Du behöver inget lösenord.",
    button: "Logga in",
    ignore: "Om du inte har bett om att logga in kan du bortse från mejlet. Inget händer med ditt konto.",
  },
  nb: {
    subject: "Innloggingslenken din til Plainphone",
    preheader: (m) => `Lenken virker i ${m} minutter og bare én gang.`,
    heading: "Logg inn på Plainphone",
    paragraph: "Trykk på knappen for å logge inn. Du trenger ikke passord.",
    button: "Logg inn",
    ignore: "Hvis du ikke har bedt om å logge inn, kan du se bort fra e-posten. Ingenting skjer med kontoen din.",
  },
  de: {
    subject: "Ihr Anmeldelink für Plainphone",
    preheader: (m) => `Der Link gilt ${m} Minuten und nur einmal.`,
    heading: "Bei Plainphone anmelden",
    paragraph: "Tippen Sie auf die Schaltfläche, um sich anzumelden. Sie brauchen kein Passwort.",
    button: "Anmelden",
    ignore: "Wenn Sie sich nicht anmelden wollten, können Sie diese Mail ignorieren. Mit Ihrem Konto passiert nichts.",
  },
} satisfies Record<Locale, LoginWords>;

export function loginMail(to: string, locale: Locale, publicUrl: string, url: string, minutes: number): Mail {
  const t = loginText[locale];
  return build(to, t.subject, {
    publicUrl,
    locale,
    preheader: t.preheader(minutes),
    heading: t.heading,
    paragraphs: [t.paragraph],
    button: { label: t.button, url },
    afterButton: [t.preheader(minutes), t.ignore],
    footer: footer[locale],
  });
}

interface InviteWords {
  subject: Record<"parent" | "trusted", string>;
  paragraphs: Record<"parent" | "trusted", string[]>;
  button: string;
  expires: (days: number) => string;
  signIn: string;
  unknownSender: string;
}

/** The invitation mails: a second parent, or a trusted person. */
export const inviteText = {
  en: {
    subject: { parent: "You are invited to a household on Plainphone", trusted: "You have been chosen as a trusted person on Plainphone" },
    paragraphs: {
      parent: ["Another parent has invited you, so you can both see and change the rules for your phones."],
      trusted: [
        "An adult uses Plainphone for a calmer phone and has chosen you as their trusted person.",
        "When they want to loosen a rule, for example show a hidden app, you get a request. The change only happens when you say yes.",
      ],
    },
    button: "See the invitation",
    expires: (d) => `The invitation expires in ${d} days.`,
    signIn: "Sign in with this email address to see the requests.",
    unknownSender: "If you do not know the sender, you can ignore this mail.",
  },
  da: {
    subject: { parent: "Du er inviteret til en husstand på Plainphone", trusted: "Du er blevet valgt som betroet person på Plainphone" },
    paragraphs: {
      parent: ["En anden forælder har inviteret dig, så I begge kan se og ændre reglerne for jeres telefoner."],
      trusted: [
        "En voksen bruger Plainphone til at få en roligere telefon og har valgt dig som betroet person.",
        "Når personen vil løsne en regel, fx vise en skjult app, får du en anmodning. Ændringen sker først, når du har sagt ja.",
      ],
    },
    button: "Se invitationen",
    expires: (d) => `Invitationen udløber om ${d} dage.`,
    signIn: "Log ind med denne mailadresse for at se anmodningerne.",
    unknownSender: "Kender du ikke afsenderen, kan du se bort fra mailen.",
  },
  sv: {
    subject: { parent: "Du är inbjuden till ett hushåll på Plainphone", trusted: "Du har blivit vald som betrodd person på Plainphone" },
    paragraphs: {
      parent: ["En annan förälder har bjudit in dig, så att ni båda kan se och ändra reglerna för era telefoner."],
      trusted: [
        "En vuxen använder Plainphone för en lugnare telefon och har valt dig som betrodd person.",
        "När personen vill lätta på en regel, till exempel visa en dold app, får du en förfrågan. Ändringen sker först när du har sagt ja.",
      ],
    },
    button: "Visa inbjudan",
    expires: (d) => `Inbjudan går ut om ${d} dagar.`,
    signIn: "Logga in med den här e-postadressen för att se förfrågningarna.",
    unknownSender: "Känner du inte avsändaren kan du bortse från mejlet.",
  },
  nb: {
    subject: { parent: "Du er invitert til en husstand på Plainphone", trusted: "Du er valgt som betrodd person på Plainphone" },
    paragraphs: {
      parent: ["En annen forelder har invitert deg, slik at dere begge kan se og endre reglene for telefonene deres."],
      trusted: [
        "En voksen bruker Plainphone for en roligere telefon og har valgt deg som betrodd person.",
        "Når personen vil løsne en regel, for eksempel vise en skjult app, får du en forespørsel. Endringen skjer først når du har sagt ja.",
      ],
    },
    button: "Se invitasjonen",
    expires: (d) => `Invitasjonen utløper om ${d} dager.`,
    signIn: "Logg inn med denne e-postadressen for å se forespørslene.",
    unknownSender: "Kjenner du ikke avsenderen, kan du se bort fra e-posten.",
  },
  de: {
    subject: { parent: "Sie sind zu einem Haushalt bei Plainphone eingeladen", trusted: "Sie wurden als Vertrauensperson bei Plainphone ausgewählt" },
    paragraphs: {
      parent: ["Ein anderer Elternteil hat Sie eingeladen, damit Sie beide die Regeln für Ihre Handys sehen und ändern können."],
      trusted: [
        "Eine erwachsene Person nutzt Plainphone für ein ruhigeres Handy und hat Sie als Vertrauensperson ausgewählt.",
        "Wenn die Person eine Regel lockern möchte, zum Beispiel eine versteckte App anzeigen, bekommen Sie eine Anfrage. Die Änderung passiert erst, wenn Sie Ja gesagt haben.",
      ],
    },
    button: "Einladung ansehen",
    expires: (d) => `Die Einladung läuft in ${d} Tagen ab.`,
    signIn: "Melden Sie sich mit dieser E-Mail-Adresse an, um die Anfragen zu sehen.",
    unknownSender: "Wenn Sie den Absender nicht kennen, können Sie diese Mail ignorieren.",
  },
} satisfies Record<Locale, InviteWords>;

export function inviteMail(
  to: string,
  locale: Locale,
  publicUrl: string,
  url: string,
  kind: "parent" | "trusted",
  days: number,
): Mail {
  const t = inviteText[locale];
  const paragraphs = t.paragraphs[kind];
  return build(to, t.subject[kind], {
    publicUrl,
    locale,
    preheader: paragraphs[0]!,
    heading: t.subject[kind],
    paragraphs,
    button: { label: t.button, url },
    afterButton: [kind === "parent" ? t.expires(days) : t.signIn, t.unknownSender],
    footer: footer[locale],
  });
}

interface ApprovalWords {
  subject: string;
  paragraphs: (phoneName: string) => string[];
  button: string;
  after: string;
}

/** To the trusted person: a Self-profile owner asks to loosen a rule (spec 11, D12). */
export const approvalRequestText = {
  en: {
    subject: "A request is waiting for your answer",
    paragraphs: (n) => [
      `The phone "${n}" wants to loosen a rule. You are the trusted person, so the change only happens when you say yes.`,
      "Open Plainphone to see what would change, and answer yes or no.",
    ],
    button: "See the request",
    after: "It is fine to say no. If you are unsure, talk to the person first.",
  },
  da: {
    subject: "En anmodning venter på dit svar",
    paragraphs: (n) => [
      `Telefonen "${n}" vil løsne en regel. Du er valgt som betroet person, så ændringen sker først, når du har sagt ja.`,
      "Åbn Plainphone for at se, hvad der skal ændres, og svar ja eller nej.",
    ],
    button: "Se anmodningen",
    after: "Det er helt i orden at sige nej. Hvis du er i tvivl, så tal med personen først.",
  },
  sv: {
    subject: "En förfrågan väntar på ditt svar",
    paragraphs: (n) => [
      `Telefonen "${n}" vill lätta på en regel. Du är vald som betrodd person, så ändringen sker först när du har sagt ja.`,
      "Öppna Plainphone för att se vad som ska ändras och svara ja eller nej.",
    ],
    button: "Visa förfrågan",
    after: "Det är helt okej att säga nej. Om du är osäker, prata med personen först.",
  },
  nb: {
    subject: "En forespørsel venter på svaret ditt",
    paragraphs: (n) => [
      `Telefonen "${n}" vil løsne en regel. Du er valgt som betrodd person, så endringen skjer først når du har sagt ja.`,
      "Åpne Plainphone for å se hva som skal endres, og svar ja eller nei.",
    ],
    button: "Se forespørselen",
    after: "Det er helt greit å si nei. Hvis du er usikker, snakk med personen først.",
  },
  de: {
    subject: "Eine Anfrage wartet auf Ihre Antwort",
    paragraphs: (n) => [
      `Das Handy "${n}" möchte eine Regel lockern. Sie sind die Vertrauensperson, die Änderung passiert also erst, wenn Sie Ja gesagt haben.`,
      "Öffnen Sie Plainphone, um zu sehen, was sich ändern würde, und antworten Sie mit Ja oder Nein.",
    ],
    button: "Anfrage ansehen",
    after: "Es ist völlig in Ordnung, Nein zu sagen. Wenn Sie unsicher sind, sprechen Sie zuerst mit der Person.",
  },
} satisfies Record<Locale, ApprovalWords>;

export function approvalRequestMail(to: string, locale: Locale, publicUrl: string, phoneName: string): Mail {
  const t = approvalRequestText[locale];
  const paragraphs = t.paragraphs(phoneName);
  return build(to, t.subject, {
    publicUrl,
    locale,
    preheader: paragraphs[0]!,
    heading: t.subject,
    paragraphs,
    button: { label: t.button, url: `${publicUrl}/approvals` },
    afterButton: [t.after],
    footer: footer[locale],
  });
}

interface AlertWords {
  protectionSubject: (name: string) => string;
  undone: (name: string) => string;
  owner: (name: string) => string;
  lock: (name: string) => string;
  lookInApp: string;
  offlineSubject: (name: string, silence: string) => string;
  offline: (name: string, lastSeen: string) => string;
  rulesStillApply: string;
  late: string;
  open: string;
  openPhone: string;
  turnOff: string;
}

/** A phone's protection was removed, or it has been silent for long (issue #22). Calm, not alarming. */
export const phoneAlertText = {
  en: {
    protectionSubject: (n) => `Protection removed on ${n}`,
    undone: (n) => `Set-up was undone on the phone "${n}".`,
    owner: (n) => `Plainphone no longer controls the phone "${n}". That happens when the app is removed as device owner.`,
    lock: (n) => `The lock on the phone "${n}" is no longer intact. One of its steps does not work, for example because the default phone app was changed.`,
    lookInApp: "Open Plainphone to see what the phone reports. Often it is enough to open Plainphone on the phone.",
    offlineSubject: (n, s) => `${n} has not been in touch for ${s}`,
    offline: (n, l) => `The phone "${n}" was last in touch ${l}. It may be switched off, out of battery or reset.`,
    rulesStillApply: "The rules still apply on the phone, also without a network. You will hear from us again if it goes quiet another time.",
    late: "The phone reported late.",
    open: "Open Plainphone",
    openPhone: "Open the phone",
    turnOff: "You can turn these messages off for this phone under Settings in Plainphone.",
  },
  da: {
    protectionSubject: (n) => `Beskyttelsen er fjernet på ${n}`,
    undone: (n) => `Opsætningen blev fortrudt på telefonen "${n}".`,
    owner: (n) => `Plainphone styrer ikke længere telefonen "${n}". Det sker, hvis appen er fjernet som enhedsejer.`,
    lock: (n) => `Låsen på telefonen "${n}" er ikke længere intakt. Et af låsens trin virker ikke, fx hvis standardtelefonappen er skiftet.`,
    lookInApp: "Åbn Plainphone for at se, hvad telefonen melder. Ofte er det nok at åbne Plainphone på telefonen.",
    offlineSubject: (n, s) => `${n} har ikke været i kontakt i ${s}`,
    offline: (n, l) => `Telefonen "${n}" var sidst i kontakt ${l}. Den kan være slukket, løbet tør for strøm eller nulstillet.`,
    rulesStillApply: "Reglerne gælder stadig på telefonen, også uden net. Du får besked igen, hvis den tier en anden gang.",
    late: "Telefonen rapporterede det med forsinkelse.",
    open: "Åbn Plainphone",
    openPhone: "Åbn telefonen",
    turnOff: "Du kan slå disse beskeder fra for telefonen under Indstillinger i Plainphone.",
  },
  sv: {
    protectionSubject: (n) => `Skyddet har tagits bort på ${n}`,
    undone: (n) => `Inställningen ångrades på telefonen "${n}".`,
    owner: (n) => `Plainphone styr inte längre telefonen "${n}". Det händer om appen tas bort som enhetsägare.`,
    lock: (n) => `Låset på telefonen "${n}" är inte längre intakt. Ett av låsets steg fungerar inte, till exempel om standardtelefonappen har ändrats.`,
    lookInApp: "Öppna Plainphone för att se vad telefonen rapporterar. Ofta räcker det att öppna Plainphone på telefonen.",
    offlineSubject: (n, s) => `${n} har inte hörts av på ${s}`,
    offline: (n, l) => `Telefonen "${n}" hördes senast av ${l}. Den kan vara avstängd, ha slut på batteri eller ha återställts.`,
    rulesStillApply: "Reglerna gäller fortfarande på telefonen, även utan nät. Du får besked igen om den tystnar en annan gång.",
    late: "Telefonen rapporterade det med fördröjning.",
    open: "Öppna Plainphone",
    openPhone: "Öppna telefonen",
    turnOff: "Du kan stänga av de här meddelandena för telefonen under Inställningar i Plainphone.",
  },
  nb: {
    protectionSubject: (n) => `Beskyttelsen er fjernet på ${n}`,
    undone: (n) => `Oppsettet ble angret på telefonen "${n}".`,
    owner: (n) => `Plainphone styrer ikke lenger telefonen "${n}". Det skjer hvis appen fjernes som enhetseier.`,
    lock: (n) => `Låsen på telefonen "${n}" er ikke lenger intakt. Ett av trinnene i låsen fungerer ikke, for eksempel hvis standard telefonapp er byttet.`,
    lookInApp: "Åpne Plainphone for å se hva telefonen melder. Ofte er det nok å åpne Plainphone på telefonen.",
    offlineSubject: (n, s) => `${n} har ikke vært i kontakt på ${s}`,
    offline: (n, l) => `Telefonen "${n}" var sist i kontakt ${l}. Den kan være slått av, tom for strøm eller tilbakestilt.`,
    rulesStillApply: "Reglene gjelder fortsatt på telefonen, også uten nett. Du får beskjed igjen hvis den blir stille en annen gang.",
    late: "Telefonen rapporterte det med forsinkelse.",
    open: "Åpne Plainphone",
    openPhone: "Åpne telefonen",
    turnOff: "Du kan slå av disse meldingene for telefonen under Innstillinger i Plainphone.",
  },
  de: {
    protectionSubject: (n) => `Schutz auf ${n} entfernt`,
    undone: (n) => `Die Einrichtung wurde auf dem Handy "${n}" rückgängig gemacht.`,
    owner: (n) => `Plainphone steuert das Handy "${n}" nicht mehr. Das passiert, wenn die App als Geräteeigentümer entfernt wird.`,
    lock: (n) => `Die Sperre auf dem Handy "${n}" ist nicht mehr intakt. Einer ihrer Schritte funktioniert nicht, zum Beispiel weil die Standard-Telefon-App geändert wurde.`,
    lookInApp: "Öffnen Sie Plainphone, um zu sehen, was das Handy meldet. Oft genügt es, Plainphone auf dem Handy zu öffnen.",
    offlineSubject: (n, s) => `${n} war ${s} lang nicht erreichbar`,
    offline: (n, l) => `Das Handy "${n}" hatte zuletzt Kontakt (${l}). Es kann ausgeschaltet, leer oder zurückgesetzt worden sein.`,
    rulesStillApply: "Die Regeln gelten auf dem Handy weiterhin, auch ohne Netz. Sie hören wieder von uns, falls es ein anderes Mal verstummt.",
    late: "Das Handy hat es verspätet gemeldet.",
    open: "Plainphone öffnen",
    openPhone: "Handy öffnen",
    turnOff: "Sie können diese Meldungen für das Handy in Plainphone unter Einstellungen ausschalten.",
  },
} satisfies Record<Locale, AlertWords>;

export function phoneAlertMail(
  to: string,
  locale: Locale,
  publicUrl: string,
  alert:
    | { kind: "protection"; phoneId: string; phoneName: string; reason: "lock" | "owner" | "setup-undo"; reportedLate?: boolean; trusted?: boolean }
    | { kind: "offline"; phoneId: string; phoneName: string; hours: number; lastSeen: string },
): Mail {
  const t = phoneAlertText[locale];
  const name = alert.phoneName;
  let subject: string;
  let paragraphs: string[];
  if (alert.kind === "protection") {
    subject = t.protectionSubject(name);
    paragraphs = alert.reason === "setup-undo"
      ? [t.undone(name)]
      : [alert.reason === "owner" ? t.owner(name) : t.lock(name), t.lookInApp];
  } else {
    subject = t.offlineSubject(name, silence(alert.hours, locale));
    paragraphs = [t.offline(name, alert.lastSeen), t.rulesStillApply];
  }
  const undone = alert.kind === "protection" && alert.reason === "setup-undo";
  if (undone && alert.reportedLate) paragraphs.push(t.late);
  return build(to, subject, {
    publicUrl,
    locale,
    preheader: paragraphs[0]!,
    heading: subject,
    paragraphs,
    button: alert.kind === "protection" && alert.trusted
      ? { label: t.open, url: `${publicUrl}/approvals` }
      : undone
        ? { label: t.open, url: publicUrl }
        : { label: t.openPhone, url: `${publicUrl}/phones/${alert.phoneId}` },
    afterButton: undone || (alert.kind === "protection" && alert.trusted) ? [] : [t.turnOff],
    footer: footer[locale],
  });
}

/** The label of the one button on an SOS mail. */
export const sosButton = {
  en: "Open SOS in Plainphone",
  da: "Åbn SOS i Plainphone",
  sv: "Öppna SOS i Plainphone",
  nb: "Åpne SOS i Plainphone",
  de: "SOS in Plainphone öffnen",
} satisfies Record<Locale, string>;

export function sosMail(to: string, locale: Locale, publicUrl: string, phoneId: string, heading: string, message: string): Mail {
  return build(to, heading, {
    publicUrl, locale, preheader: message, heading,
    paragraphs: [message],
    button: { label: sosButton[locale], url: new URL(`/phones/${phoneId}`, publicUrl).href },
    afterButton: [],
    neutral: true,
    footer: footer[locale],
  });
}
