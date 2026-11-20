// SPDX-License-Identifier: Apache-2.0
// Front page copy that belongs to the "Switch" design: the switch panel in the hero,
// what is always on and what you choose, who decides, what the child sees, the two
// setup modes and the closing call to action. Keep the five languages in step.
// Rows are [label, on] or [label, detail, on]; `on` is 1 for on and 0 for off.
// `shots` is the alt text and caption of every picture from `pnpm site:screenshots` (real screens, a fictional
// child called Sam). `panel` is no longer shown on the page; the share images still use it.
export const home = {
  en: {
    nav: { how: "How it works", apps: "Apps", language: "Language" },
    note: "Free and open source. You can run your own server.",
    panel: {
      caption: "Example: Sam’s phone",
      rows: [["Calls", 1], ["Messages", 1], ["Camera", 1], ["Maps", 1], ["Social media", 0], ["App store", 0]],
      on: "on",
      off: "off",
      foot: "You decide what is on. Sam can see it.",
    },
    switches: {
      title: "Everything is a switch",
      lead: "You choose what is on. The phone shows the same choices to the person using it, so nothing happens behind their back.",
      alwaysTitle: "Always on",
      alwaysBody: "No one can switch these off, not in school time and not at night.",
      always: [
        ["112 and emergency numbers", "Android places the call."],
        ["Calls with parents", "A child can always call the parents, and the parents can always call the child."],
      ],
      alwaysOn: "always on",
      chooseTitle: "You choose",
      chooseBody: "Each one starts from a sensible default, and you can change it at any time.",
      choose: [
        ["Apps", "Pick apps from the catalog. Others stay hidden until you allow them."],
        ["Time limits", "A daily time for games or a single app. The phone gives a quiet warning 5 minutes before, and your child can ask for more."],
        ["School time and bedtime", "Choose which apps work, and when."],
        ["Web filter", "Blocks the categories you choose. It doesn’t catch everything."],
        ["Contacts", "Calls and texts with the people you approve."],
        ["Location", "Off, only when you ask, or on for a while. The phone says when it is shared."],
      ],
    },
    decide: {
      title: "Who decides",
      body: [
        "For a child, the parents decide, ideally together with the child. Set the rules in the parent dashboard or the parent app, and change them as your child grows.",
        "On your own phone, you decide. Loosening a rule can wait for a delay or for someone you trust to approve it, and you can always cancel.",
      ],
    },
    sees: {
      title: "The child sees it",
      extra: "On the phone, “What can my parents see?” explains the current rules and lists each time the location was sent.",
    },
    shots: {
      note: "Screenshots of the real dashboard and phone app, with a fictional child.",
      dashboard: { alt: "The parent dashboard for Sam’s phone. School time, web filter and asking for more time are on. Location and weekly summary are off.", caption: "The parent dashboard" },
      requests: { alt: "The parent dashboard shows that Sam’s phone asks for more time on Maps. The parent can answer 15 minutes, 1 hour, rest of the day, or no.", caption: "A request from the phone" },
      home: { alt: "The child’s home screen during school time: the time 10:32, “School time until 14:00”, four apps, and the buttons Phone, Messages and SOS.", caption: "Home screen in school time" },
      blocked: { alt: "The phone’s stop screen when the time for Music is used up. It has a button to ask for more time, one to call or message a parent, and one back to the start.", caption: "When time is up" },
      sharing: { alt: "The phone’s page “What can my parents see?”. It says when the parents get the phone’s location and lists each time it was sent.", caption: "“What can my parents see?”" },
    },
    modes: {
      title: "Two ways to set it up",
      caption: "Strong and light mode compared",
      corner: "Difference",
      rows: [
        ["The phone", "New or reset", "Already in use"],
        ["What is on it", "Erased by the reset", "Kept"],
        ["Getting around the rules", "Harder. Android settings and app installs are protected.", "Easier. The permissions can be removed."],
      ],
    },
    free: "Free and open",
    closing: {
      title: "Start with one phone.",
      body: "Set it up together, try a call and the apps you need, and change the rules as you go.",
    },
  },
  da: {
    nav: { how: "Sådan virker det", apps: "Apps", language: "Sprog" },
    note: "Gratis og open source. Du kan selv drive serveren.",
    panel: {
      caption: "Eksempel: Sams telefon",
      rows: [["Opkald", 1], ["Sms", 1], ["Kamera", 1], ["Kort", 1], ["Sociale medier", 0], ["App-butik", 0]],
      on: "til",
      off: "fra",
      foot: "Du bestemmer, hvad der er tændt. Sam kan se det.",
    },
    switches: {
      title: "Alt kan slås til og fra",
      lead: "Du vælger, hvad der er slået til. Telefonen viser de samme valg til den, der bruger den, så intet sker bag ryggen på nogen.",
      alwaysTitle: "Altid slået til",
      alwaysBody: "Dem kan ingen slå fra, heller ikke i skoletiden eller om natten.",
      always: [
        ["112 og alarmnumre", "Android foretager opkaldet."],
        ["Opkald med forældrene", "Barnet kan altid ringe til forældrene, og forældrene kan altid ringe til barnet."],
      ],
      alwaysOn: "altid til",
      chooseTitle: "Det vælger du",
      chooseBody: "Hvert valg starter et fornuftigt sted, og du kan ændre det når som helst.",
      choose: [
        ["Apps", "Vælg apps fra kataloget. Resten er skjult, indtil du giver adgang."],
        ["Tidsgrænser", "En daglig tid til spil eller til en enkelt app. Telefonen advarer stille 5 minutter før, og dit barn kan bede om mere."],
        ["Skoletid og sengetid", "Vælg, hvilke apps der virker, og hvornår."],
        ["Webfilter", "Blokerer de kategorier, du vælger. Det fanger ikke alt."],
        ["Kontakter", "Opkald og sms med de personer, du godkender."],
        ["Placering", "Fra, kun når du spørger, eller til i et stykke tid. Telefonen siger til, når den deles."],
      ],
    },
    decide: {
      title: "Hvem bestemmer",
      body: [
        "For et barn bestemmer forældrene, helst sammen med barnet. Sæt reglerne i forældrepanelet eller forældreappen, og ret dem, efterhånden som barnet bliver ældre.",
        "På din egen telefon bestemmer du. Før en regel bliver lempet, kan der være en ventetid, eller en, du stoler på, kan skulle godkende den. Du kan altid fortryde.",
      ],
    },
    sees: {
      title: "Barnet kan se det",
      extra: "På telefonen forklarer „Hvad kan mine forældre se?“ de regler, der gælder, og viser hver gang, placeringen er blevet sendt.",
    },
    shots: {
      note: "Skærmbilleder af det rigtige forældrepanel og den rigtige telefon-app, med et opdigtet barn.",
      dashboard: { alt: "Forældrepanelet for Sams telefon. Skoletid, webfilter og at bede om mere tid er slået til. Placering og ugeoversigt er slået fra.", caption: "Forældrepanelet" },
      requests: { alt: "Forældrepanelet viser, at Sams telefon beder om mere tid på Kort. Forælderen kan svare 15 minutter, 1 time, resten af dagen eller nej.", caption: "En anmodning fra telefonen" },
      home: { alt: "Barnets startskærm i skoletiden: klokken 10.32, „Skoletid til 14.00“, fire apps og knapperne Telefon, Beskeder og SOS.", caption: "Startskærm i skoletiden" },
      blocked: { alt: "Telefonens stopskærm, når tiden i Musik er brugt. Den har en knap til at bede om mere tid, en til at ringe eller skrive til en forælder og en tilbage til start.", caption: "Når tiden er brugt" },
      sharing: { alt: "Telefonens side „Hvad kan mine forældre se?“. Den fortæller, hvornår forældrene får telefonens placering, og viser hver gang, den er sendt.", caption: "„Hvad kan mine forældre se?“" },
    },
    modes: {
      title: "To måder at sætte den op på",
      caption: "Stærk og let tilstand sammenlignet",
      corner: "Forskel",
      rows: [
        ["Telefonen", "Ny eller nulstillet", "Allerede i brug"],
        ["Indholdet på den", "Slettes ved nulstillingen", "Bliver på telefonen"],
        ["At komme uden om reglerne", "Sværere. Androids indstillinger og installation af apps er beskyttet.", "Lettere. Tilladelserne kan fjernes."],
      ],
    },
    free: "Gratis og åben",
    closing: {
      title: "Start med én telefon.",
      body: "Sæt den op sammen, prøv et opkald og de apps, I har brug for, og ret reglerne undervejs.",
    },
  },
  sv: {
    nav: { how: "Så fungerar det", apps: "Appar", language: "Språk" },
    note: "Gratis och öppen källkod. Du kan köra servern själv.",
    panel: {
      caption: "Exempel: Sams telefon",
      rows: [["Samtal", 1], ["Sms", 1], ["Kamera", 1], ["Kartor", 1], ["Sociala medier", 0], ["Appbutik", 0]],
      on: "på",
      off: "av",
      foot: "Du bestämmer vad som är på. Sam kan se det.",
    },
    switches: {
      title: "Allt kan slås på och av",
      lead: "Du väljer vad som är på. Telefonen visar samma val för den som använder den, så inget händer bakom ryggen på någon.",
      alwaysTitle: "Alltid på",
      alwaysBody: "Ingen kan stänga av dem, inte under skoltid och inte på natten.",
      always: [
        ["112 och nödnummer", "Android ringer samtalet."],
        ["Samtal med föräldrarna", "Barnet kan alltid ringa föräldrarna, och föräldrarna kan alltid ringa barnet."],
      ],
      alwaysOn: "alltid på",
      chooseTitle: "Det här väljer du",
      chooseBody: "Varje val börjar med en rimlig standard, och du kan ändra det när som helst.",
      choose: [
        ["Appar", "Välj appar ur katalogen. Andra är dolda tills du tillåter dem."],
        ["Tidsgränser", "En daglig tid för spel eller för en enskild app. Telefonen varnar tyst 5 minuter innan, och ditt barn kan be om mer."],
        ["Skoltid och läggdags", "Välj vilka appar som fungerar, och när."],
        ["Webbfilter", "Blockerar de kategorier du väljer. Det fångar inte allt."],
        ["Kontakter", "Samtal och sms med de personer du godkänner."],
        ["Plats", "Av, bara när du frågar eller på en stund. Telefonen säger till när den delas."],
      ],
    },
    decide: {
      title: "Vem bestämmer",
      body: [
        "För ett barn bestämmer föräldrarna, helst tillsammans med barnet. Ställ in reglerna i föräldrapanelen eller föräldraappen och ändra dem när barnet blir äldre.",
        "På din egen telefon bestämmer du. En lättnad i reglerna kan få vänta en tid eller behöva godkännas av någon du litar på, och du kan alltid ångra.",
      ],
    },
    sees: {
      title: "Barnet ser det",
      extra: "På telefonen förklarar ”Vad kan mina föräldrar se?” vilka regler som gäller och visar varje gång platsen har skickats.",
    },
    shots: {
      note: "Skärmbilder av den riktiga föräldrapanelen och telefonappen, med ett påhittat barn.",
      dashboard: { alt: "Föräldrapanelen för Sams telefon. Skoltid, webbfilter och att be om mer tid är på. Plats och veckosammanfattning är av.", caption: "Föräldrapanelen" },
      requests: { alt: "Föräldrapanelen visar att Sams telefon ber om mer tid i Kartor. Föräldern kan svara 15 minuter, 1 timme, resten av dagen eller nej.", caption: "En förfrågan från telefonen" },
      home: { alt: "Barnets startskärm under skoltid: klockan 10:32, ”Skoltid till 14:00”, fyra appar och knapparna Telefon, Meddelanden och SOS.", caption: "Startskärm under skoltid" },
      blocked: { alt: "Telefonens stoppskärm när tiden i Musik är slut. Den har en knapp för att be om mer tid, en för att ringa eller skriva till en förälder och en tillbaka till start.", caption: "När tiden är slut" },
      sharing: { alt: "Telefonens sida ”Vad kan mina föräldrar se?”. Den berättar när föräldrarna får telefonens plats och visar varje gång den har skickats.", caption: "”Vad kan mina föräldrar se?”" },
    },
    modes: {
      title: "Två sätt att ställa in den",
      caption: "Starkt och lätt läge jämförda",
      corner: "Skillnad",
      rows: [
        ["Telefonen", "Ny eller återställd", "Redan i bruk"],
        ["Innehållet på den", "Raderas vid återställningen", "Finns kvar"],
        ["Att kringgå reglerna", "Svårare. Androids inställningar och appinstallationer är skyddade.", "Lättare. Behörigheterna kan tas bort."],
      ],
    },
    free: "Gratis och öppen",
    closing: {
      title: "Börja med en telefon.",
      body: "Ställ in den tillsammans, testa ett samtal och de appar ni behöver och ändra reglerna efter hand.",
    },
  },
  nb: {
    nav: { how: "Slik fungerer det", apps: "Apper", language: "Språk" },
    note: "Gratis og åpen kildekode. Du kan drifte serveren selv.",
    panel: {
      caption: "Eksempel: Sams telefon",
      rows: [["Samtaler", 1], ["SMS", 1], ["Kamera", 1], ["Kart", 1], ["Sosiale medier", 0], ["Appbutikk", 0]],
      on: "på",
      off: "av",
      foot: "Du bestemmer hva som er på. Sam kan se det.",
    },
    switches: {
      title: "Alt kan slås av og på",
      lead: "Du velger hva som er på. Telefonen viser de samme valgene til den som bruker den, så ingenting skjer bak ryggen på noen.",
      alwaysTitle: "Alltid på",
      alwaysBody: "Ingen kan slå dem av, verken i skoletiden eller om natten.",
      always: [
        ["112 og nødnumre", "Android ringer opp."],
        ["Samtaler med foreldrene", "Barnet kan alltid ringe foreldrene, og foreldrene kan alltid ringe barnet."],
      ],
      alwaysOn: "alltid på",
      chooseTitle: "Dette velger du",
      chooseBody: "Hvert valg starter med en fornuftig standard, og du kan endre det når som helst.",
      choose: [
        ["Apper", "Velg apper fra katalogen. Andre er skjult til du tillater dem."],
        ["Tidsgrenser", "En daglig tid for spill eller én bestemt app. Telefonen varsler stille 5 minutter før, og barnet ditt kan be om mer."],
        ["Skoletid og leggetid", "Velg hvilke apper som virker, og når."],
        ["Nettfilter", "Blokkerer kategoriene du velger. Det fanger ikke alt."],
        ["Kontakter", "Samtaler og SMS med personene du godkjenner."],
        ["Posisjon", "Av, bare når du spør, eller på en stund. Telefonen sier fra når den deles."],
      ],
    },
    decide: {
      title: "Hvem bestemmer",
      body: [
        "For et barn bestemmer foreldrene, helst sammen med barnet. Sett reglene i foreldrepanelet eller foreldreappen, og endre dem etter hvert som barnet blir eldre.",
        "På din egen telefon bestemmer du. En lettelse i reglene kan måtte vente en stund eller godkjennes av noen du stoler på, og du kan alltid angre.",
      ],
    },
    sees: {
      title: "Barnet ser det",
      extra: "På telefonen forklarer «Hva kan foreldrene mine se?» reglene som gjelder, og viser hver gang posisjonen er sendt.",
    },
    shots: {
      note: "Skjermbilder av det ekte foreldrepanelet og telefonappen, med et oppdiktet barn.",
      dashboard: { alt: "Foreldrepanelet for Sams telefon. Skoletid, nettfilter og det å be om mer tid er på. Posisjon og ukesammendrag er av.", caption: "Foreldrepanelet" },
      requests: { alt: "Foreldrepanelet viser at Sams telefon ber om mer tid i Kart. Forelderen kan svare 15 minutter, 1 time, resten av dagen eller nei.", caption: "En forespørsel fra telefonen" },
      home: { alt: "Barnets startskjerm i skoletiden: klokka 10:32, «Skoletid til 14:00», fire apper og knappene Telefon, Meldinger og SOS.", caption: "Startskjerm i skoletiden" },
      blocked: { alt: "Telefonens stoppskjerm når tiden i Musikk er brukt opp. Den har en knapp for å be om mer tid, en for å ringe eller skrive til en forelder og en tilbake til start.", caption: "Når tiden er brukt opp" },
      sharing: { alt: "Telefonens side «Hva kan foreldrene mine se?». Den forteller når foreldrene får posisjonen til telefonen, og viser hver gang den er sendt.", caption: "«Hva kan foreldrene mine se?»" },
    },
    modes: {
      title: "To måter å sette den opp på",
      caption: "Sterk og lett modus sammenlignet",
      corner: "Forskjell",
      rows: [
        ["Telefonen", "Ny eller tilbakestilt", "Allerede i bruk"],
        ["Innholdet på den", "Slettes ved tilbakestillingen", "Blir værende"],
        ["Å omgå reglene", "Vanskeligere. Androids innstillinger og installering av apper er beskyttet.", "Enklere. Tillatelsene kan fjernes."],
      ],
    },
    free: "Gratis og åpen",
    closing: {
      title: "Start med én telefon.",
      body: "Sett den opp sammen, prøv en samtale og appene dere trenger, og endre reglene underveis.",
    },
  },
  de: {
    nav: { how: "So funktioniert es", apps: "Apps", language: "Sprache" },
    note: "Kostenlos und Open Source. Sie können den Server selbst betreiben.",
    panel: {
      caption: "Beispiel: Sams Handy",
      rows: [["Anrufe", 1], ["SMS", 1], ["Kamera", 1], ["Karten", 1], ["Soziale Medien", 0], ["App-Store", 0]],
      on: "an",
      off: "aus",
      foot: "Sie entscheiden, was an ist. Sam kann es sehen.",
    },
    switches: {
      title: "Alles lässt sich an- und ausschalten",
      lead: "Sie wählen, was eingeschaltet ist. Das Handy zeigt dieselben Einstellungen der Person, die es benutzt. So passiert nichts hinter ihrem Rücken.",
      alwaysTitle: "Immer an",
      alwaysBody: "Diese kann niemand ausschalten, weder in der Schulzeit noch nachts.",
      always: [
        ["112 und Notrufnummern", "Android stellt den Anruf her."],
        ["Anrufe mit den Eltern", "Das Kind kann die Eltern immer anrufen, und die Eltern erreichen das Kind immer."],
      ],
      alwaysOn: "immer an",
      chooseTitle: "Das wählen Sie",
      chooseBody: "Jede Einstellung beginnt mit einem sinnvollen Standard, und Sie können sie jederzeit ändern.",
      choose: [
        ["Apps", "Wählen Sie Apps aus dem Katalog. Andere bleiben verborgen, bis Sie sie erlauben."],
        ["Zeitlimits", "Eine tägliche Zeit für Spiele oder eine einzelne App. Das Handy warnt leise 5 Minuten vorher, und Ihr Kind kann um mehr Zeit bitten."],
        ["Schulzeit und Schlafenszeit", "Wählen Sie, welche Apps wann funktionieren."],
        ["Webfilter", "Sperrt die Kategorien, die Sie wählen. Er erkennt nicht alles."],
        ["Kontakte", "Anrufe und SMS mit den Personen, die Sie freigeben."],
        ["Standort", "Aus, nur auf Anfrage oder eine Weile an. Das Handy zeigt an, wenn er geteilt wird."],
      ],
    },
    decide: {
      title: "Wer entscheidet",
      body: [
        "Bei einem Kind entscheiden die Eltern, am besten gemeinsam mit dem Kind. Legen Sie die Regeln im Elternbereich oder in der Eltern-App fest und passen Sie sie an, wenn Ihr Kind älter wird.",
        "Auf Ihrem eigenen Handy entscheiden Sie. Eine Lockerung kann eine Wartezeit haben oder die Zustimmung einer Vertrauensperson brauchen, und Sie können jederzeit abbrechen.",
      ],
    },
    sees: {
      title: "Das Kind sieht es",
      extra: "Auf dem Handy erklärt „Was können meine Eltern sehen?“ die geltenden Regeln und listet jedes Mal auf, wenn der Standort gesendet wurde.",
    },
    shots: {
      note: "Bildschirmfotos des echten Elternpanels und der Handy-App, mit einem erfundenen Kind.",
      dashboard: { alt: "Das Elternpanel für Sams Handy. Schulzeit, Webfilter und das Bitten um mehr Zeit sind an. Standort und Wochenzusammenfassung sind aus.", caption: "Das Elternpanel" },
      requests: { alt: "Das Elternpanel zeigt, dass Sams Handy um mehr Zeit für Karten bittet. Die Eltern können 15 Minuten, 1 Stunde, den Rest des Tages oder Nein antworten.", caption: "Eine Anfrage vom Handy" },
      home: { alt: "Der Startbildschirm des Kindes in der Schulzeit: 10:32 Uhr, „Schulzeit bis 14:00“, vier Apps und die Tasten Telefon, Nachrichten und SOS.", caption: "Startbildschirm in der Schulzeit" },
      blocked: { alt: "Der Stoppbildschirm des Handys, wenn die Zeit für Musik aufgebraucht ist. Er hat eine Taste, um mehr Zeit zu erbitten, eine, um die Eltern anzurufen oder ihnen zu schreiben, und eine zurück zum Start.", caption: "Wenn die Zeit aufgebraucht ist" },
      sharing: { alt: "Die Handy-Seite „Was können meine Eltern sehen?“. Sie sagt, wann die Eltern den Standort des Handys bekommen, und zeigt jedes Mal, wenn er gesendet wurde.", caption: "„Was können meine Eltern sehen?“" },
    },
    modes: {
      title: "Zwei Arten der Einrichtung",
      caption: "Starker und leichter Modus im Vergleich",
      corner: "Unterschied",
      rows: [
        ["Das Handy", "Neu oder zurückgesetzt", "Bereits in Gebrauch"],
        ["Was darauf ist", "Wird beim Zurücksetzen gelöscht", "Bleibt erhalten"],
        ["Regeln umgehen", "Schwerer. Android-Einstellungen und App-Installationen sind geschützt.", "Leichter. Die Berechtigungen lassen sich entfernen."],
      ],
    },
    free: "Kostenlos und offen",
    closing: {
      title: "Fangen Sie mit einem Handy an.",
      body: "Richten Sie es gemeinsam ein, probieren Sie einen Anruf und die Apps aus, die Sie brauchen, und passen Sie die Regeln nach und nach an.",
    },
  },
};
