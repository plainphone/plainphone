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
 * Logo and mark live on the project site, so every instance (also self-hosted ones)
 * shows the same wordmark: ink on paper, like plainphone.org.
 */
const BRAND_ASSETS = "https://plainphone.org/mail";
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
}

/**
 * The one layout every Plainphone mail uses: tables and inline styles for old
 * clients, a hosted 2x PNG logo, a bulletproof button, a preheader and dark mode.
 */
export function layout(input: LayoutInput): string {
  const logo = `${BRAND_ASSETS}/logo@2x.png`;
  const logoDark = `${BRAND_ASSETS}/logo-dark@2x.png`;
  const p = (text: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1d2a30;" class="pp-text">${esc(text)}</p>`;
  const small = (text: string) =>
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#4c5a60;" class="pp-muted">${esc(text)}</p>`;
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
    .pp-body, .pp-outer { background:#121a1e !important; }
    .pp-card { background:#172025 !important; border-color:#34433f !important; }
    .pp-text, .pp-heading { color:#e3e8e4 !important; }
    .pp-muted { color:#a5b1b3 !important; }
    .pp-button { background:#e3e8e4 !important; }
    .pp-button a { color:#172025 !important; }
    .pp-link { color:#93c9de !important; }
    .pp-logo-light { display:none !important; }
    .pp-logo-dark { display:block !important; max-height:none !important; overflow:visible !important; }
  }
  @media (max-width:600px) { .pp-card { padding:28px 20px !important; } }
</style>
</head>
<body class="pp-body" style="margin:0;padding:0;background:#e8ece8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(input.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="pp-outer" style="background:#e8ece8;">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
  <tr><td style="padding:0 4px 20px;">
    <img src="${logo}" width="158" height="24" alt="Plainphone" class="pp-logo-light" style="display:block;border:0;outline:none;text-decoration:none;height:24px;width:158px;">
    <!--[if !mso]><!--><div class="pp-logo-dark" style="display:none;max-height:0;overflow:hidden;"><img src="${logoDark}" width="158" height="24" alt="Plainphone" style="display:block;border:0;outline:none;text-decoration:none;height:24px;width:158px;"></div><!--<![endif]-->
  </td></tr>
  <tr><td class="pp-card" style="background:#f8f9f7;border:1px solid #c3cbc7;border-radius:6px;padding:36px 32px;font-family:'Atkinson Hyperlegible Next',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <h1 class="pp-heading" style="margin:0 0 20px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.01em;color:#1d2a30;">${esc(input.heading)}</h1>
    ${input.paragraphs.map(p).join("\n    ")}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
    <tr><td class="pp-button" bgcolor="#1d2a30" style="border-radius:6px;background:#1d2a30;">
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${esc(input.button.url)}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="12%" fillcolor="#1d2a30" stroke="f"><center style="color:#f3f5f2;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${esc(input.button.label)}</center></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="${esc(input.button.url)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;line-height:20px;color:#f3f5f2;text-decoration:none;border-radius:6px;font-family:'Atkinson Hyperlegible Next',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${esc(input.button.label)}</a><!--<![endif]-->
    </td></tr>
    </table>
    ${input.afterButton.map(small).join("\n    ")}
    <p style="margin:0;font-size:13px;line-height:1.6;color:#4c5a60;word-break:break-all;" class="pp-muted"><a href="${esc(input.button.url)}" class="pp-link" style="color:#1d5870;">${esc(input.button.url)}</a></p>
  </td></tr>
  <tr><td style="padding:20px 4px 0;font-family:'Atkinson Hyperlegible Next',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#4c5a60;" class="pp-muted">${esc(input.footer)}</p>
    <p style="margin:0;font-size:12px;line-height:1.6;color:#4c5a60;" class="pp-muted"><a href="${privacyUrl[input.locale]}" class="pp-link" style="color:#1d5870;">${privacyLabel[input.locale]}</a> &middot; <a href="https://plainphone.org${input.locale === "da" ? "/da/" : "/"}" class="pp-link" style="color:#1d5870;">plainphone.org</a></p>
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
