// SPDX-License-Identifier: Apache-2.0
//
// What an iPhone cannot do the way Android does (docs/ios/architecture.md, "Capability map"),
// shared by the dashboard and the parent app. Kept in its own file so the main catalogues only
// spread it in. Never use em dashes in copy.

export const platformEn = {
  "platform.iphone": "iPhone",
  "platform.iosNote": "This is an iPhone. Apple decides a few things that Plainphone decides on Android. The rules below say which.",
  "platform.ios.apps": "On iPhone, apps you have not approved stay on the screen with an hourglass, but they do not open.",
  "platform.ios.contacts": "On iPhone, Apple controls who can call. Set it up with the guide.",
  "platform.ios.webFilter": "On iPhone, the web filter is switched on in Settings on the phone, and it can be switched off there.",
  "platform.ios.bedtimeSilence": "On iPhone, Apple's Downtime decides who can ring at bedtime. Set it up with the guide.",
  "platform.ios.calmHome": "On iPhone, Plainphone cannot change the home screen.",
  "platform.ios.phoneSettings": "On iPhone, these settings are made in Apple's Settings app.",
  "platform.ios.selfKeys": "On iPhone, the owner can switch Plainphone off in Settings. The key slows changes down but cannot stop that.",
};

export const platformDa: Record<keyof typeof platformEn, string> = {
  "platform.iphone": "iPhone",
  "platform.iosNote": "Det her er en iPhone. Apple bestemmer et par ting, som Plainphone bestemmer på Android. Reglerne herunder siger hvilke.",
  "platform.ios.apps": "På iPhone bliver apps, du ikke har godkendt, på skærmen med et timeglas, men de kan ikke åbnes.",
  "platform.ios.contacts": "På iPhone styrer Apple, hvem der kan ringe. Sæt det op med guiden.",
  "platform.ios.webFilter": "På iPhone slås webfilteret til under Indstillinger på telefonen, og det kan slås fra samme sted.",
  "platform.ios.bedtimeSilence": "På iPhone bestemmer Apples Nedetid, hvem der kan ringe ved sengetid. Sæt det op med guiden.",
  "platform.ios.calmHome": "På iPhone kan Plainphone ikke ændre hjemmeskærmen.",
  "platform.ios.phoneSettings": "På iPhone vælges de her indstillinger i Apples app Indstillinger.",
  "platform.ios.selfKeys": "På iPhone kan ejeren slå Plainphone fra under Indstillinger. Nøglen gør ændringer langsommere, men kan ikke forhindre det.",
};

export const platformSv: Record<keyof typeof platformEn, string> = {
  "platform.iphone": "iPhone",
  "platform.iosNote": "Det här är en iPhone. Apple bestämmer några saker som Plainphone bestämmer på Android. Reglerna nedan säger vilka.",
  "platform.ios.apps": "På iPhone ligger appar som du inte har godkänt kvar på skärmen med ett timglas, men de går inte att öppna.",
  "platform.ios.contacts": "På iPhone styr Apple vem som kan ringa. Ställ in det med guiden.",
  "platform.ios.webFilter": "På iPhone slås webbfiltret på under Inställningar på telefonen, och det kan stängas av där.",
  "platform.ios.bedtimeSilence": "På iPhone avgör Apples Nedtid vem som kan ringa vid läggdags. Ställ in det med guiden.",
  "platform.ios.calmHome": "På iPhone kan Plainphone inte ändra hemskärmen.",
  "platform.ios.phoneSettings": "På iPhone görs de här inställningarna i Apples app Inställningar.",
  "platform.ios.selfKeys": "På iPhone kan ägaren stänga av Plainphone under Inställningar. Nyckeln gör ändringar långsammare men kan inte stoppa det.",
};

export const platformNb: Record<keyof typeof platformEn, string> = {
  "platform.iphone": "iPhone",
  "platform.iosNote": "Dette er en iPhone. Apple bestemmer noen ting som Plainphone bestemmer på Android. Reglene nedenfor sier hvilke.",
  "platform.ios.apps": "På iPhone blir apper du ikke har godkjent, liggende på skjermen med et timeglass, men de kan ikke åpnes.",
  "platform.ios.contacts": "På iPhone styrer Apple hvem som kan ringe. Sett det opp med veiviseren.",
  "platform.ios.webFilter": "På iPhone slås nettfilteret på under Innstillinger på telefonen, og det kan slås av samme sted.",
  "platform.ios.bedtimeSilence": "På iPhone bestemmer Apples Nedetid hvem som kan ringe ved leggetid. Sett det opp med veiviseren.",
  "platform.ios.calmHome": "På iPhone kan ikke Plainphone endre hjemskjermen.",
  "platform.ios.phoneSettings": "På iPhone velges disse innstillingene i Apples app Innstillinger.",
  "platform.ios.selfKeys": "På iPhone kan eieren slå av Plainphone under Innstillinger. Nøkkelen gjør endringer tregere, men kan ikke hindre det.",
};

export const platformDe: Record<keyof typeof platformEn, string> = {
  "platform.iphone": "iPhone",
  "platform.iosNote": "Das ist ein iPhone. Apple entscheidet einige Dinge, die Plainphone auf Android entscheidet. Die Regeln unten sagen, welche.",
  "platform.ios.apps": "Auf dem iPhone bleiben Apps, die Sie nicht freigegeben haben, mit einer Sanduhr auf dem Bildschirm, lassen sich aber nicht öffnen.",
  "platform.ios.contacts": "Auf dem iPhone legt Apple fest, wer anrufen kann. Richten Sie es mit der Anleitung ein.",
  "platform.ios.webFilter": "Auf dem iPhone wird der Webfilter in den Einstellungen des Telefons eingeschaltet und kann dort auch ausgeschaltet werden.",
  "platform.ios.bedtimeSilence": "Auf dem iPhone entscheidet Apples Auszeit, wer zur Schlafenszeit anrufen kann. Richten Sie es mit der Anleitung ein.",
  "platform.ios.calmHome": "Auf dem iPhone kann Plainphone den Home-Bildschirm nicht ändern.",
  "platform.ios.phoneSettings": "Auf dem iPhone werden diese Einstellungen in Apples App Einstellungen vorgenommen.",
  "platform.ios.selfKeys": "Auf dem iPhone kann die Person, der es gehört, Plainphone in den Einstellungen ausschalten. Der Schlüssel verlangsamt Änderungen, kann das aber nicht verhindern.",
};
