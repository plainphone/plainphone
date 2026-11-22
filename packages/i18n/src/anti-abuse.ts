// SPDX-License-Identifier: Apache-2.0
//
// Bot and spam protection on the sign-in form and on invitations (docs/operations.md, "Bot and
// spam protection"), for the dashboard and the parent app. Kept in its own file so the main
// catalogues only spread it in. Never use em dashes in copy.

export const antiAbuseEn = {
  "botCheck.working": "Doing a quick security check. This takes a few seconds.",
  "botCheck.failed": "The security check did not work. Try again.",
  "botCheck.honeypot": "Leave this field empty",
  "disposableEmail.error": "This looks like a temporary mail address. Use an address you will keep, so you can still sign in later.",
  "inviteCap.error": "Your family has sent today's invitations. Try again tomorrow.",
} as const;

export const antiAbuseDa: Record<keyof typeof antiAbuseEn, string> = {
  "botCheck.working": "Laver et hurtigt sikkerhedstjek. Det tager et par sekunder.",
  "botCheck.failed": "Sikkerhedstjekket virkede ikke. Prøv igen.",
  "botCheck.honeypot": "Lad dette felt være tomt",
  "disposableEmail.error": "Det ligner en midlertidig mailadresse. Brug en adresse, du beholder, så du også kan logge ind senere.",
  "inviteCap.error": "Jeres familie har sendt dagens invitationer. Prøv igen i morgen.",
};

export const antiAbuseSv: Record<keyof typeof antiAbuseEn, string> = {
  "botCheck.working": "Gör en snabb säkerhetskontroll. Det tar några sekunder.",
  "botCheck.failed": "Säkerhetskontrollen fungerade inte. Försök igen.",
  "botCheck.honeypot": "Lämna det här fältet tomt",
  "disposableEmail.error": "Det ser ut som en tillfällig e-postadress. Använd en adress du behåller, så att du kan logga in även senare.",
  "inviteCap.error": "Er familj har skickat dagens inbjudningar. Försök igen i morgon.",
};

export const antiAbuseNb: Record<keyof typeof antiAbuseEn, string> = {
  "botCheck.working": "Gjør en rask sikkerhetssjekk. Det tar noen sekunder.",
  "botCheck.failed": "Sikkerhetssjekken virket ikke. Prøv igjen.",
  "botCheck.honeypot": "La dette feltet stå tomt",
  "disposableEmail.error": "Dette ser ut som en midlertidig e-postadresse. Bruk en adresse du beholder, så du kan logge inn senere også.",
  "inviteCap.error": "Familien deres har sendt dagens invitasjoner. Prøv igjen i morgen.",
};

export const antiAbuseDe: Record<keyof typeof antiAbuseEn, string> = {
  "botCheck.working": "Kurze Sicherheitsprüfung läuft. Das dauert ein paar Sekunden.",
  "botCheck.failed": "Die Sicherheitsprüfung hat nicht geklappt. Versuchen Sie es noch einmal.",
  "botCheck.honeypot": "Dieses Feld bitte leer lassen",
  "disposableEmail.error": "Das sieht nach einer Wegwerf-E-Mail-Adresse aus. Nutzen Sie eine Adresse, die Sie behalten, damit Sie sich auch später anmelden können.",
  "inviteCap.error": "Ihre Familie hat die Einladungen für heute verschickt. Versuchen Sie es morgen noch einmal.",
};
