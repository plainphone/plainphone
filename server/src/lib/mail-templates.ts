// SPDX-License-Identifier: Apache-2.0
import type { Mail } from "../providers/mail.js";

export type Locale = "en" | "da";

export function toLocale(value: string | undefined | null): Locale {
  return value?.toLowerCase().startsWith("da") ? "da" : "en";
}

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
const privacyUrl = { en: "https://plainphone.org/privacy/", da: "https://plainphone.org/da/privacy/" } as const;
const privacyLabel = { en: "Privacy", da: "Privatliv" } as const;

interface LayoutInput {
  publicUrl: string;
  locale: Locale;
  preheader: string;
  heading: string;
  paragraphs: string[];
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
    <p style="margin:0;font-size:12px;line-height:1.6;color:#525252;" class="pp-muted"><a href="${privacyUrl[input.locale]}" class="pp-link${n}" style="color:#141414;">${privacyLabel[input.locale]}</a> &middot; <a href="https://plainphone.org${input.locale === "da" ? "/da/" : "/"}" class="pp-link${n}" style="color:#141414;">plainphone.org</a></p>
  </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

function text(input: LayoutInput): string {
  return [
    input.heading,
    "",
    ...input.paragraphs.flatMap((s) => [s, ""]),
    `${input.button.label}: ${input.button.url}`,
    "",
    ...input.afterButton.flatMap((s) => [s, ""]),
    "--",
    input.footer,
    `${privacyLabel[input.locale]}: ${privacyUrl[input.locale]}`,
  ].join("\n");
}

function build(to: string, subject: string, input: LayoutInput): Mail {
  return { to, subject, html: layout(input), text: text(input) };
}

const footer = {
  en: "Plainphone is free and open source. You get this mail because someone entered this address on Plainphone.",
  da: "Plainphone er gratis og open source. Du får denne mail, fordi nogen har skrevet din adresse på Plainphone.",
};

export function loginMail(to: string, locale: Locale, publicUrl: string, url: string, minutes: number): Mail {
  const t =
    locale === "da"
      ? {
          subject: "Dit login til Plainphone",
          preheader: `Linket virker i ${minutes} minutter og kun én gang.`,
          heading: "Log ind på Plainphone",
          paragraphs: ["Tryk på knappen for at logge ind. Du skal ikke bruge en adgangskode."],
          button: "Log ind",
          after: [
            `Linket virker i ${minutes} minutter og kun én gang.`,
            "Har du ikke bedt om at logge ind, kan du se bort fra mailen. Der sker ikke noget med din konto.",
          ],
        }
      : {
          subject: "Your Plainphone sign-in link",
          preheader: `The link works for ${minutes} minutes and only once.`,
          heading: "Sign in to Plainphone",
          paragraphs: ["Press the button to sign in. You do not need a password."],
          button: "Sign in",
          after: [
            `The link works for ${minutes} minutes and only once.`,
            "If you did not ask to sign in, you can ignore this mail. Nothing happens to your account.",
          ],
        };
  return build(to, t.subject, {
    publicUrl,
    locale,
    preheader: t.preheader,
    heading: t.heading,
    paragraphs: t.paragraphs,
    button: { label: t.button, url },
    afterButton: t.after,
    footer: footer[locale],
  });
}

export function inviteMail(
  to: string,
  locale: Locale,
  publicUrl: string,
  url: string,
  kind: "parent" | "trusted",
  days: number,
): Mail {
  const da = locale === "da";
  const subject =
    kind === "parent"
      ? da
        ? "Du er inviteret til en husstand på Plainphone"
        : "You are invited to a household on Plainphone"
      : da
        ? "Du er blevet valgt som betroet person på Plainphone"
        : "You have been chosen as a trusted person on Plainphone";
  const paragraphs =
    kind === "parent"
      ? da
        ? ["En anden forælder har inviteret dig, så I begge kan se og ændre reglerne for jeres telefoner."]
        : ["Another parent has invited you, so you can both see and change the rules for your phones."]
      : da
        ? [
            "En voksen bruger Plainphone til at få en roligere telefon og har valgt dig som betroet person.",
            "Når personen vil løsne en regel, fx vise en skjult app, får du en anmodning. Ændringen sker først, når du har sagt ja.",
          ]
        : [
            "An adult uses Plainphone for a calmer phone and has chosen you as their trusted person.",
            "When they want to loosen a rule, for example show a hidden app, you get a request. The change only happens when you say yes.",
          ];
  return build(to, subject, {
    publicUrl,
    locale,
    preheader: paragraphs[0]!,
    heading: subject,
    paragraphs,
    button: { label: da ? "Se invitationen" : "See the invitation", url },
    afterButton: [
      ...(kind === "parent"
        ? [da ? `Invitationen udløber om ${days} dage.` : `The invitation expires in ${days} days.`]
        : [da ? "Log ind med denne mailadresse for at se anmodningerne." : "Sign in with this email address to see the requests."]),
      da
        ? "Kender du ikke afsenderen, kan du se bort fra mailen."
        : "If you do not know the sender, you can ignore this mail.",
    ],
    footer: footer[locale],
  });
}

/** To the trusted person: a Self-profile owner asks to loosen a rule (spec 11, D12). */
export function approvalRequestMail(to: string, locale: Locale, publicUrl: string, phoneName: string): Mail {
  const da = locale === "da";
  const subject = da ? "En anmodning venter på dit svar" : "A request is waiting for your answer";
  const paragraphs = da
    ? [
        `Telefonen "${phoneName}" vil løsne en regel. Du er valgt som betroet person, så ændringen sker først, når du har sagt ja.`,
        "Åbn Plainphone for at se, hvad der skal ændres, og svar ja eller nej.",
      ]
    : [
        `The phone "${phoneName}" wants to loosen a rule. You are the trusted person, so the change only happens when you say yes.`,
        "Open Plainphone to see what would change, and answer yes or no.",
      ];
  return build(to, subject, {
    publicUrl,
    locale,
    preheader: paragraphs[0]!,
    heading: subject,
    paragraphs,
    button: { label: da ? "Se anmodningen" : "See the request", url: `${publicUrl}/approvals` },
    afterButton: [
      da
        ? "Det er helt i orden at sige nej. Hvis du er i tvivl, så tal med personen først."
        : "It is fine to say no. If you are unsure, talk to the person first.",
    ],
    footer: footer[locale],
  });
}

/** A phone's protection was removed, or it has been silent for long (issue #22). Calm, not alarming. */
export function phoneAlertMail(
  to: string,
  locale: Locale,
  publicUrl: string,
  alert:
    | { kind: "protection"; phoneId: string; phoneName: string; reason: "lock" | "owner" | "setup-undo"; reportedLate?: boolean; trusted?: boolean }
    | { kind: "offline"; phoneId: string; phoneName: string; hours: number; lastSeen: string },
): Mail {
  const da = locale === "da";
  const name = alert.phoneName;
  let subject: string;
  let paragraphs: string[];
  if (alert.kind === "protection") {
    subject = da ? `Beskyttelsen er fjernet på ${name}` : `Protection removed on ${name}`;
    paragraphs = alert.reason === "setup-undo"
      ? [da ? `Opsætningen blev fortrudt på telefonen "${name}".` : `Set-up was undone on the phone "${name}".`]
      : da
        ? [
            alert.reason === "owner"
              ? `Plainphone styrer ikke længere telefonen "${name}". Det sker, hvis appen er fjernet som enhedsejer.`
              : `Låsen på telefonen "${name}" er ikke længere intakt. Et af låsens trin virker ikke, fx hvis standardtelefonappen er skiftet.`,
            "Åbn Plainphone for at se, hvad telefonen melder. Ofte er det nok at åbne Plainphone på telefonen.",
          ]
        : [
            alert.reason === "owner"
              ? `Plainphone no longer controls the phone "${name}". That happens when the app is removed as device owner.`
              : `The lock on the phone "${name}" is no longer intact. One of its steps does not work, for example because the default phone app was changed.`,
            "Open Plainphone to see what the phone reports. Often it is enough to open Plainphone on the phone.",
          ];
  } else {
    subject = da ? `${name} har ikke været i kontakt i ${alert.hours} timer` : `${name} has not been in touch for ${alert.hours} hours`;
    paragraphs = da
      ? [
          `Telefonen "${name}" var sidst i kontakt ${alert.lastSeen}. Den kan være slukket, løbet tør for strøm eller nulstillet.`,
          "Reglerne gælder stadig på telefonen, også uden net. Du får besked igen, hvis den tier en anden gang.",
        ]
      : [
          `The phone "${name}" was last in touch ${alert.lastSeen}. It may be switched off, out of battery or reset.`,
          "The rules still apply on the phone, also without a network. You will hear from us again if it goes quiet another time.",
        ];
  }
  const undone = alert.kind === "protection" && alert.reason === "setup-undo";
  if (undone && alert.reportedLate) {
    paragraphs.push(da ? "Telefonen rapporterede det med forsinkelse." : "The phone reported late.");
  }
  return build(to, subject, {
    publicUrl,
    locale,
    preheader: paragraphs[0]!,
    heading: subject,
    paragraphs,
    button: alert.kind === "protection" && alert.trusted
      ? { label: da ? "Åbn Plainphone" : "Open Plainphone", url: `${publicUrl}/approvals` }
      : undone
        ? { label: da ? "Åbn Plainphone" : "Open Plainphone", url: publicUrl }
        : { label: da ? "Åbn telefonen" : "Open the phone", url: `${publicUrl}/phones/${alert.phoneId}` },
    afterButton: undone || (alert.kind === "protection" && alert.trusted) ? [] : [
      da
        ? "Du kan slå disse beskeder fra for telefonen under Indstillinger i Plainphone."
        : "You can turn these messages off for this phone under Settings in Plainphone.",
    ],
    footer: footer[locale],
  });
}

export function sosMail(to: string, locale: Locale, publicUrl: string, phoneId: string, heading: string, message: string): Mail {
  return build(to, heading, {
    publicUrl, locale, preheader: message, heading,
    paragraphs: [message],
    button: { label: locale === "da" ? "Åbn SOS i Plainphone" : "Open SOS in Plainphone", url: new URL(`/phones/${phoneId}`, publicUrl).href },
    afterButton: [],
    neutral: true,
    footer: footer[locale],
  });
}
