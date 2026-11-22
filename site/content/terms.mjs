// SPDX-License-Identifier: Apache-2.0
// The terms of the hosted test service (/terms/ and its language equivalents, issue #244).
// Keep them short and in step with the privacy policy (`privacy` in content/*.mjs), the price
// section and the README status block. Promise nothing the test service cannot keep.
// The Swedish, Norwegian and German text was written without a native speaker (see docs/translations.md).
const GITHUB = "https://github.com/plainphone/plainphone";
const ANNOUNCEMENTS = `${GITHUB}/discussions/categories/announcements`;
const mail = (a) => `<a href="mailto:${a}">${a}</a>`;

export const terms = {
  en: {
    path: "/terms/",
    title: "Terms of the test service: Plainphone",
    description: "The short terms for the hosted Plainphone test service: an alpha, free, provided as is, and never wiped without 30 days’ notice.",
    h1: "Terms of the test service",
    updated: "Last updated 22 November 2026",
    lead: "These terms cover the hosted test service: the parent dashboard at app.plainphone.org, the Plainphone Parent app when it uses that service, and the web filter at dns.plainphone.org. They are short on purpose.",
    tocLabel: "On this page",
    sections: [
      {
        id: "provider",
        title: "Who provides it",
        body: [
          `The test service is provided by <a href="https://mahoje.dk">Mahoje</a> (CVR 39413892) in Denmark, which maintains Plainphone. Questions go to ${mail("support@plainphone.org")}. Questions about your data go to ${mail("privacy@plainphone.org")}.`,
          "Danish law applies. It does not take away any protection you have under the law of the country you live in.",
        ],
      },
      {
        id: "alpha",
        title: "It is an alpha",
        body: [
          "Plainphone is in alpha. It has had little testing on real phones and no external security audit. Things will change, and some will break. Try it on a spare phone, and do not make it the only phone a child relies on.",
        ],
      },
      {
        id: "as-is",
        title: "Provided as is",
        body: [
          "We provide the test service as is, without any warranty. We work to keep it running and safe, but we cannot promise that it is always available, that it works on your phone or that it has no errors. It does not replace talking with your child and keeping an eye on things yourself.",
          "As far as the law allows, Mahoje is not liable for loss that comes from using the test service. This does not limit rights you have by law that cannot be waived.",
        ],
      },
      {
        id: "free",
        title: "It is free",
        body: [
          "The test service is free. There is nothing to pay, and it takes no payments during the alpha. If that changes, we tell you well in advance and change these terms first. Running Plainphone on your own server and one fully protected phone on the hosted service stay free.",
        ],
      },
      {
        id: "data",
        title: "Your data",
        body: [
          `We keep the data on the test service during the alpha. We never wipe it without telling you at least 30 days before, by mail to everyone with an account and in <a href="${ANNOUNCEMENTS}">Discussions → Announcements</a> on GitHub. The notice says what happens to your phones and how to get out. The <a href="/privacy/">privacy policy</a> says what we store and for how long.`,
        ],
      },
      {
        id: "use",
        title: "Using it",
        body: [
          "Use the test service for phones you are responsible for: your child’s phone or your own. Tell your child what Plainphone does on their phone.",
          `Do not try to break into the service or other households. If you find a security problem, report it privately as described in <a href="${GITHUB}/blob/main/SECURITY.md">SECURITY.md</a>.`,
          "You can delete your account at any time under Settings. We may close an account that is used to abuse the service or harm others, and we tell the account holder why. If the test service closes, you get the same 30 days’ notice.",
        ],
      },
      {
        id: "software",
        title: "The software",
        body: [
          `The Plainphone software is open source under the <a href="${GITHUB}/blob/main/LICENSE">Apache License 2.0</a>. These terms cover only the hosted test service, not the code. If you run Plainphone on your own server, these terms do not apply to it, and you are responsible for that server. The name and logo are covered by the <a href="${GITHUB}/blob/main/TRADEMARK.md">trademark policy</a>.`,
        ],
      },
      {
        id: "changes",
        title: "Changes to these terms",
        body: [
          `If we change these terms, we change this page and the date at the top before the change takes effect. Every change can be seen in its <a href="${GITHUB}/commits/main/site/content/terms.mjs">history on GitHub</a>.`,
        ],
      },
    ],
  },
  da: {
    path: "/da/terms/",
    title: "Vilkår for testtjenesten: Plainphone",
    description: "De korte vilkår for Plainphones hostede testtjeneste: en alfaversion, gratis, leveret som den er og aldrig slettet uden 30 dages varsel.",
    h1: "Vilkår for testtjenesten",
    updated: "Sidst opdateret 22. november 2026",
    lead: "Vilkårene gælder for den hostede testtjeneste: forældrepanelet på app.plainphone.org, appen Plainphone Parent, når den bruger tjenesten, og webfilteret på dns.plainphone.org. De er korte med vilje.",
    tocLabel: "På denne side",
    sections: [
      {
        id: "udbyder",
        title: "Hvem står bag",
        body: [
          `Testtjenesten leveres af <a href="https://mahoje.dk">Mahoje</a> (CVR 39413892) i Danmark, som vedligeholder Plainphone. Spørgsmål sendes til ${mail("support@plainphone.org")}. Spørgsmål om dine data sendes til ${mail("privacy@plainphone.org")}.`,
          "Dansk ret gælder. Det tager ikke den beskyttelse fra dig, som loven i det land, du bor i, giver dig.",
        ],
      },
      {
        id: "alfa",
        title: "Det er en alfaversion",
        body: [
          "Plainphone er en alfaversion. Den er kun testet lidt på rigtige telefoner, og ingen udefra har gennemgået sikkerheden. Ting vil ændre sig, og noget vil gå i stykker. Prøv den på en ekstra telefon, og gør den ikke til den eneste telefon, et barn er afhængigt af.",
        ],
      },
      {
        id: "som-den-er",
        title: "Leveret som den er",
        body: [
          "Vi leverer testtjenesten, som den er, uden nogen garanti. Vi arbejder på at holde den kørende og sikker, men vi kan ikke love, at den altid er tilgængelig, at den virker på din telefon, eller at den er uden fejl. Den erstatter ikke, at du taler med dit barn og selv holder øje.",
          "I det omfang loven tillader det, er Mahoje ikke ansvarlig for tab, der skyldes brug af testtjenesten. Det begrænser ikke rettigheder, som loven giver dig, og som ikke kan fraviges.",
        ],
      },
      {
        id: "gratis",
        title: "Det er gratis",
        body: [
          "Testtjenesten er gratis. Der er intet at betale, og den tager ikke imod betaling i alfaperioden. Hvis det ændrer sig, siger vi det i god tid og ændrer først disse vilkår. Det er fortsat gratis at køre Plainphone på din egen server og at have én fuldt beskyttet telefon på den hostede tjeneste.",
        ],
      },
      {
        id: "data",
        title: "Dine data",
        body: [
          `Vi beholder dataene på testtjenesten i alfaperioden. Vi sletter dem aldrig uden at sige det mindst 30 dage før, med en mail til alle med en konto og i <a href="${ANNOUNCEMENTS}">Discussions → Announcements</a> på GitHub. Beskeden fortæller, hvad der sker med dine telefoner, og hvordan du kommer ud. <a href="/da/privacy/">Privatlivspolitikken</a> fortæller, hvad vi gemmer, og hvor længe.`,
        ],
      },
      {
        id: "brug",
        title: "Når du bruger den",
        body: [
          "Brug testtjenesten til telefoner, du har ansvaret for: dit barns telefon eller din egen. Fortæl dit barn, hvad Plainphone gør på telefonen.",
          `Prøv ikke at bryde ind i tjenesten eller i andre husstande. Finder du et sikkerhedsproblem, så meld det privat som beskrevet i <a href="${GITHUB}/blob/main/SECURITY.md">SECURITY.md</a>.`,
          "Du kan slette din konto når som helst under Indstillinger. Vi kan lukke en konto, der bruges til at misbruge tjenesten eller skade andre, og vi fortæller kontoindehaveren hvorfor. Hvis testtjenesten lukker, får du det samme varsel på 30 dage.",
        ],
      },
      {
        id: "software",
        title: "Softwaren",
        body: [
          `Plainphones software er open source under <a href="${GITHUB}/blob/main/LICENSE">Apache License 2.0</a>. Vilkårene gælder kun den hostede testtjeneste, ikke koden. Kører du Plainphone på din egen server, gælder vilkårene ikke for den, og du har selv ansvaret for serveren. Navnet og logoet er omfattet af <a href="${GITHUB}/blob/main/TRADEMARK.md">varemærkepolitikken</a>.`,
        ],
      },
      {
        id: "aendringer",
        title: "Ændringer i vilkårene",
        body: [
          `Ændrer vi vilkårene, ændrer vi denne side og datoen øverst, før ændringen træder i kraft. Alle ændringer kan ses i <a href="${GITHUB}/commits/main/site/content/terms.mjs">historikken på GitHub</a>.`,
        ],
      },
    ],
  },
  sv: {
    path: "/sv/terms/",
    title: "Villkor för testtjänsten: Plainphone",
    description: "De korta villkoren för Plainphones värdade testtjänst: en alfaversion, gratis, i befintligt skick och aldrig raderad utan 30 dagars varsel.",
    h1: "Villkor för testtjänsten",
    updated: "Senast uppdaterad 22 november 2026",
    lead: "Villkoren gäller för den värdade testtjänsten: föräldrapanelen på app.plainphone.org, appen Plainphone Parent när den använder tjänsten och webbfiltret på dns.plainphone.org. De är korta med flit.",
    tocLabel: "På den här sidan",
    sections: [
      {
        id: "provider",
        title: "Vem som tillhandahåller den",
        body: [
          `Testtjänsten tillhandahålls av <a href="https://mahoje.dk">Mahoje</a> (CVR 39413892) i Danmark, som underhåller Plainphone. Frågor skickas till ${mail("support@plainphone.org")}. Frågor om dina uppgifter skickas till ${mail("privacy@plainphone.org")}.`,
          "Dansk lag gäller. Det tar inte bort något skydd som du har enligt lagen i det land där du bor.",
        ],
      },
      {
        id: "alpha",
        title: "Det är en alfaversion",
        body: [
          "Plainphone är en alfaversion. Den har testats lite på riktiga telefoner och ingen extern säkerhetsgranskning har gjorts. Saker kommer att ändras, och något kommer att gå sönder. Prova den på en extra telefon, och gör den inte till den enda telefon ett barn förlitar sig på.",
        ],
      },
      {
        id: "as-is",
        title: "I befintligt skick",
        body: [
          "Vi tillhandahåller testtjänsten i befintligt skick, utan garantier. Vi arbetar för att hålla den igång och säker, men vi kan inte lova att den alltid är tillgänglig, att den fungerar på din telefon eller att den är fri från fel. Den ersätter inte att du pratar med ditt barn och själv håller ett öga på saker.",
          "I den mån lagen tillåter är Mahoje inte ansvarigt för förluster som beror på att testtjänsten används. Det begränsar inte rättigheter som du har enligt lag och som inte kan avtalas bort.",
        ],
      },
      {
        id: "free",
        title: "Den är gratis",
        body: [
          "Testtjänsten är gratis. Det finns inget att betala, och den tar inte emot betalningar under alfaperioden. Om det ändras säger vi det i god tid och ändrar först de här villkoren. Att köra Plainphone på din egen server och att ha en fullt skyddad telefon på den värdade tjänsten förblir gratis.",
        ],
      },
      {
        id: "data",
        title: "Dina uppgifter",
        body: [
          `Vi behåller uppgifterna i testtjänsten under alfaperioden. Vi raderar dem aldrig utan att säga till minst 30 dagar innan, med ett mejl till alla som har ett konto och i <a href="${ANNOUNCEMENTS}">Discussions → Announcements</a> på GitHub. Meddelandet säger vad som händer med dina telefoner och hur du tar dig ur. <a href="/sv/privacy/">Integritetspolicyn</a> säger vad vi sparar och hur länge.`,
        ],
      },
      {
        id: "use",
        title: "När du använder den",
        body: [
          "Använd testtjänsten för telefoner som du ansvarar för: ditt barns telefon eller din egen. Berätta för ditt barn vad Plainphone gör på telefonen.",
          `Försök inte ta dig in i tjänsten eller i andra hushåll. Om du hittar ett säkerhetsproblem, rapportera det privat enligt <a href="${GITHUB}/blob/main/SECURITY.md">SECURITY.md</a>.`,
          "Du kan radera ditt konto när som helst under Inställningar. Vi kan stänga ett konto som används för att missbruka tjänsten eller skada andra, och vi berättar för kontoinnehavaren varför. Om testtjänsten stängs får du samma varsel på 30 dagar.",
        ],
      },
      {
        id: "software",
        title: "Programvaran",
        body: [
          `Plainphones programvara är öppen källkod under <a href="${GITHUB}/blob/main/LICENSE">Apache License 2.0</a>. Villkoren gäller bara den värdade testtjänsten, inte koden. Om du kör Plainphone på din egen server gäller villkoren inte för den, och du ansvarar själv för servern. Namnet och logotypen omfattas av <a href="${GITHUB}/blob/main/TRADEMARK.md">varumärkespolicyn</a>.`,
        ],
      },
      {
        id: "changes",
        title: "Ändringar av villkoren",
        body: [
          `Om vi ändrar villkoren ändrar vi den här sidan och datumet högst upp innan ändringen börjar gälla. Alla ändringar syns i <a href="${GITHUB}/commits/main/site/content/terms.mjs">historiken på GitHub</a>.`,
        ],
      },
    ],
  },
  nb: {
    path: "/nb/terms/",
    title: "Vilkår for testtjenesten: Plainphone",
    description: "De korte vilkårene for Plainphones driftede testtjeneste: en alfaversjon, gratis, levert som den er og aldri slettet uten 30 dagers varsel.",
    h1: "Vilkår for testtjenesten",
    updated: "Sist oppdatert 22. november 2026",
    lead: "Vilkårene gjelder for den driftede testtjenesten: foreldrepanelet på app.plainphone.org, appen Plainphone Parent når den bruker tjenesten, og nettfilteret på dns.plainphone.org. De er korte med vilje.",
    tocLabel: "På denne siden",
    sections: [
      {
        id: "provider",
        title: "Hvem som leverer den",
        body: [
          `Testtjenesten leveres av <a href="https://mahoje.dk">Mahoje</a> (CVR 39413892) i Danmark, som vedlikeholder Plainphone. Spørsmål sendes til ${mail("support@plainphone.org")}. Spørsmål om dine data sendes til ${mail("privacy@plainphone.org")}.`,
          "Dansk rett gjelder. Det tar ikke fra deg beskyttelse du har etter loven i landet du bor i.",
        ],
      },
      {
        id: "alpha",
        title: "Det er en alfaversjon",
        body: [
          "Plainphone er en alfaversjon. Den er lite testet på ekte telefoner, og ingen ekstern sikkerhetsgjennomgang er gjort. Ting vil endre seg, og noe vil gå i stykker. Prøv den på en ekstra telefon, og ikke gjør den til den eneste telefonen et barn er avhengig av.",
        ],
      },
      {
        id: "as-is",
        title: "Levert som den er",
        body: [
          "Vi leverer testtjenesten som den er, uten noen garanti. Vi jobber for å holde den i gang og sikker, men vi kan ikke love at den alltid er tilgjengelig, at den virker på telefonen din eller at den er uten feil. Den erstatter ikke at du snakker med barnet ditt og selv følger med.",
          "Så langt loven tillater det, er Mahoje ikke ansvarlig for tap som skyldes bruk av testtjenesten. Dette begrenser ikke rettigheter du har etter loven og som ikke kan fravikes.",
        ],
      },
      {
        id: "free",
        title: "Den er gratis",
        body: [
          "Testtjenesten er gratis. Det er ingenting å betale, og den tar ikke imot betaling i alfaperioden. Hvis det endrer seg, sier vi fra i god tid og endrer disse vilkårene først. Det forblir gratis å kjøre Plainphone på din egen server og å ha én fullt beskyttet telefon på den driftede tjenesten.",
        ],
      },
      {
        id: "data",
        title: "Dine data",
        body: [
          `Vi beholder dataene på testtjenesten i alfaperioden. Vi sletter dem aldri uten å si fra minst 30 dager før, med en e-post til alle som har en konto og i <a href="${ANNOUNCEMENTS}">Discussions → Announcements</a> på GitHub. Meldingen sier hva som skjer med telefonene dine og hvordan du kommer deg ut. <a href="/nb/privacy/">Personvernerklæringen</a> sier hva vi lagrer og hvor lenge.`,
        ],
      },
      {
        id: "use",
        title: "Når du bruker den",
        body: [
          "Bruk testtjenesten for telefoner du har ansvar for: barnets telefon eller din egen. Fortell barnet ditt hva Plainphone gjør på telefonen.",
          `Ikke prøv å bryte deg inn i tjenesten eller i andre husstander. Finner du et sikkerhetsproblem, meld det privat som beskrevet i <a href="${GITHUB}/blob/main/SECURITY.md">SECURITY.md</a>.`,
          "Du kan slette kontoen din når som helst under Innstillinger. Vi kan stenge en konto som brukes til å misbruke tjenesten eller skade andre, og vi forteller kontoinnehaveren hvorfor. Hvis testtjenesten stenger, får du det samme varselet på 30 dager.",
        ],
      },
      {
        id: "software",
        title: "Programvaren",
        body: [
          `Plainphones programvare er åpen kildekode under <a href="${GITHUB}/blob/main/LICENSE">Apache License 2.0</a>. Vilkårene gjelder bare den driftede testtjenesten, ikke koden. Kjører du Plainphone på din egen server, gjelder ikke vilkårene for den, og du har selv ansvaret for serveren. Navnet og logoen er omfattet av <a href="${GITHUB}/blob/main/TRADEMARK.md">varemerkepolicyen</a>.`,
        ],
      },
      {
        id: "changes",
        title: "Endringer i vilkårene",
        body: [
          `Endrer vi vilkårene, endrer vi denne siden og datoen øverst før endringen trer i kraft. Alle endringer kan ses i <a href="${GITHUB}/commits/main/site/content/terms.mjs">historikken på GitHub</a>.`,
        ],
      },
    ],
  },
  de: {
    path: "/de/terms/",
    title: "Nutzungsbedingungen des Testdienstes: Plainphone",
    description: "Die kurzen Bedingungen für den gehosteten Testdienst von Plainphone: eine Alphaversion, kostenlos, ohne Gewähr und nie ohne 30 Tage Vorankündigung gelöscht.",
    h1: "Nutzungsbedingungen des Testdienstes",
    updated: "Zuletzt aktualisiert am 22. November 2026",
    lead: "Diese Bedingungen gelten für den gehosteten Testdienst: das Dashboard auf app.plainphone.org, die App Plainphone Parent, wenn sie diesen Dienst nutzt, und den Webfilter auf dns.plainphone.org. Sie sind mit Absicht kurz.",
    tocLabel: "Auf dieser Seite",
    sections: [
      {
        id: "provider",
        title: "Wer ihn anbietet",
        body: [
          `Der Testdienst wird von <a href="https://mahoje.dk">Mahoje</a> (CVR 39413892) in Dänemark angeboten, das Plainphone pflegt. Fragen senden Sie an ${mail("support@plainphone.org")}. Fragen zu Ihren Daten senden Sie an ${mail("privacy@plainphone.org")}.`,
          "Es gilt dänisches Recht. Den Schutz, den Ihnen das Recht des Landes gibt, in dem Sie leben, verlieren Sie dadurch nicht.",
        ],
      },
      {
        id: "alpha",
        title: "Es ist eine Alphaversion",
        body: [
          "Plainphone ist eine Alphaversion. Es wurde wenig auf echten Telefonen getestet, und es gab keine externe Sicherheitsprüfung. Vieles wird sich ändern, und manches wird kaputtgehen. Probieren Sie es auf einem Zweittelefon aus, und machen Sie es nicht zum einzigen Telefon, auf das sich ein Kind verlässt.",
        ],
      },
      {
        id: "as-is",
        title: "Ohne Gewähr",
        body: [
          "Wir stellen den Testdienst so bereit, wie er ist, ohne jede Gewähr. Wir arbeiten daran, dass er läuft und sicher ist, können aber nicht versprechen, dass er immer erreichbar ist, auf Ihrem Telefon funktioniert oder fehlerfrei ist. Er ersetzt nicht, dass Sie mit Ihrem Kind sprechen und selbst ein Auge darauf haben.",
          "Soweit das Gesetz es erlaubt, haftet Mahoje nicht für Schäden, die aus der Nutzung des Testdienstes entstehen. Das schränkt keine Rechte ein, die Ihnen das Gesetz zwingend gibt.",
        ],
      },
      {
        id: "free",
        title: "Er ist kostenlos",
        body: [
          "Der Testdienst ist kostenlos. Es gibt nichts zu bezahlen, und er nimmt während der Alphaphase keine Zahlungen an. Wenn sich das ändert, sagen wir es rechtzeitig vorher und ändern zuerst diese Bedingungen. Plainphone auf dem eigenen Server und ein voll geschütztes Telefon im gehosteten Dienst bleiben kostenlos.",
        ],
      },
      {
        id: "data",
        title: "Ihre Daten",
        body: [
          `Während der Alphaphase behalten wir die Daten im Testdienst. Wir löschen sie nie, ohne es mindestens 30 Tage vorher anzukündigen, per E-Mail an alle mit einem Konto und unter <a href="${ANNOUNCEMENTS}">Discussions → Announcements</a> auf GitHub. Die Ankündigung sagt, was mit Ihren Telefonen passiert und wie Sie herauskommen. Die <a href="/de/privacy/">Datenschutzerklärung</a> sagt, was wir speichern und wie lange.`,
        ],
      },
      {
        id: "use",
        title: "Wenn Sie ihn nutzen",
        body: [
          "Nutzen Sie den Testdienst für Telefone, für die Sie verantwortlich sind: das Telefon Ihres Kindes oder Ihr eigenes. Sagen Sie Ihrem Kind, was Plainphone auf seinem Telefon macht.",
          `Versuchen Sie nicht, in den Dienst oder in andere Haushalte einzudringen. Wenn Sie ein Sicherheitsproblem finden, melden Sie es vertraulich, wie in <a href="${GITHUB}/blob/main/SECURITY.md">SECURITY.md</a> beschrieben.`,
          "Sie können Ihr Konto jederzeit unter Einstellungen löschen. Wir können ein Konto schließen, das genutzt wird, um den Dienst zu missbrauchen oder anderen zu schaden, und sagen der Kontoinhaberin oder dem Kontoinhaber, warum. Wenn der Testdienst eingestellt wird, gilt dieselbe Ankündigungsfrist von 30 Tagen.",
        ],
      },
      {
        id: "software",
        title: "Die Software",
        body: [
          `Die Software von Plainphone ist Open Source unter der <a href="${GITHUB}/blob/main/LICENSE">Apache License 2.0</a>. Diese Bedingungen gelten nur für den gehosteten Testdienst, nicht für den Code. Wenn Sie Plainphone auf Ihrem eigenen Server betreiben, gelten diese Bedingungen dort nicht, und Sie sind selbst für den Server verantwortlich. Name und Logo fallen unter die <a href="${GITHUB}/blob/main/TRADEMARK.md">Markenrichtlinie</a>.`,
        ],
      },
      {
        id: "changes",
        title: "Änderungen dieser Bedingungen",
        body: [
          `Wenn wir diese Bedingungen ändern, ändern wir diese Seite und das Datum oben, bevor die Änderung gilt. Jede Änderung ist in der <a href="${GITHUB}/commits/main/site/content/terms.mjs">Versionsgeschichte auf GitHub</a> zu sehen.`,
        ],
      },
    ],
  },
};
