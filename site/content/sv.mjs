// SPDX-License-Identifier: Apache-2.0
// Machine-translated copy. Needs native review. Strings may contain trusted inline HTML (links, <em>).
export default {
  lang: "sv",
  path: "/sv/",
  title: "Plainphone | Föräldrakontroll för barnets första Android-mobil",
  description: "Gör en Android till barnets första mobil eller en enkel telefon för dig själv. Behåll samtal och viktiga appar och välj vilka appar och webbplatser du vill begränsa.",
  ogAlt: "Plainphone: din telefon, minus bruset.",
  landing: {
    product: "Produkt",
    setup: "Installation",
    faq: "Frågor",
    menu: "Meny",
    start: "Kom igång",
    guide: "Så ställer du in telefonen",
    code: "Se koden",
    security: "Säkerhet",
    help: "Produkt och hjälp",
    project: "Projekt",
    languages: "Språk",
    day: ["Första dagen med Plainphone", "Välj vem som ska använda telefonen.", "Välj starkt eller lätt läge i föräldrapanelen.", "Följ guiden och anslut telefonen.", "Kom överens om reglerna och testa samtal och de appar ni behöver."],
    child: ["Det här ser ditt barn", "På telefonen kan barnet se vilka appar som är tillgängliga och hur mycket tid som finns kvar för appar med en tidsgräns. Telefonen säger till när tiden är slut och visar ett meddelande när den skickar sin plats."],
    visual: ["Plainphones installationsskärm med val av starkt eller lätt läge", "Installationen i föräldrapanelen (visas på danska).", "Den här webbplatsen använder inga kakor, ingen besöksstatistik, ingen spårning och inga anrop till tredje part."],
    diagram: "Android 10 eller senare",
    groups: ["Kom igång", "Säkerhet", "Integritet", "Pris", "Teknik", "Egen server"],
    questions: [
      ["Vilka telefoner fungerar?", "Telefonen behöver Android 10 eller senare. I guiden finns den testade modellen och begränsningarna för din Android-version."],
      ["Kan jag behålla skolappar, Aula, MitID eller BankID?", "Du kan tillåta appar som barnet behöver. Aula och MitID finns i den danska appkatalogen. Prova inloggningen och andra viktiga funktioner på just er telefon, även om ni behöver BankID."],
      ["Kan jag göra min smarttelefon till en enkel mobil?", "Ja. Behåll samtal, sms och de appar du behöver. Lämna distraherande appar utanför listan. Välj För mig själv för din egen telefon."],
      ["Vad händer om telefonen försvinner?", "Om Hitta är aktiverat kan du begära telefonens plats. Telefonen måste vara uppkopplad för att skicka en ny plats. Tidsstämpeln visar när platsen uppdaterades."],
      ["Kan mitt barn fortfarande ringa 112?", "Ja. Plainphone tillåter alltid 112. Android kopplar nödsamtalet."],
      ["Vad händer om jag ångrar mig?", "Frigör telefonen i föräldrapanelen och vänta på att den bekräftar med internetanslutning. Sedan kan du avinstallera Plainphone eller återställa telefonen i Android. Säkerhetskopiera dina filer före en återställning."],
      ["Vilka uppgifter sparar ni och hur länge?", "Kontouppgifter och telefonregler sparas medan du använder tjänsten. Avgjorda förfrågningar sparas normalt i 30 dagar och databasen har 30 nattliga säkerhetskopior. Om platsdelning är på sparas bara den senaste platsen. Se hela listan i integritetspolicyn."],
      ["Hur raderar jag mina uppgifter?", "Frigör anslutna telefoner först. Välj Radera mitt konto i Inställningar. Ett delat hushåll finns kvar för de andra medlemmarna. Integritetspolicyn beskriver när säkerhetskopiorna upphör att gälla."],
      ["Vem står bakom Plainphone?", "Mahoje i Danmark (CVR 39413892) underhåller projektet och driver tjänsten. Källkoden är offentlig."],
      ["Hur påverkas batteriet?", "Telefonen synkroniserar i bakgrunden. Webbfilter och platsdelning kan också dra ström. Vi har inga mätningar av batteritiden. Vissa telefoner behöver ändrade batteriinställningar för att synkronisera pålitligt."],
      ["Fungerar reglerna utan internet?", "Telefonen följer de senast mottagna reglerna. Den behöver en anslutning för att hämta ändringar eller skicka en ny plats."],
      ["Kan jag köra Plainphone på en egen server?", "Ja. Guiden beskriver Docker, PostgreSQL, HTTPS och e-post för inloggning. Webbfiltrering kräver en separat DNS-tjänst."],
    ],
  },
  skip: "Hoppa till innehållet",
  nav: { label: "Huvudmeny", source: "Källkod", language: "Språk" },
  status: "Tidig version för testning.",
  hero: {
    title: "Din telefon utan allt brus.",
    lead: "Plainphone gör en Android-telefon till en telefon med samtal, sms och de appar du väljer.",
    staysLabel: "Det som är kvar",
    stays: ["Samtal", "Meddelanden", "Kamera"],
    goesLabel: "Det du kan välja bort",
    goes: ["Sociala medier och spel som du väljer bort", "Utvalda webbplatser, med webbfiltret", "Appbutiker, om du inte tillåter dem"],
  },
  who: {
    title: "Vem är det till för?",
    paths: [
      {
        id: "child",
        title: "För mitt barn",
        body: "Välj appar och godkända kontakter tillsammans. Ge barnet mer frihet i takt med att det blir äldre.",
      },
      {
        id: "self",
        title: "För mig själv",
        body: "Låt lättnader i reglerna vänta en tid eller be någon du litar på att godkänna dem, till exempel med en QR-kod. Du kan ångra en ändring medan du väntar.",
      },
    ],
  },
  how: {
    title: "Så fungerar det",
    lead: "Du behöver Android 10 eller senare. Välj hur du vill ställa in telefonen.",
    steps: [
      {
        title: "Starkt läge",
        body: "Börja med en ny eller återställd telefon så att reglerna blir svårare att kringgå.",
      },
      {
        title: "Lätt läge",
        body: "Behåll dina inställningar och begränsa apparna med ett enklare skydd.",
      },
    ],
    guide: "Öppna installationsguiden",
    available: "Du kan redan välja godkända kontakter, filtrera webbplatser efter kategori och aktivera historik för sms, samtal och kontakter. Telefonens filteradress går också att använda på en router eller med en VPN. Telefonen kan uppdatera sig själv och servern kan ta säkerhetskopior.",
    note: "Kommer snart: SOS och möjlighet för föräldrar att välja språk på telefonen.",
  },
  open: {
    title: "Öppen källkod",
    body: "Plainphones källkod är offentlig under Apache-2.0-licensen.",
    github: "Se källkoden på GitHub",
    issues: "Rapportera ett fel offentligt eller föreslå en ändring",
    privateReport: "Rapportera en säkerhetsbrist eller ett integritetsproblem privat",
    contribute: "Läs hur du kan bidra",
  },
  hosting: {
    title: "Kör Plainphone på din egen server",
    body: "Du behöver Docker med PostgreSQL, en HTTPS-adress och SMTP för inloggningsmejl. Android-telefonen ansluter till din server under installationen. Öppna föräldrapanelen på din egen adress eller bygg föräldraappen med den adressen. Webbfiltrering kräver en separat DNS-tjänst.",
    guide: "Läs guiden för egen server",
  },
  price: {
    title: "Pris",
    body: "Plainphone är gratis nu. Det kommer alltid att vara gratis att driva Plainphone på en egen server och att ha en telefon med fullt skydd på vår tjänst. Senare tar vi betalt för fler telefoner på vår tjänst. Tidiga användare får besked i god tid.",
    items: [
      {
        q: "Vad kostar det?",
        a: "Det är gratis nu. Senare kostar det bara att lägga till fler telefoner på vår tjänst.",
      },
      {
        q: "Vad är alltid gratis?",
        a: "Att driva Plainphone på en egen server och att ha en telefon med fullt skydd på vår tjänst.",
      },
      {
        q: "Vad händer om jag kör Plainphone på min egen server?",
        a: "Du betalar inget till Plainphone. Du står själv för servern och de tjänster du använder.",
      },
    ],
  },
  privacySummary: {
    title: "Integritet",
    body: "Webbplatsen använder inga kakor eller besöksanalyser. Plainphone visar ingen reklam och säljer aldrig dina uppgifter.",
    link: "Läs integritetspolicyn",
  },
  phones: {
    title: "Testade telefoner",
    body:
      "En så här långt: en OnePlus 5T på Android 10. Installationen, låset och anslutningen till kontrollpanelen fungerar, som <a href=\"/sv/setup/#tested\">installationsguiden</a> visar. Den har inte gått igenom vår <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/bypass-checklist.md\">bypass checklista</a> på riktig hårdvara ännu, och en telefon räknas som fullständigt testad först efter att den har klarat alla tester på den listan. Tills dess, behandla Plainphone som ett experiment.",
  },
  faq: {
    title: "Frågor",
    items: [
      {
        q: "Fungerar det på iPhone?",
        a: "Plainphone skyddar barnets Android-telefon. Föräldraappen för iPhone är under utveckling. Du kan redan använda föräldrapanelen i Safari.",
      },
      {
        q: "Går det att kringgå?",
        a: "Starkt läge skyddar Androids inställningar och gör det svårare att installera appar. Lätt läge använder behörigheter som kan tas bort och är därför enklare att stänga av. Prova på den egna telefonen.",
      },
      {
        q: "Vad sägs om WhatsApp, Snapchat och andra chattappar?",
        a: "Chattappar förblir dolda om du inte tillåter dem, och godkända kontakter täcker samtal och sms, inte vad som händer i dessa appar. Om en hel klass är på en app fixar inte programvaran det. Att prata med de andra föräldrarna gör det ofta.",
      },
    ],
  },
  why: {
    path: "/sv/why/",
    h1: "Varför Plainphone fungerar som det gör",
    lead: "Plainphone är för familjer som vill att deras barn ska ha en telefon medan de väntar på att ge dem en komplett smartphone. Forskning hjälper oss att välja vad vi ska bygga.",
    sections: [
      ["Sovdags", "Att ha en telefon i sovrummet är kopplat till sämre sömn hos barn och tonåringar. Plainphones läggtidsschema begränsar vilka appar som är tillgängliga. Den danska hälsomyndigheten rekommenderar att du lämnar telefonen utanför sovrummet."],
      ["Vad forskningen kan berätta", "Stora studier finner små genomsnittliga samband mellan teknikanvändning och välbefinnande. En granskning från National Academies fann för lite bevis för att fastställa en orsakseffekt av sociala medier på ungdomars hälsa i hela befolkningen. Vi vet inte om en begränsad telefon som Plainphone förbättrar välbefinnandet. Den danska välbefinnandekommissionen rekommenderar att man väntar tills barnet fyllt 13 år innan det får en egen smarttelefon eller surfplatta."],
      ["Skoltid", "Du väljer själv när schemat löper och vilka appar som är tillgängliga. Forskning om skoltelefonregler är blandad, och vi vet inte om ett sådant här schema förbättrar välbefinnandet."],
      ["Webbfiltrering", "När det är konfigurerat blockerar filtret förfrågningar till webbadresser i de kategorier du väljer. Det kan minska viss exponering, och studier har funnit få bevis för att filter ändrar hur ofta tonåringar möter sexuellt material. Filter kan också blockera användbar hälsoinformation. Prata med ditt barn om vad de kan stöta på."],
      ["Sekretess, hjälp och växande oberoende", "Barn ska kunna förstå reglerna, se när deras plats delas och nå hjälp privat. Vi använder dessa principer när vi designar Plainphone. Se över reglerna tillsammans när ditt barn växer."],
      ["För vuxna", "I en kort studie av en annan app gav en paus och möjligheten att avbryta människor en chans att ändra uppfattning om att öppna en app. Människor avbröt mer sällan allt eftersom studien pågick. Det är en anledning till att göra det enkelt att avboka när vi utformar en paus."],
    ],
    sourcesTitle: "Källor",
    sources: [
      ["Carter et al. på enheter och sömn", "https://doi.org/10.1001/jamapediatrics.2016.2341"],
      ["Sundhetsmyndighetens råd om användning av screening", "https://www.sst.dk/vidensbase/forebyggelse/anbefalinger-om-brug-af-skaerm"],
      ["rekommendationer från den danska välfärdskommissionen", "https://regeringen.dk/aktuelt/nyheder/2025/trivselskommissionens-anbefalinger-er-klar/"],
      ["National Academies granskning av sociala medier och ungdomars hälsa", "https://www.nationalacademies.org/read/27396/chapter/2"],
      ["Orben och Przybylski om digital teknik och välmående", "https://www.nature.com/articles/s41562-018-0506-1"],
      ["Goodyear et al. om skoltelefonpolicyer", "https://doi.org/10.1016/j.lanepe.2025.101211"],
      ["Przybylski och Nash om internetfiltrering", "https://pubmed.ncbi.nlm.nih.gov/29995533/"],
      ["Richardson et al. om filter och tillgång till hälsoinformation", "https://doi.org/10.1001/jama.288.22.2887"],
      ["Europeiska kommissionens riktlinjer för minderåriga", "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A52025XC05519"],
      ["FN:s kommitté för barnets rättigheter, Allmän kommentar nr 25", "https://www.ohchr.org/en/documents/general-comments-and-recommendations/general-comment-no-25-2021-childrens-rights-relation"],
      ["Grüning et al. på en sekunds app", "https://www.pnas.org/doi/10.1073/pnas.2213114120"],
    ],
  },
  privacy: {
    path: "/sv/privacy/",
    title: "Integritetspolicy: Plainphone",
    description:
      "Vad Plainphone lagrar om dig och de telefoner du hanterar, hur länge, vilka mer som är inblandade och hur man ber oss korrigera eller radera det.",
    h1: "Integritetspolicy",
    updated: "Senast uppdaterad 17 november 2026",
    lead:
      "Plainphone håller så lite den kan, under så kort tid som den kan. Den här sidan säger vad det betyder i praktiken. Den är skriven för att läsas, inte för att dölja saker.",
    status:
      "Plainphone är tidigt. Föräldraappen, servern, webbfiltret och Plainphone-appen på telefonen fungerar alla tillsammans, men den är inte redo för daglig användning än. När vad Plainphone lagrar ändras ändras den här sidan först.",
    tocLabel: "På den här sidan",
    short: {
      title: "Den korta versionen",
      list: [
        "Den här webbplatsen sätter inga cookies, kör inga analyser och laddar ingenting från andra webbplatser.",
        "Föräldraappen lagrar din e-postadress och reglerna du anger för varje telefon. När en telefon tas bort raderas allt som lagrats om den.",
        "Plats, när den är på, är bara telefonens senast kända position. Det finns ingen historia.",
        "Webbfiltret för inte en lista över de webbplatser en telefon besöker.",
        "Vi säljer inte data, visar inte annonser eller bygger profiler.",
      ],
    },
    sections: [
      {
        id: "controller",
        title: "Vem är ansvarig",
        body: [
          "Plainphone är ett projekt med öppen källkod som underhålls av <a href=\"https://mahoje.dk\">Mahoje</a> i Danmark. Vi är ansvariga för data i den värdtjänst: föräldraappen på app.plainphone.org och webbfiltret på dns.plainphone.org.",
          "Skriv till <a href=\"mailto:privacy@plainphone.org\">privacy@plainphone.org</a> för allt om dina data, till exempel en kopia av dem eller radering av dem. För frågor som inte är personliga kan du också öppna ett ärende på <a href=\"https://github.com/plainphone/plainphone/issues\">github.com/plainphone/plainphone/issues</a>, men frågorna är offentliga, så håll personlig information som din e-postadress borta från dem. Säkerhetsproblem går via det privata rapportformuläret som beskrivs i <a href=\"https://github.com/plainphone/plainphone/blob/main/SECURITY.md\">SECURITY.md</a>.",
        ],
      },
      {
        id: "why",
        title: "Varför vi använder dina uppgifter",
        body: [
          "Vi använder den för att köra Plainphone åt dig: för att logga in dig, för att tillämpa reglerna du anger på de telefoner du hanterar och för att hålla tjänsten fungerande och säker. Den rättsliga grunden är avtalet mellan dig och tjänsten (GDPR artikel 6(1)(b)) och vårt berättigade intresse av säkerhet och att stoppa missbruk (artikel 6(1)(f)). För någon som är inbjuden av en annan person är det den personens begäran tillsammans med vårt intresse av att leverera den (artikel 6(1)(f)). Vi använder uppgifterna till inget annat.",
        ],
      },
      {
        id: "account",
        title: "Ditt konto",
        body: [
          "Du loggar in med din e-postadress och en länk vi skickar till dig. Det finns inget lösenord. Vi lagrar:",
          {
            list: [
              "din e-postadress och ditt språk (engelska eller danska)",
              "inloggningslänken du bad om: din e-postadress, en utgångstid och en hash av länken. Den raderas ungefär en dag efter att den löper ut, även när det inte finns något konto för den adressen",
              "din session: en hash av nyckeln som din webbläsare har och när den slutar (max 60 dagar, eller när du loggar ut). Vi lagrar inte din IP-adress eller din enhet",
              "ditt hushåll: dess namn, vem som finns i det och de inbjudningar du har skickat, med den inbjudna e-postadressen och utgångsdatum. En inbjudan raderas när den accepteras och en dag efter att den löper ut",
            ],
          },
          "Alla i ett hushåll kan se varandras e-postadresser och hantera alla deras telefoner. Inloggningslänkar, sessioner och nycklar som telefoner använder lagras som hash.",
        ],
      },
      {
        id: "phones",
        title: "Telefoner och regler",
        body: [
          "En förälder, eller en vuxen för sin egen telefon, lägger till en telefon genom att ange koden den visar. Barn får inget konto och ombeds aldrig ange en e-postadress. För varje telefon lagrar vi vad vuxen ställer in:",
          {
            list: [
              "namnet den vuxne ger telefonen, om det är ett barns eller en vuxens egen telefon, dess tidszon och när den senast kontaktade servern",
              "några korta fakta som telefonen rapporterar när den kopplas ihop, som dess modell och Android-version, och dess senaste status: batterinivå, appversion, om dess lås är intakt och vilken webbfilteradress den använder. Varje rapport ersätter den tidigare",
              "om du aktiverar skydd mot återställning behåller ditt hushåll ditt numeriska Google-konto-ID och när det länkades. Koppla bort den i hushållsinställningarna för att radera den, eller ta bort ditt Plainphone-konto. Vi lagrar inte din Google-e-postadress eller inloggningstokens för den här funktionen",
              "för en telefon i starkt läge, den senaste systemkontrollen, inklusive om bootloadern är låst, säkerhetskorrigeringsnivån och kontrolltiden. Varje kontroll ersätter den föregående, och om du tar bort telefonen raderas den. Vi behåller inte dess certifikatkedja",
              "apparna på telefonen (namn och paketnamn) och vilka av dem som är tillåtna",
              "godkända kontakter: namnen och numren som en förälder skriver in i föräldraappen. Servern innehåller inget annat från telefonens kontakter",
              "webbfilterinställningar: vilka kategorier som är blockerade och de domäner som föräldern tillåter eller blockerar",
              "skoltid och läggdags, och de appar som är tillåtna under dem",
              "på en vuxens egen telefon: inställningarna för nyckeln (en fördröjning eller e-postadressen till en betrodd person) och ändringarna som väntar på nyckeln. En ändring som har tillämpats, annullerats eller avvisats behålls i 30 dagar och raderas sedan",
              "förfrågningar telefonen skickar: en app från sin egen lista, eller en kontakt (namn och nummer) någon i telefonen ber att lägga till. Varje begäran sparas medan den är öppen och i 30 dagar efter att en förälder tillåter eller avslår den",
              "efter hur många timmars tystnad telefonen räknas som tyst (en inställning per telefon, delad av föräldrarna), och för varje förälder om de vill ha aviseringar om det",
            ],
          },
          "En betrodd person som du namnger får ett e-postmeddelande. När de har loggat in kan de se telefonens namn, vad som efterfrågas och din e-postadress.",
        ],
      },
      {
        id: "children",
        title: "Barn",
        body: [
          "Barn gör inga konton. En förälder gör det, och föräldern bestämmer vad som lagras på barnets telefon. Vi samlar inte medvetet in data direkt från ett barn, vi visar inga annonser och vi bygger inte profiler för barn. Den mest känsliga informationen om ett barns telefon är dess senast kända position och dess lista över godkända kontakter. Vi föreslår att du berättar för ditt barn vad telefonen delar och varför.",
        ],
      },
      {
        id: "location",
        title: "Plats",
        body: [
          "Plats är en inställning för varje telefon, med fyra val: av; endast när en förälder trycker på Sök; på Hitta och när ett \"Är du okej?\" går obesvarat; eller alltid på, var femte minut, under en tid som föräldern väljer (en timme, idag eller en vecka), varefter den går tillbaka till Hitta och \"Är du okej?\" av sig själv. Ett barns telefon börjar med Hitta och \"Är du okej?\", inte alltid på. En vuxens egen telefon börjar med plats av, och att slå på den är ägarens val. En förälder kan ändra det när som helst.",
          "Telefonen är öppen med det. Varje gång den skickar en enstaka position (Hitta eller ett obesvarat \"Är du okej?\"), visar den ett kort meddelande som säger det. När platsen alltid är på visar telefonen det hela tiden, i ett meddelande och på Plainphones egen skärm. Barnet kan öppna \"Vad kan mina föräldrar se?\" på telefonen: den förklarar den aktuella inställningen och listar varje gång positionen skickades under de senaste 30 dagarna. Den listan ligger kvar på telefonen.",
          "\"Är du okej?\" ber barnet att svara inom en tid som föräldern väljer. Om barnet svarar skickas ingen position. Om ingen svarar i tid skickar telefonen en position. \"Ring the phone\" spelar ett alarmljud och vibrerar i högst fem minuter; den skickar ingen position. Servern behåller en ringsignal eller en fråga (tider och svaret och det godkända numret för \"Ring mig\") i en dag efter det att den slutar och raderar den sedan.",
          "Servern behåller endast den senaste positionen: koordinater, noggrannhet och tid. Varje ny position ersätter den gamla och ingen historik sparas. Om du stänger av plats eller tar bort telefonen raderas den lagrade positionen.",
          "Instrumentpanelen visar positionen på en karta. Kartbrickorna kommer från OpenFreeMap (tiles.openfreemap.org, OpenStreetMap-data), så att ladda dem berättar för OpenFreeMap ungefär vilket område som tittas på, tillsammans med förälderns IP-adress. Kartan laddas endast på platssidan. Föräldraappen på en telefon använder OpenStreetMaps kakelservrar, och först efter att föräldern trycker på Visa karta. Om en förälder väljer \"Kör dit\" med Google Maps eller Apple Maps, eller kopierar positionen, går koordinaterna till den appen och dess egen policy gäller därifrån.",
        ],
      },
      {
        id: "filter",
        title: "Webbfiltret",
        body: [
          "Varje telefon får sin egen adress på vår filtrerande DNS-tjänst (dns.plainphone.org). Så här fungerar webbfiltret i varje app. Adressen innehåller ett slumpmässigt klient-ID, inte ditt namn, nummer eller enhets-id. För att svara ser filtret vilka domäner telefonen frågar efter. Det räddar dem inte:",
          {
            list: [
              "Ingen frågelogg. Den är avstängd, och telefonerna är också uteslutna från den ifall den slås på av misstag.",
              "Inga IP-adresser. Telefonens adress avbryts innan den når filtrets statistik.",
              "Endast räknare: antalet uppslagningar och blockeringar, de mest efterfrågade domänerna och de mest trafikerade klient-ID:n, som summor. De raderas efter 24 timmar.",
              "Filtrets inställningar för varje telefon (klient-ID, profil, tillåtna och blockerade domäner) sparas tills telefonen tas bort.",
            ],
          },
          "Plainphone håller hjälplinjesamtal, sms och aktivitet på hjälpskärmen borta från föräldrarapporter. Android kan fortfarande behålla de senaste samtalen och sms-konversationer på telefonen. Uppslagningar efter skyddade hjälp- och hälsodomäner exkluderas från filtrets statistik.",
          "Tillåtna uppslagningar skickas vidare över krypterade anslutningar till Quad9 (Schweiz) och Mullvad, med Cloudflare som reserv. De ser domänen och vår servers adress, aldrig telefonens, och ingen del av telefonens IP-adress skickas vidare. De tekniska detaljerna finns i <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/privacy.md\">docs/privacy.md</a>.",
        ],
      },
      {
        id: "email",
        title: "E-post",
        body: [
          "Vi skickar endast e-post för att köra tjänsten: inloggningslänkar, inbjudningar, meddelanden som en betrodd person får och en varning när en telefon rapporterar att en obligatorisk inställning har stängts av eller det har varit tyst länge. Inga nyhetsbrev och inga annonser. Mailen skickas från vår egen mailserver inom EU. Logotypen i våra e-postmeddelanden laddas från plainphone.org, som Cloudflare är värd för, så om ditt mailprogram visar bilder ser Cloudflare din IP-adress när den hämtar logotypen. Logotypens adress har ingen identifierare och är densamma för alla, så den talar inte om för oss vem som har öppnat ett mail.",
        ],
      },
      {
        id: "cookies",
        title: "Denna webbplats, cookies och webbläsarlagring",
        body: [
          "plainphone.org sätter inga cookies, kör inga analyser och laddar inga skript, typsnitt eller bilder från andra webbplatser. Det finns på Cloudflare Pages, så Cloudflare, precis som alla webbhotell, hanterar din IP-adress och adressen du ber om när den levererar en sida. Länkar till andra sajter, som GitHub, är vanliga länkar. När du följer en så gäller webbplatsens policy.",
          "Föräldraappen på app.plainphone.org ställer in en cookie, pp_session. Den håller dig inloggad, skickas bara till vår egen server, kan inte läsas av skript på sidan (HttpOnly), skickas endast på samma plats-förfrågningar (SameSite=Strict) och varar högst 60 dagar. Du behöver den för att logga in, så det finns ingen cookie-banner.",
          "Appen kommer också ihåg, i din webbläsare, ditt språkval och, om du aktiverar aviseringar, id för den här enhetens aviseringsadress (lokal lagring) och, bara medan du loggar in, vart du ska gå efteråt och en inbjudan eller kopplingskod (sessionslagring, rensas när fliken stängs). En servicearbetare behåller en kopia av appens egna filer så att den öppnas utan nätverk. Den lagrar aldrig dina data.",
          "Om du aktiverar aviseringar ger din webbläsare oss en adress till dess push-tjänst (Google för Chrome, Apple för Safari, Mozilla för Firefox, Microsoft för Edge) och två nycklar. Vi lagrar dem, med en kort etikett som \"Chrome · Android\", tills du stänger av aviseringar, loggar ut på den enheten, tar bort enheten under Inställningar, push-tjänsten säger att adressen inte längre är giltig eller du raderar ditt konto. Varje avisering krypteras för din enhet innan den lämnar vår server, så push-tjänsten kan leverera den men inte läsa den. Den ser att ett meddelande har skickats, när och till vilken adress.",
        ],
      },
      {
        id: "others",
        title: "Vilka mer är inblandade",
        body: [
          "Vi säljer inte data, delar den för reklam eller använder den för att profilera någon. Dessa hjälper oss att köra tjänsten:",
          {
            list: [
              "Hetzner (Tyskland) hyr oss servrarna där moderappen, dess databas och webbfiltret körs. Säkerhetskopieringar förvaras i objektlagring i EU.",
              "Vår egen mailserver i EU skickar mejlen. Det är inte en e-posttjänst från tredje part.",
              "Cloudflare är värd för denna webbplats (plainphone.org) och logotypen i våra e-postmeddelanden.",
              "Quad9 och Mullvad, med Cloudflare som reserv, tillät webbfilteruppslagningar enligt beskrivningen ovan.",
              "Om du aktiverar aviseringar: din webbläsares push-tjänst (Google, Apple, Mozilla eller Microsoft) levererar dem. Innehållet är krypterat från början till slut.",
            ],
          },
          "Konto- och telefondata lagras på servrar i EU.",
        ],
      },
      {
        id: "retention",
        title: "Hur länge vi behåller saker",
        body: [
          {
            table: {
              caption: "Hur länge varje typ av data sparas",
              cols: ["Vad", "Hur länge"],
              rows: [
                ["Inloggningslänkar", "Ungefär en dag efter att de löper ut (de går ut efter 15 minuter)"],
                ["Sessioner", "Tills de går ut (60 dagar) eller du loggar ut"],
                [
                  "Parningskoder",
                  "Raderas inom en dag. Detta inkluderar nyckeln som en telefon samlar in en gång. Tills dess lagras den i läsbar form",
                ],
                [
                  "Ditt konto (e-postadress, språk)",
                  "Tills du tar bort kontot under Inställningar i appen, eller ber oss att göra det",
                ],
                [
                  "Hushåll, telefoner, appar, kontakter, skoltid, filterinställningar",
                  "Tills telefonen tas bort (på telefonens sida i appen) eller ditt konto raderas. Ett hushåll raderas med den sista medlemmens konto. En borttagen kontakt eller ett schema raderas när borttagningen träder i kraft",
                ],
                [
                  "Senaste positionen",
                  "Bara den senaste. Raderas när du stänger av plats eller tar bort telefonen",
                ],
                [
                  "Ändringar som väntade på nyckeln på en vuxens egen telefon",
                  "Medan ändringarna väntar och i 30 dagar efter att de har genomförts, avbrutits eller avvisats",
                ],
                [
                  "Förfrågningar från en telefon (en app eller en kontakt)",
                  "Medan de är öppna och 30 dagar efter att de är tillåtna eller avvisade",
                ],
                [
                  "Aviseringsadresser (en per enhet)",
                  "Tills du stänger av aviseringar eller loggar ut på den enheten, eller tar bort den, avvisar push-tjänsten det eller så tar du bort ditt konto",
                ],
                [
                  "Inbjudningar",
                  "Raderad när den accepteras. Annars slutar de fungera efter 7 dagar och raderas en dag senare. Du kan när som helst dra tillbaka en öppen inbjudan",
                ],
                ["Webbfilterräknare", "24 timmar"],
                [
                  "Säkerhetskopiering av databasen",
                  "Tas varje kväll och förvaras i upp till 30 dagar. Raderad data kan stanna i en säkerhetskopia tills den roterar ut",
                ],
                ["Säkerhetskopiering av webbfiltrets inställningar", "De sista 14 dagliga exemplaren"],
              ],
            },
          },
          "Som vilken webbtjänst som helst, skriver webbservern framför appen vanliga tekniska loggar (IP-adress, tid, den efterfrågade adressen). Vi använder dem bara för att hålla tjänsten igång och för att stoppa missbruk. Appen själv håller endast IP-adresser i minnet, för hastighetsgränser, och skriver dem aldrig till sin databas.",
        ],
      },
      {
        id: "rights",
        title: "Dina rättigheter",
        body: [
          "Du kan be oss kostnadsfritt om en kopia av de uppgifter vi har om dig, för att korrigera dem, ta bort dem, för att begränsa hur vi använder dem, för att överlämna dem i ett vanligt format eller för att stoppa en användning som du motsätter dig. Du kan också klaga till <a href=\"https://www.datatilsynet.dk/\">Datatilsynet</a>, den danska datatillsynsmyndigheten eller till myndigheten i ditt eget land.",
          "I föräldraappen kan du redan göra en del av detta själv:",
          {
            list: [
              "ändra telefonens kontakter, appar, webbfilter och scheman",
              "stäng av plats, vilket raderar den lagrade positionen",
              "dra tillbaka en öppen inbjudan",
              "byta namn på eller ta bort en telefon. Om du tar bort det raderas allt som har lagrats om det, och webbfiltret uppmanas att glömma sitt ClientID tills det bekräftas. På en vuxens egen telefon väntar borttagningen på nyckeln",
              "lämna ett hushåll (den sista medlemmen kan inte lämna, men kan radera sitt konto)",
              "radera ditt konto under Inställningar. Ett hushåll som du delar med en annan förälder bor hos dem, med sina telefoner. Ett hushåll som bara du tillhör raderas med sina telefoner. Om du är någons betrodda person blir deras nyckel en fördröjning istället. I ett hushåll som bara du tillhör måste telefoner med nyckel (en vuxens egen telefon) tas bort först, genom nyckeln",
              "logga ut, vilket avslutar sessionen",
            ],
          },
          "Det finns ingen knapp ännu för att ladda ner din data. Fråga oss om det, eller om något annat på den här listan (se Vem är ansvarig). Vi kontrollerar att du kontrollerar e-postadressen innan vi ändrar eller tar bort något, och vi siktar på att svara inom en månad.",
        ],
      },
      {
        id: "selfhost",
        title: "Kör din egen server",
        body: [
          "Plainphone kan köras på din egen server. Om du gör det är du ansvarig för den servern och dess data, och denna policy täcker inte det. Programvaran lagrar vad den här sidan beskriver, men du väljer var den körs, hur länge säkerhetskopior sparas (exemplet behåller 14 dagliga och 8 veckoexemplar) och vilka e-post- och DNS-tjänster den använder. Guiderna är <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/self-hosting.md\">self-hosting.md</a> och <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/self-hosting-dns.md\">self-hosting-dns.md</a>.",
        ],
      },
      {
        id: "changes",
        title: "Ändringar av denna policy",
        body: [
          "Om det vi gör ändras ändrar vi denna sida och datumet högst upp innan ändringen träder i kraft. Sidan är en del av det offentliga projektet, så varje förändring kan ses i dess <a href=\"https://github.com/plainphone/plainphone/commits/main/site/content\">historia på GitHub</a>.",
        ],
      },
    ],
  },
  setup: {
    path: "/sv/setup/",
    title: "Konfigurera en telefon: Plainphone",
    h1: "Konfigurera en telefon",
    description: "Konfigurera Plainphone på en ny Android-telefon eller en som redan används, med en privat konfigurationskod från din instrumentpanel.",
    lead: "Du behöver en Android 10 eller senare telefon och kontrollpanelen öppen på en andra enhet.",
    question: "Är telefonen ny eller används redan?",
    strong: "Den är ny eller återställd",
    strongHelp: "Rekommenderad. Plainphone kan skydda fler inställningar på en ny telefon.",
    light: "Den är redan i bruk",
    lightHelp: "Behåll telefonens data och aktivera skyddet i Android-inställningarna.",
    startStrong: "Starta installationen för en ny eller återställd telefon",
    startLight: "Starta konfigurationen för en telefon som används",
    start: "I kontrollpanelen, säg vem telefonen är till för och skapa en inställningslänk.",
    strongTitle: "Ny eller återställd telefon",
    lightTitle: "Telefonen används redan",
    lightSteps: [
      ["Öppna nedladdningen på telefonen", "Skanna koden från kontrollpanelen med telefonens kamera eller öppna den privata länken i Chrome på den telefonen.", "lightScan"],
      ["Installera Plainphone", "Ladda ner appen och öppna filen. Om Android blockerar det trycker du på Inställningar, aktiverar Tillåt från den här källan, går tillbaka och trycker på Installera.", "download"],
      ["Gå tillbaka till Chrome och tryck på Öppna Plainphone", "Välj Barn eller Jag själv på telefonen. Kontrollera det maskerade kontot och hushållet, välj sedan en PIN-kod på 6 till 12 siffror och ange den två gånger. Följ anvisningarna för att slutföra installationen.", "permissions"],
    ],
    lightHelpItems: [
      ["Android säger att en inställning är begränsad", "På Android 13 eller senare kan detta påverka telefonappen, meddelandeappen eller skyddet. Öppna appinformation från Plainphone. Tryck på ⋮ (överst till höger) och sedan på Tillåt begränsade inställningar. Gå tillbaka till Plainphone och försök igen."],
      ["Jag har ställt in fel telefon", "Tryck på Ångra installationen i Plainphone inom tio minuter efter att du har avslutat installationen i lätt läge. Detta stänger av Plainphone och tar bort telefonen från kontrollpanelen när den kan ansluta."],
      ["Android ber om att starta en VPN-anslutning", "Tryck på OK. Det är så Plainphone kontrollerar webbadresser mot ditt webbfilter."],
      ["Jag öppnade appen från installationsprogrammet", "Gå tillbaka till Chrome och tryck på Öppna Plainphone på inställningssidan. Om du redan har angett en PIN-kod på telefonen, använd samma PIN-kod i kontrollpanelen."],
    ],
    nextTitle: "När telefonen är ansluten",
    next: "Lägg till kontakter i kontrollpanelen, välj appar från katalogen eller ställ in skoltider.",
    steps: [
      {
        title: "Återställ telefonen",
        body: [
          "På en telefon behöver du återställa, säkerhetskopiera allt du vill behålla och välj sedan Inställningar → System → Återställ → Radera all data. Vänta tills välkomstskärmen visas.",
          "Menynamnen skiljer sig lite mellan olika märken. Om ett Google-konto finns på telefonen, ta bort det först (Inställningar → Konton), eller så ber telefonen om det efter återställningen.",
        ],
        fig: "reset",
      },
      {
        title: "Tryck på välkomstskärmen 6 gånger",
        body: [
          "På den första välkomstskärmen trycker du snabbt på samma tomma plats 6 gånger i rad. Tryck inte på Start. En QR-läsare öppnas. På vissa telefoner ber den först om att ladda ner den.",
        ],
        fig: "welcome",
      },
      {
        title: "Skanna QR-koden",
        body: [
          "Skanna koden från kontrollpanelen och välj sedan ett Wi-Fi-nätverk. Telefonen laddar ner Plainphone. När Plainphone öppnas, bekräfta vems telefon det är och kontrollera instrumentpanelskontot som visas på telefonen.",
          "Om telefonen säger att den kommer att hanteras av en organisation, är det Plainphone. Acceptera: det är så låset fungerar.",
        ],
        fig: "scan",
      },
      {
        title: "Endast Android 10 till 13: ställ in standardtelefonappen",
        body: [
          "När du har bekräftat instrumentpanelskontot frågar telefonen <em>Ange Plainphone som din standardtelefonapp?</em> Tryck på <strong>Ange som standard</strong>. Missat det? Öppna Plainphone-appen och den frågar igen.",
          "På Android 14 och nyare händer detta av sig själv.",
        ],
        fig: "dialog",
      },
      {
        title: "Tillåt att Plainphone körs i bakgrunden",
        body: ["Tryck på <strong>Continue</strong> och ge sedan tillåtelse i Android så att Plainphone kan uppdatera sig själv på ett säkert sätt. Om du hoppar över steget kan du öppna Plainphone igen för att få frågan på nytt."],
      },
    ],
    figs: {
      lightScan: "En telefonkamera som ramar in en inställningskod.",
      download: "En telefonskärm med en nedladdningspil.",
      permissions: "En telefonskärm med två inställningsknappar.",
      reset: "En ritning av en telefon som visar en inställningslista, med raden för att radera all data markerad.",
      welcome: "En teckning av en telefon på dess första välkomstskärm. Sex kranar på samma tomma ställe, märkt \"6×\".",
      scan: "Två teckningar av en telefon. På den första ramar en QR-läsare in en QR-kod. På den andra, en lista över Wi-Fi-nätverk med ett valt.",
      dialog: "En ritning av en telefon med en dialogruta som har två knappar, \"Ange som standard\" och \"Avbryt\".",
    },
    drawing: { taps: "6×", set: "Ställ in som standard", cancel: "Avboka" },
    troubleTitle: "Om något går fel",
    trouble: [
      [
        "QR-koden har gått ut eller fungerar inte",
        "En kod fungerar en gång och i 24 timmar. Öppna telefonen i kontrollpanelen och välj <strong>Visa inställnings-QR-koden</strong> för att få en ny. En ny kod hindrar den gamla från att fungera.",
      ],
      [
        "Telefonen säger \"Kan inte konfigurera enheten\"",
        "Kontrollera att telefonen har Android 10 eller senare (Inställningar → Om telefonen). Äldre telefoner kan inte användas.",
      ],
      [
        "Telefonen visar en kod istället för att ansluta",
        "I kontrollpanelen väljer du <strong>Lägg till telefon</strong>, sedan <strong>Skriv koden</strong> längst ner och ange koden som telefonen visar.",
      ],
      [
        "Att knacka 6 gånger gör ingenting",
        "Telefonen måste vara på sin allra första välkomstskärm. Tryck snabbt på en plats i mitten och tryck inte på Start.",
      ],
    ],
    help: "Fortfarande fast? <a href=\"https://github.com/plainphone/plainphone/issues\">Öppna ett problem på GitHub</a>.",
    testedTitle: "Testade telefoner",
    tested: {
      caption: "Telefoner som Plainphone har konfigurerats på",
      cols: ["Telefon", "Android", "Resultat"],
      rows: [["OnePlus 5T (A5010)", "Android 10", "Fungerar"]],
      body: [
        "Fungerar innebär att inställning, lås och anslutning till kontrollpanelen bekräftas på den här telefonen. Den har inte gått igenom hela bypass-checklistan ännu.",
        "Android 14 eller senare rekommenderas. Den gör allt själv och låser telefonappen i Inställningar.",
        "Android 10 till 13 har en känd lucka: barnet kan byta till den inbyggda telefonappen i Inställningar. Samtalen filtreras sedan inte förrän Plainphone väljs igen. Instrumentpanelen visar det inom 15 minuter.",
      ],
    },
  },
  footer: {
    maintained: "Plainphone underhålls av <a href=\"https://mahoje.dk\">Mahoje</a> i Danmark.",
    setup: "Guide: <a href=\"/sv/setup/\">Konfigurera en telefon</a>.",
    privacy: "Den här webbplatsen lägger inga cookies och kör inga analyser. <a href=\"/sv/privacy/\">Integritetspolicy</a>.",
    license: "Kod under <a href=\"https://github.com/plainphone/plainphone/blob/main/LICENSE\">Apache-2.0</a>. Teckensnitt: Atkinson Hyperlegible Next, <a href=\"/fonts/OFL.txt\">SIL OFL</a>.",
  },
  notFound: {
    title: "Sidan hittades inte",
    body: "Det finns ingenting på den här adressen.",
    back: "Gå till förstasidan",
  },
};
