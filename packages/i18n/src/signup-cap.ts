// SPDX-License-Identifier: Apache-2.0
//
// Shown on the login page (dashboard and parent app) when the hosted service has taken today's
// new households (SIGNUP_DAILY_CAP, #241). Kept in its own file so the main catalogues only
// spread it in. Never use em dashes in copy.

export const signupCapEn = {
  "signupCap.title": "Full for today",
  "signupCap.body": "The test service takes a limited number of new families each day, and today's places are taken. Try again tomorrow.",
  "signupCap.selfHost": "Running Plainphone on your own server has no such limit.",
} as const;

export const signupCapDa: Record<keyof typeof signupCapEn, string> = {
  "signupCap.title": "Fuldt for i dag",
  "signupCap.body": "Testtjenesten tager et begrænset antal nye familier om dagen, og dagens pladser er brugt. Prøv igen i morgen.",
  "signupCap.selfHost": "Kører du Plainphone på din egen server, er der ingen sådan grænse.",
};

export const signupCapSv: Record<keyof typeof signupCapEn, string> = {
  "signupCap.title": "Fullt för i dag",
  "signupCap.body": "Testtjänsten tar emot ett begränsat antal nya familjer per dag, och dagens platser är tagna. Försök igen i morgon.",
  "signupCap.selfHost": "Kör du Plainphone på din egen server finns ingen sådan gräns.",
};

export const signupCapNb: Record<keyof typeof signupCapEn, string> = {
  "signupCap.title": "Fullt for i dag",
  "signupCap.body": "Testtjenesten tar imot et begrenset antall nye familier per dag, og dagens plasser er tatt. Prøv igjen i morgen.",
  "signupCap.selfHost": "Kjører du Plainphone på din egen server, finnes det ingen slik grense.",
};

export const signupCapDe: Record<keyof typeof signupCapEn, string> = {
  "signupCap.title": "Für heute voll",
  "signupCap.body": "Der Testdienst nimmt jeden Tag nur eine begrenzte Zahl neuer Familien auf, und die Plätze für heute sind vergeben. Versuchen Sie es morgen noch einmal.",
  "signupCap.selfHost": "Auf Ihrem eigenen Plainphone-Server gibt es keine solche Grenze.",
};
