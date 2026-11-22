// SPDX-License-Identifier: Apache-2.0
//
// /delete-account/: how to delete a Plainphone account, in the apps and without them. App stores
// ask for one address that does exactly this (Google Play's account deletion requirement), so it
// is its own page and not only a section of the privacy policy. It must say the same as the
// privacy policy (`privacy` in en.mjs and the other languages) and docs/account-deletion.md;
// change them together.
//
// A block is a string (a paragraph), { steps: [...] } (a numbered list) or { list: [...] }.
// {PRIVACY} becomes the address of the privacy policy in the same language.
//
// The sv, nb and de texts wait for a native speaker's read (docs/translations.md).

const MAIL = `<a href="mailto:privacy@plainphone.org?subject=Delete%20my%20Plainphone%20account">privacy@plainphone.org</a>`;

export const deleteAccount = {
  en: {
    path: "/delete-account/",
    title: "Delete your account: Plainphone",
    description:
      "How to delete your Plainphone account and the data about your family’s phones, in the app or by mail, and what is deleted when.",
    h1: "Delete your Plainphone account",
    lead:
      "You can delete your Plainphone account at any time: in the Plainphone parent app, in the dashboard at app.plainphone.org, or by mail if you no longer have the app. Plainphone is made by Mahoje in Denmark.",
    footer: "Delete your account",
    privacyNote: "To delete your account, see <a href=\"{LINK}\">Delete your Plainphone account</a>.",
    sections: [
      {
        id: "in-the-app",
        title: "In the app or the dashboard",
        body: [
          {
            steps: [
              "Open <strong>Settings</strong>.",
              "Choose <strong>Delete my account</strong>.",
              "Type your email address to confirm, and choose <strong>Delete for good</strong>.",
            ],
          },
          "In a household only you belong to, an adult’s own phone has a key. Remove that phone first, through its key, and then delete the account. This keeps deleting the account from being a way around the key.",
        ],
      },
      {
        id: "without-the-app",
        title: "Without the app",
        body: [
          `Write to ${MAIL} from the email address you sign in with, and ask us to delete your account. We check that you control the address before we delete anything, and we aim to answer within a month.`,
        ],
      },
      {
        id: "what",
        title: "What is deleted",
        body: [
          {
            list: [
              "your account: your email address, your language and your sign-ins",
              "every household only you belong to, with its phones and everything stored about them: rules, apps, contacts, schedules, web filter settings, the latest position, requests and messages",
              "your notification registrations, invitations to your address and your sign-in links",
            ],
          },
          "The web filter is asked to forget each removed phone, and is asked again until it confirms. The phones keep their lock and their last rules until they are set up again.",
          "What stays: a household you share with another parent stays with them, with its phones. If you paid for something, the purchase record is kept for bookkeeping, as the law requires, without any link to your account.",
        ],
      },
      {
        id: "when",
        title: "How fast",
        body: [
          "Deleting in the app or the dashboard happens at once and cannot be undone. Database backups still hold the deleted data until they rotate out, at most 30 days later. Backups of the web filter settings rotate out after 14 days.",
          "The full rules are in the <a href=\"{PRIVACY}\">privacy policy</a>.",
        ],
      },
    ],
  },
  da: {
    path: "/da/delete-account/",
    title: "Slet din konto: Plainphone",
    description:
      "Sådan sletter du din Plainphone-konto og oplysningerne om familiens telefoner, i appen eller pr. mail, og hvad der bliver slettet hvornår.",
    h1: "Slet din Plainphone-konto",
    lead:
      "Du kan slette din Plainphone-konto når som helst: i forældreappen Plainphone, i dashboardet på app.plainphone.org eller pr. mail, hvis du ikke længere har appen. Plainphone er lavet af Mahoje i Danmark.",
    footer: "Slet din konto",
    privacyNote: "Vil du slette din konto, så se <a href=\"{LINK}\">Slet din Plainphone-konto</a>.",
    sections: [
      {
        id: "i-appen",
        title: "I appen eller dashboardet",
        body: [
          {
            steps: [
              "Åbn <strong>Indstillinger</strong>.",
              "Vælg <strong>Slet min konto</strong>.",
              "Skriv din mailadresse for at bekræfte, og vælg <strong>Slet for altid</strong>.",
            ],
          },
          "I en husstand, hvor kun du er med, har en voksens egen telefon en nøgle. Fjern først den telefon gennem nøglen, og slet så kontoen. Ellers kunne man slette kontoen for at komme uden om nøglen.",
        ],
      },
      {
        id: "uden-appen",
        title: "Uden appen",
        body: [
          `Skriv til ${MAIL} fra den mailadresse, du logger ind med, og bed os slette din konto. Vi tjekker, at du har adgang til adressen, før vi sletter noget, og vi sigter mod at svare inden for en måned.`,
        ],
      },
      {
        id: "hvad",
        title: "Hvad bliver slettet",
        body: [
          {
            list: [
              "din konto: din mailadresse, dit sprog og dine logins",
              "hver husstand, hvor kun du er med, med dens telefoner og alt, hvad der er gemt om dem: regler, apps, kontakter, tidsplaner, indstillinger for webfilteret, den seneste placering, anmodninger og beskeder",
              "dine tilmeldinger til notifikationer, invitationer til din adresse og dine loginlinks",
            ],
          },
          "Webfilteret bliver bedt om at glemme hver fjernet telefon, og vi spørger igen, til det har bekræftet det. Telefonerne beholder deres lås og deres sidste regler, til de bliver sat op igen.",
          "Det her bliver ikke slettet: En husstand, du deler med en anden forælder, bliver hos dem med sine telefoner. Har du betalt for noget, gemmer vi købet til bogføringen, som loven kræver, uden forbindelse til din konto.",
        ],
      },
      {
        id: "hvornaar",
        title: "Hvor hurtigt",
        body: [
          "Sletter du i appen eller dashboardet, sker det med det samme, og det kan ikke fortrydes. Sikkerhedskopierne af databasen indeholder de slettede oplysninger, til de bliver udskiftet, højst 30 dage efter. Sikkerhedskopierne af webfilterets indstillinger bliver udskiftet efter 14 dage.",
          "Alle reglerne står i <a href=\"{PRIVACY}\">privatlivspolitikken</a>.",
        ],
      },
    ],
  },
  sv: {
    path: "/sv/delete-account/",
    title: "Radera ditt konto: Plainphone",
    description:
      "Så raderar du ditt Plainphone-konto och uppgifterna om familjens telefoner, i appen eller via mejl, och vad som raderas när.",
    h1: "Radera ditt Plainphone-konto",
    lead:
      "Du kan radera ditt Plainphone-konto när som helst: i föräldraappen Plainphone, i dashboarden på app.plainphone.org eller via mejl om du inte längre har appen. Plainphone görs av Mahoje i Danmark.",
    footer: "Radera ditt konto",
    privacyNote: "Om du vill radera ditt konto, se <a href=\"{LINK}\">Radera ditt Plainphone-konto</a>.",
    sections: [
      {
        id: "i-appen",
        title: "I appen eller dashboarden",
        body: [
          {
            steps: [
              "Öppna <strong>Inställningar</strong>.",
              "Välj <strong>Ta bort mitt konto</strong>.",
              "Skriv din e-postadress för att bekräfta och välj <strong>Ta bort för gott</strong>.",
            ],
          },
          "I ett hushåll där bara du är med har en vuxens egen telefon en nyckel. Ta först bort den telefonen genom nyckeln och radera sedan kontot. Annars skulle man kunna radera kontot för att komma runt nyckeln.",
        ],
      },
      {
        id: "utan-appen",
        title: "Utan appen",
        body: [
          `Skriv till ${MAIL} från den e-postadress du loggar in med och be oss radera ditt konto. Vi kontrollerar att du har tillgång till adressen innan vi raderar något, och vi försöker svara inom en månad.`,
        ],
      },
      {
        id: "vad",
        title: "Vad som raderas",
        body: [
          {
            list: [
              "ditt konto: din e-postadress, ditt språk och dina inloggningar",
              "varje hushåll där bara du är med, med dess telefoner och allt som sparats om dem: regler, appar, kontakter, scheman, inställningar för webbfiltret, den senaste platsen, förfrågningar och meddelanden",
              "dina registreringar för aviseringar, inbjudningar till din adress och dina inloggningslänkar",
            ],
          },
          "Webbfiltret ombeds glömma varje borttagen telefon, och vi frågar igen tills det har bekräftat. Telefonerna behåller sitt lås och sina senaste regler tills de konfigureras på nytt.",
          "Det här raderas inte: ett hushåll du delar med en annan förälder stannar hos dem, med sina telefoner. Om du har betalat för något sparas köpet för bokföringen, som lagen kräver, utan koppling till ditt konto.",
        ],
      },
      {
        id: "hur-snabbt",
        title: "Hur snabbt",
        body: [
          "Raderar du i appen eller dashboarden sker det direkt och kan inte ångras. Säkerhetskopiorna av databasen innehåller de raderade uppgifterna tills de byts ut, senast 30 dagar senare. Säkerhetskopiorna av webbfiltrets inställningar byts ut efter 14 dagar.",
          "Alla regler finns i <a href=\"{PRIVACY}\">integritetspolicyn</a>.",
        ],
      },
    ],
  },
  nb: {
    path: "/nb/delete-account/",
    title: "Slett kontoen din: Plainphone",
    description:
      "Slik sletter du Plainphone-kontoen din og opplysningene om familiens telefoner, i appen eller på e-post, og hva som slettes når.",
    h1: "Slett Plainphone-kontoen din",
    lead:
      "Du kan slette Plainphone-kontoen din når som helst: i foreldreappen Plainphone, i dashbordet på app.plainphone.org eller på e-post hvis du ikke lenger har appen. Plainphone er laget av Mahoje i Danmark.",
    footer: "Slett kontoen din",
    privacyNote: "Vil du slette kontoen din, se <a href=\"{LINK}\">Slett Plainphone-kontoen din</a>.",
    sections: [
      {
        id: "i-appen",
        title: "I appen eller dashbordet",
        body: [
          {
            steps: [
              "Åpne <strong>Innstillinger</strong>.",
              "Velg <strong>Slett kontoen min</strong>.",
              "Skriv inn e-postadressen din for å bekrefte, og velg <strong>Slett for godt</strong>.",
            ],
          },
          "I en husstand der bare du er med, har en voksens egen telefon en nøkkel. Fjern først den telefonen gjennom nøkkelen, og slett deretter kontoen. Ellers kunne man slette kontoen for å komme rundt nøkkelen.",
        ],
      },
      {
        id: "uten-appen",
        title: "Uten appen",
        body: [
          `Skriv til ${MAIL} fra e-postadressen du logger inn med, og be oss slette kontoen din. Vi sjekker at du har tilgang til adressen før vi sletter noe, og vi tar sikte på å svare innen en måned.`,
        ],
      },
      {
        id: "hva",
        title: "Hva som slettes",
        body: [
          {
            list: [
              "kontoen din: e-postadressen din, språket ditt og innloggingene dine",
              "hver husstand der bare du er med, med telefonene og alt som er lagret om dem: regler, apper, kontakter, tidsplaner, innstillinger for nettfilteret, den siste posisjonen, forespørsler og meldinger",
              "registreringene dine for varsler, invitasjoner til adressen din og innloggingslenkene dine",
            ],
          },
          "Nettfilteret blir bedt om å glemme hver fjernet telefon, og vi spør igjen til det har bekreftet. Telefonene beholder låsen og de siste reglene sine til de blir satt opp på nytt.",
          "Dette slettes ikke: en husstand du deler med en annen forelder, blir hos dem, med telefonene sine. Har du betalt for noe, lagres kjøpet for regnskapet, slik loven krever, uten kobling til kontoen din.",
        ],
      },
      {
        id: "hvor-raskt",
        title: "Hvor raskt",
        body: [
          "Sletter du i appen eller dashbordet, skjer det med en gang, og det kan ikke angres. Sikkerhetskopiene av databasen inneholder de slettede opplysningene til de byttes ut, senest 30 dager senere. Sikkerhetskopiene av innstillingene til nettfilteret byttes ut etter 14 dager.",
          "Alle reglene står i <a href=\"{PRIVACY}\">personvernerklæringen</a>.",
        ],
      },
    ],
  },
  de: {
    path: "/de/delete-account/",
    title: "Konto löschen: Plainphone",
    description:
      "So löschen Sie Ihr Plainphone-Konto und die Daten zu den Telefonen Ihrer Familie, in der App oder per E-Mail, und was wann gelöscht wird.",
    h1: "Ihr Plainphone-Konto löschen",
    lead:
      "Sie können Ihr Plainphone-Konto jederzeit löschen: in der Eltern-App Plainphone, im Dashboard unter app.plainphone.org oder per E-Mail, wenn Sie die App nicht mehr haben. Plainphone wird von Mahoje in Dänemark entwickelt.",
    footer: "Konto löschen",
    privacyNote: "Wie Sie Ihr Konto löschen, steht unter <a href=\"{LINK}\">Ihr Plainphone-Konto löschen</a>.",
    sections: [
      {
        id: "in-der-app",
        title: "In der App oder im Dashboard",
        body: [
          {
            steps: [
              "Öffnen Sie <strong>Einstellungen</strong>.",
              "Wählen Sie <strong>Mein Konto löschen</strong>.",
              "Geben Sie zur Bestätigung Ihre E-Mail-Adresse ein und wählen Sie <strong>Endgültig löschen</strong>.",
            ],
          },
          "In einem Haushalt, zu dem nur Sie gehören, hat das eigene Telefon eines Erwachsenen einen Schlüssel. Entfernen Sie dieses Telefon zuerst über den Schlüssel und löschen Sie danach das Konto. Sonst könnte man das Konto löschen, um den Schlüssel zu umgehen.",
        ],
      },
      {
        id: "ohne-app",
        title: "Ohne die App",
        body: [
          `Schreiben Sie an ${MAIL} von der E-Mail-Adresse, mit der Sie sich anmelden, und bitten Sie uns, Ihr Konto zu löschen. Wir prüfen, dass Sie Zugriff auf die Adresse haben, bevor wir etwas löschen, und wir antworten nach Möglichkeit innerhalb eines Monats.`,
        ],
      },
      {
        id: "was",
        title: "Was gelöscht wird",
        body: [
          {
            list: [
              "Ihr Konto: Ihre E-Mail-Adresse, Ihre Sprache und Ihre Anmeldungen",
              "jeder Haushalt, zu dem nur Sie gehören, mit seinen Telefonen und allem, was über sie gespeichert ist: Regeln, Apps, Kontakte, Zeitpläne, Einstellungen des Webfilters, der letzte Standort, Anfragen und Nachrichten",
              "Ihre Anmeldungen für Benachrichtigungen, Einladungen an Ihre Adresse und Ihre Anmeldelinks",
            ],
          },
          "Der Webfilter wird gebeten, jedes entfernte Telefon zu vergessen, und wir fragen erneut, bis er es bestätigt. Die Telefone behalten ihre Sperre und ihre letzten Regeln, bis sie neu eingerichtet werden.",
          "Was bleibt: Ein Haushalt, den Sie mit einem anderen Elternteil teilen, bleibt mit seinen Telefonen bei diesem. Wenn Sie etwas bezahlt haben, bewahren wir den Kauf für die Buchhaltung auf, wie es das Gesetz verlangt, ohne Verbindung zu Ihrem Konto.",
        ],
      },
      {
        id: "wie-schnell",
        title: "Wie schnell",
        body: [
          "In der App oder im Dashboard wird sofort gelöscht, und das lässt sich nicht rückgängig machen. Die Sicherungen der Datenbank enthalten die gelöschten Daten, bis sie ersetzt werden, spätestens 30 Tage später. Die Sicherungen der Webfilter-Einstellungen werden nach 14 Tagen ersetzt.",
          "Alle Regeln stehen in der <a href=\"{PRIVACY}\">Datenschutzerklärung</a>.",
        ],
      },
    ],
  },
};
