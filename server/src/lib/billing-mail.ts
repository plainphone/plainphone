// SPDX-License-Identifier: Apache-2.0
//
// Durable receipts for a paid early unlock (docs/billing.md): one when it is bought, with the
// consent to start early and where to withdraw, and one when it is withdrawn. Plain words,
// no pressure and no charity wording.

import type { Mail } from "../providers/mail.js";
import { INTL_LOCALE, type Locale } from "./locale.js";
import { build, footer } from "./mail-templates.js";

interface ReceiptRow {
  id: string;
  phoneId: string | null;
  amount: number;
  currency: string;
  consentAt: Date;
  paidAt: Date | null;
  unlockAt: Date | null;
  withdrawnAt: Date | null;
}

interface BillingWords {
  subject: string;
  intro: (price: string, at: string) => string;
  unlockAt: (at: string) => string;
  consent: string;
  withdraw: string;
  contract: (id: string) => string;
  button: string;
  withdrawnSubject: string;
  withdrawnIntro: (at: string) => string;
  withdrawnRefund: string;
  withdrawnName: (name: string) => string;
}

/** The consent text, word for word as the checkbox in the dashboard and on the phone. */
export const consentText = {
  en: "I ask for the early unlock to start now, before the 14-day withdrawal period ends. I understand that I lose my right to withdraw once the early unlock has been delivered.",
  da: "Jeg beder om, at den tidlige oplåsning starter nu, før fortrydelsesfristen på 14 dage udløber. Jeg forstår, at jeg mister min fortrydelsesret, når den tidlige oplåsning er leveret.",
  sv: "Jag ber om att den tidiga upplåsningen startar nu, innan ångerfristen på 14 dagar har gått ut. Jag förstår att jag förlorar min ångerrätt när den tidiga upplåsningen har levererats.",
  nb: "Jeg ber om at den tidlige opplåsingen starter nå, før angrefristen på 14 dager er ute. Jeg forstår at jeg mister angreretten når den tidlige opplåsingen er levert.",
  de: "Ich verlange, dass die frühe Freigabe jetzt beginnt, vor Ablauf der Widerrufsfrist von 14 Tagen. Mir ist bekannt, dass ich mein Widerrufsrecht verliere, sobald die frühe Freigabe erbracht ist.",
} satisfies Record<Locale, string>;

export const billingMailText = {
  en: {
    subject: "Receipt: early unlock",
    intro: (p, at) => `You paid ${p} for an early unlock on ${at}.`,
    unlockAt: (at) => `Your change applies at about ${at}.`,
    consent: "What you agreed to:",
    withdraw: "You can withdraw until then: open the change in Plainphone and choose Withdraw from contract. You get the full amount back, and the change waits its normal time again.",
    contract: (id) => `Contract number: ${id}`,
    button: "Open Plainphone",
    withdrawnSubject: "Receipt: withdrawal",
    withdrawnIntro: (at) => `We received your withdrawal on ${at}.`,
    withdrawnRefund: "The early unlock is cancelled, the change waits its normal time again, and you get the full amount back to the way you paid.",
    withdrawnName: (n) => `Name given: ${n}`,
  },
  da: {
    subject: "Kvittering: tidlig oplåsning",
    intro: (p, at) => `Du betalte ${p} for en tidlig oplåsning ${at}.`,
    unlockAt: (at) => `Din ændring træder i kraft omkring ${at}.`,
    consent: "Det sagde du ja til:",
    withdraw: "Du kan fortryde indtil da: åbn ændringen i Plainphone og vælg Fortryd aftale. Du får hele beløbet tilbage, og ændringen venter igen sin normale tid.",
    contract: (id) => `Aftalenummer: ${id}`,
    button: "Åbn Plainphone",
    withdrawnSubject: "Kvittering: fortrydelse",
    withdrawnIntro: (at) => `Vi modtog din fortrydelse ${at}.`,
    withdrawnRefund: "Den tidlige oplåsning er annulleret, ændringen venter igen sin normale tid, og du får hele beløbet tilbage, samme vej som du betalte.",
    withdrawnName: (n) => `Oplyst navn: ${n}`,
  },
  sv: {
    subject: "Kvitto: tidig upplåsning",
    intro: (p, at) => `Du betalade ${p} för en tidig upplåsning ${at}.`,
    unlockAt: (at) => `Din ändring gäller från ungefär ${at}.`,
    consent: "Det här godkände du:",
    withdraw: "Du kan ångra dig fram till dess: öppna ändringen i Plainphone och välj Ångra avtalet. Du får hela beloppet tillbaka, och ändringen väntar sin vanliga tid igen.",
    contract: (id) => `Avtalsnummer: ${id}`,
    button: "Öppna Plainphone",
    withdrawnSubject: "Kvitto: ånger",
    withdrawnIntro: (at) => `Vi tog emot ditt ånger ${at}.`,
    withdrawnRefund: "Den tidiga upplåsningen är avbruten, ändringen väntar sin vanliga tid igen och du får hela beloppet tillbaka på samma sätt som du betalade.",
    withdrawnName: (n) => `Angivet namn: ${n}`,
  },
  nb: {
    subject: "Kvittering: tidlig opplåsing",
    intro: (p, at) => `Du betalte ${p} for en tidlig opplåsing ${at}.`,
    unlockAt: (at) => `Endringen din gjelder fra omtrent ${at}.`,
    consent: "Dette sa du ja til:",
    withdraw: "Du kan angre frem til da: åpne endringen i Plainphone og velg Angre avtalen. Du får hele beløpet tilbake, og endringen venter sin vanlige tid igjen.",
    contract: (id) => `Avtalenummer: ${id}`,
    button: "Åpne Plainphone",
    withdrawnSubject: "Kvittering: angring",
    withdrawnIntro: (at) => `Vi mottok angringen din ${at}.`,
    withdrawnRefund: "Den tidlige opplåsingen er avbrutt, endringen venter sin vanlige tid igjen, og du får hele beløpet tilbake samme vei som du betalte.",
    withdrawnName: (n) => `Oppgitt navn: ${n}`,
  },
  de: {
    subject: "Beleg: frühe Freigabe",
    intro: (p, at) => `Sie haben am ${at} ${p} für eine frühe Freigabe bezahlt.`,
    unlockAt: (at) => `Ihre Änderung gilt ab etwa ${at}.`,
    consent: "Dem haben Sie zugestimmt:",
    withdraw: "Bis dahin können Sie widerrufen: Öffnen Sie die Änderung in Plainphone und wählen Sie Vertrag widerrufen. Sie erhalten den vollen Betrag zurück, und die Änderung wartet wieder ihre normale Zeit.",
    contract: (id) => `Vertragsnummer: ${id}`,
    button: "Plainphone öffnen",
    withdrawnSubject: "Beleg: Widerruf",
    withdrawnIntro: (at) => `Wir haben Ihren Widerruf am ${at} erhalten.`,
    withdrawnRefund: "Die frühe Freigabe ist storniert, die Änderung wartet wieder ihre normale Zeit, und Sie erhalten den vollen Betrag auf dem Weg zurück, auf dem Sie bezahlt haben.",
    withdrawnName: (n) => `Angegebener Name: ${n}`,
  },
} satisfies Record<Locale, BillingWords>;

export function formatMoney(minor: number, currency: string, locale: Locale) {
  return new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency }).format(minor / 100);
}

function formatAt(d: Date, locale: Locale, timeZone: string) {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "long", timeStyle: "short", timeZone }).format(d);
}

function openUrl(publicUrl: string, row: ReceiptRow) {
  return row.phoneId ? `${publicUrl}/phones/${row.phoneId}/key?earlyUnlock=${row.id}` : publicUrl;
}

export function earlyUnlockReceiptMail(to: string, locale: Locale, publicUrl: string, row: ReceiptRow, timeZone: string): Mail {
  const t = billingMailText[locale];
  const paidAt = formatAt(row.paidAt ?? row.consentAt, locale, timeZone);
  return build(to, t.subject, {
    publicUrl,
    locale,
    preheader: t.intro(formatMoney(row.amount, row.currency, locale), paidAt),
    heading: t.subject,
    paragraphs: [
      t.intro(formatMoney(row.amount, row.currency, locale), paidAt),
      ...(row.unlockAt ? [t.unlockAt(formatAt(row.unlockAt, locale, timeZone))] : []),
      t.withdraw,
    ],
    sections: [{ title: t.consent, lines: [consentText[locale], formatAt(row.consentAt, locale, timeZone)] }],
    button: { label: t.button, url: openUrl(publicUrl, row) },
    afterButton: [t.contract(row.id)],
    footer: footer[locale],
  });
}

export function withdrawalReceiptMail(
  to: string, locale: Locale, publicUrl: string, row: ReceiptRow, timeZone: string, name?: string,
): Mail {
  const t = billingMailText[locale];
  const at = formatAt(row.withdrawnAt ?? new Date(), locale, timeZone);
  return build(to, t.withdrawnSubject, {
    publicUrl,
    locale,
    preheader: t.withdrawnIntro(at),
    heading: t.withdrawnSubject,
    paragraphs: [t.withdrawnIntro(at), t.withdrawnRefund],
    button: { label: t.button, url: openUrl(publicUrl, row) },
    afterButton: [t.contract(row.id), ...(name ? [t.withdrawnName(name)] : [])],
    footer: footer[locale],
  });
}
