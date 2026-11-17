// SPDX-License-Identifier: Apache-2.0
// Danish copy. Strings may contain trusted inline HTML (links, <em>).
export default {
  lang: "da",
  path: "/da/",
  title: "Plainphone: en rolig telefon lavet af en almindelig Android",
  description:
    "Gratis open source-software til en Android-telefon med opkald, sms, kamera og de apps, du vælger.",
  ogAlt: "Plainphone: din telefon, uden støjen.",
  skip: "Gå til indholdet",
  nav: { label: "Hovedmenu", source: "Kildekode", switchLabel: "English", switchLang: "en" },
  status: "Tidlig udgave. Open source. Endnu ikke klar til daglig brug.",
  hero: {
    title: "Din telefon, uden støjen.",
    lead:
      "Plainphone gør en almindelig Android-telefon rolig. Du vælger, hvilke apps der er tilgængelige. Det er gratis, og koden er åben.",
    staysLabel: "Det beholder du",
    stays: ["Opkald", "Sms", "Kamera", "Kort, musik og de apps, du vælger"],
    goesLabel: "Det ryger",
    goes: ["Sociale medier og spil, du ikke giver adgang til", "Udvalgte hjemmesider, med webfilteret", "App-butikker, medmindre du giver adgang"],
  },
  who: {
    title: "Hvem det er til",
    lead: "Familier og voksne, der vil vælge, hvad der er tilgængeligt på telefonen. Reglerne er de samme. Forskellen er, hvem der har nøglen. Det er det, Plainphone er ved at blive bygget til.",
    paths: [
      {
        id: "child",
        title: "Til mit barn",
        body:
          "En første telefon, der kan ringe, skrive, finde vej hjem og spille musik. Du har nøglen: du kommer til at vælge apps og kontakter og kan åbne mere op, efterhånden som barnet bliver ældre.",
      },
      {
        id: "self",
        title: "Til mig selv",
        body:
          "Behold kort, netbank og kamera. Vælg, hvor længe der skal gå, før en lempelse af dine regler træder i kraft. Eller lad en, du stoler på, godkende det.",
      },
    ],
  },
  how: {
    title: "Sådan virker det",
    steps: [
      {
        title: "Vælg, hvordan du vil sætte telefonen op",
        body: "Du skal bruge Android 10 eller nyere. Du kan sætte en telefon i brug op uden at slette den.",
      },
      {
        title: "Installér og forbind",
        body: "På en telefon i brug åbner du opsætningslinket, installerer Plainphone og følger trinene. På en ny eller nulstillet telefon trykker du seks gange på velkomstskærmen og scanner opsætningskoden.",
      },
      {
        title: "Vælg reglerne",
        body: "Vælg hvilke apps der vises, hvem der kan ringe, og hvornår skoletid eller ro om aftenen begynder. Telefonen bruger de nye regler, næste gang den synkroniserer med serveren.",
      },
    ],
    guide: "Har du lyst til at prøve? <a href=\"/da/setup/\">Følg trin-for-trin-guiden</a>.",
    note:
      "I dag virker trin 1 og 2 på testtelefoner. Stedet, hvor du vælger reglerne, er ved at blive bygget.",
  },
  compare: {
    title: "Sammenlignet med de typiske alternativer",
    lead: "Hver løsning er et fornuftigt valg for nogen. Sådan placerer Plainphone sig. Kolonnen for Plainphone omfatter også funktioner under udvikling.",
    caption: "Plainphone sammenlignet med en simpel telefon, et børneur og indbygget forældrekontrol",
    cols: ["Simpel telefon", "Børneur", "Indbygget forældrekontrol", "Plainphone"],
    rows: [
      ["Kort, musik, netbank og skoleapps", "Nej", "Nej", "Ja", "Ja, dem du vælger (planlagt)"],
      ["Webfilter til udvalgte domæner", "Intet internet", "Intet internet", "Delvist", "Blokerer tilsvarende webadresser efter opsætning"],
      ["Kun godkendte kan ringe", "Nogle modeller", "Ja", "Delvist", "Ja, opkald og sms (planlagt)"],
      ["Virker på en telefon, du allerede har", "Nej", "Nej", "Ja", "Ja, Android 10+"],
      ["Også til voksne", "Ja", "Nej", "Mest til børn", "Ja (planlagt)"],
      ["Pris", "En ny telefon", "Et nyt ur, ofte med abonnement", "Gratis", "Gratis"],
    ],
  },
  phones: {
    title: "Testede telefoner",
    body:
      "Én indtil videre: en OnePlus 5T med Android 10. Opsætning, låsen og forbindelsen til dashboardet virker, som <a href=\"/da/setup/#tested\">opsætningsguiden</a> viser. Den har endnu ikke været igennem vores <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/bypass-checklist.md\">tjekliste over omgåelser</a> på rigtig hardware, og en telefon regnes først for helt testet, når den har klaret alle test på den liste. Indtil da er Plainphone et eksperiment.",
  },
  open: {
    title: "Gratis og open source",
    body: [
      "Plainphone er gratis og bliver ved med at være det. Koden er offentlig under Apache-2.0-licensen, så alle kan læse den, tjekke den og bygge videre på den.",
      "Den bliver bygget, så du kan køre hele tjenesten på din egen server. En fælles server, placeret i EU, er også planlagt.",
    ],
    follow: "Der er intet nyhedsbrev. Vil du følge med, så giv projektet en stjerne eller følg det på GitHub.",
    github: "Følg med på GitHub",
    donate: "Det bliver muligt at donere senere. Der er ikke noget betalingslink endnu.",
  },
  faq: {
    title: "Spørgsmål",
    items: [
      {
        q: "Virker det på iPhone?",
        a: "Ikke endnu. Apple lader ikke en app låse en iPhone, sådan som Android gør. En lettere udgave bygget på Apples Skærmtid kommer senere. Android forbliver den stærke løsning.",
      },
      {
        q: "Hvad ved Plainphone om mig eller mit barn?",
        a: "Når du har tilknyttet en telefon, sender den status til serveren, så du f.eks. kan se batteriniveauet. Når placering er slået til, sender telefonen sin position med jævne mellemrum, og når du bruger Find. Serveren gemmer kun den seneste position. Placering er som standard slået til for børneprofiler og fra, hvis du styrer din egen telefon. Vi gemmer din kontos e-mailadresse og de regler, du vælger. Vi viser ingen reklamer og sælger ingen data. <a href=\"/da/privacy/\">Privatlivspolitikken</a> har detaljerne.",
      },
      {
        q: "Hvad koster det?",
        a: "Ingenting. Du bruger en telefon, du allerede har, og softwaren er gratis. Senere kan donationer hjælpe med at betale for serverne.",
      },
      {
        q: "Kan man komme uden om det?",
        a: "En, der er fast besluttet og har tid og en computer, kan nulstille en Android-telefon fra gendannelsestilstand (recovery). Plainphone gør det besværligt, men er ikke et fængsel. Er der en Google-konto på telefonen, beder den om kontoen efter en nulstilling, før telefonen virker igen.",
      },
      {
        q: "Hvad med WhatsApp, Snapchat og de andre chatapps?",
        a: "Chatapps er skjult, medmindre du giver adgang til dem, og godkendte kontakter kommer til at dække opkald og sms, ikke det, der sker inde i de apps. Er hele klassen på én app, løser software det ikke. En snak med de andre forældre gør det ofte, fx gennem <a href=\"https://udskydsammen.dk/\">#UdskydSammen</a>.",
      },
    ],
  },
  why: {
    path: "/da/hvorfor/",
    h1: "Hvorfor Plainphone gør, som det gør",
    lead: "Plainphone er til familier, der vil give deres barn en telefon og vente med den fulde smartphone. Forskningen hjælper os med at vælge, hvad vi bygger.",
    sections: [
      ["Sengetid", "En telefon i soveværelset hænger sammen med dårligere søvn hos børn og unge. Med sengetid i Plainphone kan du begrænse, hvilke apps der er tilgængelige. Sundhedsstyrelsen anbefaler, at telefonen bliver uden for soveværelset."],
      ["Hvad forskningen kan fortælle os", "Store studier finder i gennemsnit små sammenhænge mellem brug af teknologi og trivsel. En forskningsgennemgang fra de amerikanske videnskabsakademier fandt ikke grundlag for at fastslå, at sociale medier ændrer unges sundhed på befolkningsniveau. Vi ved ikke, om en begrænset telefon som Plainphone forbedrer trivslen. Trivselskommissionen anbefaler at vente med egen smartphone eller tablet, til barnet er fyldt 13 år."],
      ["Skoletid", "Du vælger, hvornår skoletid gælder, og hvilke apps der er tilgængelige. Studier af skolers mobilregler peger i forskellige retninger, og vi ved ikke, om en tidsplan som denne forbedrer trivslen."],
      ["Webfilter", "Når filteret er sat op, blokerer det forespørgsler til webadresser i de kategorier, du vælger. Det kan mindske sandsynligheden for at møde noget af indholdet. Studier finder kun svagt belæg for, at filtre gør en forskel for, hvor tit unge møder seksuelt indhold. Filtre kan også blokere nyttig sundhedsoplysning. Tal med dit barn om, hvad det kan støde på."],
      ["Privatliv, hjælp og mere frihed", "Børn skal kunne forstå reglerne, se, hvornår deres placering deles, og søge hjælp fortroligt. Det er principper, vi bruger, når vi udvikler Plainphone. Se på reglerne sammen, efterhånden som dit barn bliver ældre."],
      ["Til voksne", "I et kort studie af en anden app gav en pause og en mulighed for at fortryde folk tid til at ombestemme sig, før en app åbnede. De sprang sjældnere en åbning over, efterhånden som studiet skred frem. Det taler for at gøre det nemt at fortryde, når vi designer en pause."],
    ],
    sourcesTitle: "Kilder",
    sources: [
      ["Carter m.fl. om skærme og søvn", "https://doi.org/10.1001/jamapediatrics.2016.2341"],
      ["Sundhedsstyrelsens råd om skærmbrug", "https://www.sst.dk/vidensbase/forebyggelse/anbefalinger-om-brug-af-skaerm"],
      ["Trivselskommissionens anbefalinger", "https://regeringen.dk/aktuelt/nyheder/2025/trivselskommissionens-anbefalinger-er-klar/"],
      ["De amerikanske videnskabsakademier om sociale medier og unges sundhed", "https://www.nationalacademies.org/read/27396/chapter/2"],
      ["Orben og Przybylski om digital teknologi og trivsel", "https://www.nature.com/articles/s41562-018-0506-1"],
      ["Goodyear m.fl. om skolers mobilregler", "https://doi.org/10.1016/j.lanepe.2025.101211"],
      ["Przybylski og Nash om webfiltre", "https://pubmed.ncbi.nlm.nih.gov/29995533/"],
      ["Richardson m.fl. om filtre og adgang til sundhedsoplysning", "https://doi.org/10.1001/jama.288.22.2887"],
      ["Europa-Kommissionens retningslinjer om mindreårige", "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A52025XC05519"],
      ["FN’s Børnekomités generelle kommentar nr. 25", "https://www.ohchr.org/en/documents/general-comments-and-recommendations/general-comment-no-25-2021-childrens-rights-relation"],
      ["Grüning m.fl. om appen one sec", "https://www.pnas.org/doi/10.1073/pnas.2213114120"],
    ],
  },
  privacy: {
    path: "/da/privacy/",
    title: "Privatlivspolitik: Plainphone",
    description:
      "Hvad Plainphone gemmer om dig og de telefoner, du styrer, hvor længe, hvem der ellers er involveret, og hvordan du beder os rette eller slette det.",
    h1: "Privatlivspolitik",
    updated: "Sidst opdateret 17. november 2026",
    lead:
      "Plainphone gemmer så lidt som muligt, så kort tid som muligt. Her står det, hvad det betyder i praksis. Siden er skrevet for at blive læst, ikke for at skjule noget.",
    status:
      "Plainphone er i en tidlig udgave. Forældreappen, serveren, webfilteret og Plainphone-appen på telefonen virker sammen, men det er endnu ikke klar til daglig brug. Når det, Plainphone gemmer, ændrer sig, bliver denne side ændret først.",
    tocLabel: "På denne side",
    short: {
      title: "Kort fortalt",
      list: [
        "Denne side sætter ingen cookies, bruger ingen statistik og henter ikke noget fra andre sider.",
        "Forældreappen gemmer din e-mailadresse og de regler, du sætter for hver telefon. Når en telefon fjernes, bliver alt, der er gemt om den, slettet.",
        "Placering er, når den er slået til, kun telefonens seneste kendte position. Der er ingen historik.",
        "Webfilteret gemmer ikke en liste over de sider, en telefon besøger.",
        "Vi sælger ikke oplysninger, viser ikke reklamer og laver ikke profiler.",
      ],
    },
    sections: [
      {
        id: "ansvarlig",
        title: "Hvem er ansvarlig",
        body: [
          `Plainphone er et open source-projekt, som <a href="https://mahoje.dk">Mahoje</a> vedligeholder i Danmark. Vi er dataansvarlige for den tjeneste, vi driver: forældreappen på app.plainphone.org og webfilteret på dns.plainphone.org.`,
          `Har du spørgsmål om dine oplysninger, fx hvis du vil have en kopi eller have dem slettet, så skriv til <a href="mailto:privacy@plainphone.org">privacy@plainphone.org</a>. Spørgsmål, der ikke er personlige, kan du også stille ved at oprette en sag (issue) på <a href="https://github.com/plainphone/plainphone/issues">github.com/plainphone/plainphone/issues</a>, men sager er offentlige, så skriv ikke personoplysninger som din e-mailadresse i dem. Sikkerhedsfejl meldes privat som beskrevet i <a href="https://github.com/plainphone/plainphone/blob/main/SECURITY.md">SECURITY.md</a>.`,
        ],
      },
      {
        id: "hvorfor",
        title: "Hvorfor vi bruger dine oplysninger",
        body: [
          "Vi bruger dem til at køre Plainphone for dig: at logge dig ind, at lade reglerne gælde på de telefoner, du styrer, og at holde tjenesten i gang og sikker. Retsgrundlaget er aftalen mellem dig og tjenesten (databeskyttelsesforordningens artikel 6, stk. 1, litra b) og vores legitime interesse i sikkerhed og forebyggelse af misbrug (litra f). For en person, som en anden har inviteret, er grundlaget den andens ønske sammen med vores interesse i at få invitationen frem (litra f). Vi bruger oplysningerne til intet andet.",
        ],
      },
      {
        id: "konto",
        title: "Din konto",
        body: [
          "Du logger ind med din e-mailadresse og et link, vi sender dig. Der er ingen adgangskode. Vi gemmer:",
          {
            list: [
              "din e-mailadresse og dit sprog (dansk eller engelsk)",
              "det link til at logge ind, du har bedt om: din e-mailadresse, et udløbstidspunkt og et fingeraftryk (hash) af linket. Det bliver slettet omkring et døgn efter, at det er udløbet, også når der ikke findes en konto til adressen",
              "din session: et fingeraftryk (hash) af den nøgle, din browser har, og hvornår den udløber (højst 60 dage, eller når du logger ud). Vi gemmer ikke din IP-adresse eller din enhed",
              "din husstand: dens navn, hvem der er med, og de invitationer, du har sendt, med den inviterede e-mailadresse og udløbsdato. En invitation bliver slettet, når den tages imod, og et døgn efter at den er udløbet",
            ],
          },
          "Alle i en husstand kan se hinandens e-mailadresser og styre alle husstandens telefoner. Links til at logge ind, sessioner og de nøgler, telefonerne bruger, gemmes som hashes.",
        ],
      },
      {
        id: "telefoner",
        title: "Telefoner og regler",
        body: [
          "En forælder, eller en voksen til sin egen telefon, tilføjer en telefon ved at skrive den kode, telefonen viser. Børn får ikke en konto og bliver aldrig bedt om en e-mailadresse. Om hver telefon gemmer vi det, den voksne sætter op:",
          {
            list: [
              "det navn, den voksne giver telefonen, om det er et barns telefon eller en voksens egen, tidszonen og hvornår telefonen sidst var i kontakt med serveren",
              "nogle få korte oplysninger, som telefonen sender, når den parres, fx model og Androidversion, og dens seneste status: batteriniveau, appversion, om låsen er intakt, og hvilken webfilteradresse den bruger. Hver melding erstatter den forrige",
              "hvis du slår beskyttelse mod nulstilling til, gemmer husstanden dit numeriske Google-konto-id og tidspunktet, hvor kontoen blev tilknyttet. Du kan slette id'et ved at fjerne tilknytningen i husstandens indstillinger eller slette din Plainphone-konto. Vi gemmer hverken din Google-mailadresse eller dine login-tokens til funktionen",
              "for en telefon i stærk tilstand gemmer vi det seneste systemtjek, herunder om bootloaderen er låst, sikkerhedsopdateringens niveau og tidspunktet for tjekket. Hvert tjek erstatter det forrige. Når telefonen fjernes, slettes tjekket. Vi gemmer ikke dens certifikatkæde",
              "de apps, der er på telefonen (navn og pakkenavn), og hvilke af dem der er tilladt",
              "godkendte kontakter: de navne og numre, en forælder selv skriver ind i forældreappen. Serveren har ikke andet fra telefonens kontakter",
              "webfilterets indstillinger: hvilke kategorier der er blokeret, og de domæner, forælderen tillader eller blokerer",
              "skoletid og sengetid og de apps, der er tilladt i dem",
              "på en voksens egen telefon: nøglens indstillinger (en forsinkelse eller e-mailadressen på en betroet person) og de ændringer, der venter på nøglen. En ændring, der er gennemført, annulleret eller afvist, gemmes i 30 dage og slettes derefter",
              "anmodninger fra telefonen: en app fra dens egen liste eller en kontakt (navn og nummer), som den, der har telefonen, beder om at få tilføjet. En anmodning gemmes, mens den er åben, og i 30 dage efter, at en forælder har tilladt eller afvist den",
              "efter hvor mange timers tavshed telefonen regnes for stille (én indstilling pr. telefon, fælles for dens forældre), og for hver forælder om de vil have notifikationer om den",
            ],
          },
          "En betroet person, du udpeger, får en mail. Når personen er logget ind, kan vedkommende se telefonens navn, hvad der bedes om, og din e-mailadresse.",
        ],
      },
      {
        id: "born",
        title: "Børn",
        body: [
          "Børn laver ikke konti. Det gør en forælder, og forælderen bestemmer, hvad der bliver gemt om barnets telefon. Vi indsamler ikke bevidst oplysninger direkte fra børn, vi viser ingen reklamer, og vi laver ikke profiler af børn. De mest følsomme oplysninger om et barns telefon er dens seneste kendte position og listen over godkendte kontakter. Vi anbefaler, at du fortæller dit barn, hvad telefonen deler, og hvorfor.",
        ],
      },
      {
        id: "placering",
        title: "Placering",
        body: [
          "Placering er en indstilling for hver telefon med fire valg: fra; kun når en forælder trykker Find; ved Find og når et »Er du okay?« ikke bliver besvaret; eller altid tændt, hvert femte minut, i en tid forælderen vælger (en time, i dag eller en uge), hvorefter den selv går tilbage til Find og »Er du okay?«. Et barns telefon starter med Find og »Er du okay?«, ikke altid tændt. En voksens egen telefon starter med placering slået fra, og det er ejerens eget valg at slå den til. En forælder kan ændre det når som helst.",
          "Telefonen er åben om det. Hver gang den sender en enkelt position (Find eller et ubesvaret »Er du okay?«), viser den en kort besked om det. Når placering er altid tændt, viser telefonen det hele tiden, i en notifikation og på Plainphones egen skærm. Barnet kan åbne »Hvad kan mine forældre se?« på telefonen: Den forklarer den nuværende indstilling og viser, hver gang placeringen er sendt de sidste 30 dage. Listen bliver på telefonen.",
          "»Er du okay?« beder barnet svare inden for en tid, forælderen vælger. Svarer barnet, sendes der ingen position. Svarer ingen i tide, sender telefonen én position. »Ring telefonen« spiller en alarmlyd og vibrerer i højst fem minutter; den sender ingen position. Serveren gemmer en ringning eller et spørgsmål (tidspunkter og svaret og det godkendte nummer til »Ring til mig«) i et døgn efter, at det er slut, og sletter det så.",
          "Serveren gemmer kun den seneste position: koordinater, nøjagtighed og tidspunkt. Hver ny position erstatter den gamle, og der gemmes ingen historik. Slår du placering fra, eller fjerner du telefonen, bliver den gemte position slettet.",
          "Dashboardet viser positionen på et kort. Kortfliserne kommer fra OpenFreeMap (tiles.openfreemap.org, data fra OpenStreetMap), så når de hentes, får OpenFreeMap at vide, cirka hvilket område der kigges på, og forælderens IP-adresse. Kortet hentes kun på placeringssiden. Forældreappen på en telefon bruger OpenStreetMaps egne fliseservere og først, når forælderen trykker Vis kort. Vælger en forælder »Kør derhen« med Google Maps eller Apple Kort, eller kopierer positionen, går koordinaterne til den app, og så gælder dens egen politik.",
        ],
      },
      {
        id: "webfilter",
        title: "Webfilteret",
        body: [
          "Hver telefon får sin egen adresse hos vores filtrerende DNS-tjeneste (dns.plainphone.org). Sådan virker webfilteret i alle apps. Adressen indeholder et tilfældigt ClientID, ikke dit navn, dit nummer eller et enheds-id. For at kunne svare ser filteret, hvilke domæner telefonen slår op. Det gemmer dem ikke:",
          {
            list: [
              "Ingen log over opslag. Den er slået fra, og telefonerne er desuden holdt ude af den, hvis den ved en fejl skulle blive slået til.",
              "Ingen IP-adresser. Telefonens adresse bliver afkortet, før den når filterets statistik.",
              "Kun tællere: antal opslag og blokeringer, de mest opslåede domæner og de travleste ClientID’er, som totaler. De bliver slettet efter 24 timer.",
              "Filterets indstillinger for hver telefon (ClientID, profil, tilladte og blokerede domæner) gemmes, til telefonen fjernes.",
            ],
          },
          `Tilladte opslag sendes videre over krypterede forbindelser til Quad9 (Schweiz) og Mullvad, med Cloudflare som reserve. De ser domænet og vores servers adresse, aldrig telefonens, og ingen del af telefonens IP-adresse bliver sendt med. De tekniske detaljer står i <a href="https://github.com/plainphone/plainphone/blob/main/docs/privacy.md">docs/privacy.md</a>.`,
        ],
      },
      {
        id: "mail",
        title: "Mail",
        body: [
          "Vi sender kun mail for at køre tjenesten: links til at logge ind, invitationer, de beskeder, en betroet person får, og en advarsel, når en telefon melder, at en nødvendig indstilling er slået fra, eller den har været stille længe. Ingen nyhedsbreve og ingen reklamer. Mails sendes fra vores egen mailserver i EU. Logoet i vores mails hentes fra plainphone.org, som Cloudflare hoster. Viser dit mailprogram billeder, ser Cloudflare derfor din IP-adresse, når logoet hentes. Logoets adresse har ingen identifikator og er den samme for alle, så den fortæller os ikke, hvem der har åbnet en mail.",
        ],
      },
      {
        id: "cookies",
        title: "Denne side, cookies og lagring i din browser",
        body: [
          "plainphone.org sætter ingen cookies, bruger ingen statistik og indlæser hverken scripts, skrifter eller billeder fra andre sider. Siden ligger hos Cloudflare Pages, så Cloudflare behandler, som enhver webhost, din IP-adresse og den adresse, du beder om, når en side leveres. Links til andre sider, fx GitHub, er almindelige links. Når du følger et, gælder den anden sides politik.",
          "Forældreappen på app.plainphone.org sætter én cookie, pp_session. Den holder dig logget ind, sendes kun til vores egen server, kan ikke læses af scripts på siden (HttpOnly), sendes kun ved forespørgsler fra samme side (SameSite=Strict) og varer højst 60 dage. Du har brug for den for at kunne logge ind, så der er intet cookiebanner.",
          "Appen husker desuden i din browser dit valg af sprog og, hvis du slår notifikationer til, id’et på denne enheds notifikationsadresse (lokal lagring) og, kun mens du logger ind, hvor du skal hen bagefter samt en invitations- eller parringskode (sessionslagring, som bliver ryddet, når fanen lukkes). En service worker gemmer en kopi af appens egne filer, så den kan åbnes uden net. Den gemmer aldrig dine oplysninger.",
          "Slår du notifikationer til, giver din browser os en adresse hos dens push-tjeneste (Google for Chrome, Apple for Safari, Mozilla for Firefox, Microsoft for Edge) og to nøgler. Vi gemmer dem med en kort betegnelse som “Chrome · Android”, indtil du slår notifikationer fra, logger ud på enheden, fjerner enheden under Indstillinger, push-tjenesten melder, at adressen ikke længere gælder, eller du sletter din konto. Hver notifikation krypteres til din enhed, før den forlader vores server, så push-tjenesten kan levere den, men ikke læse den. Den kan se, at der blev sendt en notifikation, hvornår, og til hvilken adresse.",
        ],
      },
      {
        id: "andre",
        title: "Hvem andre er involveret",
        body: [
          "Vi sælger ikke oplysninger, deler dem ikke til reklamer og bruger dem ikke til at lave profiler. Disse hjælper os med at drive tjenesten:",
          {
            list: [
              "Hetzner (Tyskland) udlejer de servere, hvor forældreappen, dens database og webfilteret kører. Sikkerhedskopier ligger i objektlager i EU.",
              "Vores egen mailserver i EU sender mails. Det er ikke en mailtjeneste fra en tredjepart.",
              "Cloudflare hoster denne hjemmeside (plainphone.org) og logoet i vores mails.",
              "Quad9 og Mullvad, med Cloudflare som reserve, besvarer tilladte opslag i webfilteret, som beskrevet ovenfor.",
              "Slår du notifikationer til, leverer din browsers push-tjeneste (Google, Apple, Mozilla eller Microsoft) dem. Indholdet er krypteret hele vejen.",
            ],
          },
          "Konto- og telefonoplysninger ligger på servere i EU.",
        ],
      },
      {
        id: "opbevaring",
        title: "Hvor længe vi gemmer tingene",
        body: [
          {
            table: {
              caption: "Hvor længe hver slags oplysninger gemmes",
              cols: ["Hvad", "Hvor længe"],
              rows: [
                ["Links til at logge ind", "Omkring et døgn efter, at de er udløbet (de udløber efter 15 minutter)"],
                ["Sessioner", "Til de udløber (60 dage), eller du logger ud"],
                [
                  "Parringskoder",
                  "Slettes inden for et døgn. Det gælder også den nøgle, telefonen henter én gang. Indtil da ligger den i læselig form",
                ],
                [
                  "Din konto (e-mailadresse, sprog)",
                  "Til du sletter kontoen under Indstillinger i appen, eller beder os om det",
                ],
                [
                  "Husstand, telefoner, apps, kontakter, skoletid, filterindstillinger",
                  "Til telefonen fjernes (på telefonens side i appen), eller din konto bliver slettet. En husstand bliver slettet sammen med kontoen for dens sidste medlem. En fjernet kontakt eller tidsplan bliver slettet, når fjernelsen træder i kraft",
                ],
                [
                  "Seneste position",
                  "Kun den seneste. Den bliver slettet, når du slår placering fra eller fjerner telefonen",
                ],
                [
                  "Ændringer, der har ventet på nøglen på en voksens egen telefon",
                  "Mens de venter, og 30 dage efter at de er gennemført, annulleret eller afvist",
                ],
                [
                  "Anmodninger fra en telefon (en app eller en kontakt)",
                  "Mens de er åbne, og 30 dage efter, at de er tilladt eller afvist",
                ],
                [
                  "Adresser til notifikationer (én pr. enhed)",
                  "Indtil du slår notifikationer fra eller logger ud på enheden, fjerner den, push-tjenesten afviser adressen, eller du sletter din konto",
                ],
                [
                  "Invitationer",
                  "Slettes, når de tages imod. Ellers holder de op med at virke efter 7 dage og slettes et døgn senere. Du kan altid trække en åben invitation tilbage",
                ],
                ["Webfilterets tællere", "24 timer"],
                [
                  "Sikkerhedskopier af databasen",
                  "Tages hver nat og gemmes i op til 30 dage. Slettede oplysninger kan ligge i en sikkerhedskopi, til den udløber",
                ],
                ["Sikkerhedskopier af webfilterets indstillinger", "De seneste 14 daglige kopier"],
              ],
            },
          },
          "Som enhver webtjeneste skriver den webserver, der står foran appen, almindelige tekniske logs (IP-adresse, tidspunkt, den adresse der bedes om). Vi bruger dem kun til at holde tjenesten kørende og til at stoppe misbrug. Selve appen har kun IP-adresser i hukommelsen, til grænser for hyppighed, og skriver dem aldrig i sin database.",
        ],
      },
      {
        id: "rettigheder",
        title: "Dine rettigheder",
        body: [
          "Du kan, uden beregning, bede os om en kopi af de oplysninger, vi har om dig, om at rette dem, om at slette dem, om at begrænse brugen af dem, om at få dem udleveret i et almindeligt format eller om at stoppe en brug, du er imod. Du kan også klage til <a href=\"https://www.datatilsynet.dk/\">Datatilsynet</a> eller til tilsynsmyndigheden i dit eget land.",
          "I forældreappen kan du allerede selv gøre noget af det:",
          {
            list: [
              "ændre en telefons kontakter, apps, webfilter og tidsplaner",
              "slå placering fra, så den gemte position bliver slettet",
              "trække en åben invitation tilbage",
              "omdøbe eller fjerne en telefon. Når den fjernes, bliver alt, der er gemt om den, slettet, og webfilteret bliver bedt om at glemme dens ClientID, indtil det bekræfter. På en voksens egen telefon venter fjernelsen på nøglen",
              "forlade en husstand (det sidste medlem kan ikke forlade den, men kan slette sin konto)",
              "slette din konto under Indstillinger. En husstand, du deler med en anden forælder, bliver hos dem med sine telefoner. En husstand, kun du er med i, bliver slettet med sine telefoner. Er du betroet person for en anden, bliver deres nøgle i stedet en forsinkelse. I en husstand, kun du er med i, skal telefoner med en nøgle (en voksens egen telefon) først fjernes gennem nøglen",
              "logge ud, så sessionen slutter",
            ],
          },
          "Der er endnu ingen knap til at hente dine oplysninger. Bed os om det eller om noget andet på listen (se Hvem er ansvarlig). Vi tjekker, at du har adgang til e-mailadressen, før vi ændrer eller sletter noget, og vi sigter mod at svare inden for en måned.",
        ],
      },
      {
        id: "egen-server",
        title: "Din egen server",
        body: [
          `Plainphone kan køre på din egen server. Gør du det, er du selv ansvarlig for serveren og dens oplysninger, og denne politik gælder ikke for den. Softwaren gemmer det, der står her, men du vælger, hvor den kører, hvor længe sikkerhedskopier gemmes (eksemplet i opsætningen gemmer 14 daglige og 8 ugentlige kopier), og hvilke mail- og DNS-tjenester den bruger. Vejledningerne er <a href="https://github.com/plainphone/plainphone/blob/main/docs/self-hosting.md">self-hosting.md</a> og <a href="https://github.com/plainphone/plainphone/blob/main/docs/self-hosting-dns.md">self-hosting-dns.md</a> (på engelsk).`,
        ],
      },
      {
        id: "aendringer",
        title: "Ændringer i politikken",
        body: [
          `Ændrer vi, hvad vi gør, ændrer vi denne side og datoen øverst, før ændringen træder i kraft. Siden er en del af det offentlige projekt, så hver ændring kan ses i dens <a href="https://github.com/plainphone/plainphone/commits/main/site/content">historik på GitHub</a>.`,
        ],
      },
    ],
  },
  setup: {
    path: "/da/setup/",
    title: "Sæt en telefon op: Plainphone",
    h1: "Sæt en telefon op",
    description: "Sæt Plainphone op på en ny Android-telefon eller en telefon i brug med en privat kode fra dit dashboard.",
    lead: "Du skal bruge en telefon med Android 10 eller nyere og dashboardet åbent på en anden enhed.",
    question: "Er telefonen ny eller allerede i brug?",
    strong: "Den er ny eller nulstillet",
    strongHelp: "Anbefalet. Plainphone kan beskytte flere indstillinger på en ny eller nulstillet telefon.",
    light: "Den er allerede i brug",
    lightHelp: "Behold telefonens indhold, og slå beskyttelsen til i Androids indstillinger.",
    startStrong: "Start opsætning af en ny eller nulstillet telefon",
    startLight: "Start opsætning af en telefon i brug",
    start: "Vælg i dashboardet, hvem telefonen er til, og lav et opsætningslink.",
    strongTitle: "Ny eller nulstillet telefon",
    lightTitle: "Telefonen er allerede i brug",
    lightSteps: [
      ["Åbn linket på telefonen", "Scan koden fra dashboardet med telefonens kamera, eller åbn det private link i Chrome på telefonen.", "lightScan"],
      ["Installer Plainphone", "Hent appen, og åbn filen. Hvis Android blokerer, så tryk på Indstillinger, slå Tillad fra denne kilde til, gå tilbage, og tryk på Installer.", "download"],
      ["Gå tilbage til Chrome, og tryk på Åbn Plainphone", "Tjek adressen på dit dashboard. Vælg en forælder-PIN på 6 til 12 cifre, og indtast den to gange på telefonen. Følg trinene, indtil telefonen har hentet dine regler.", "permissions"],
    ],
    lightHelpItems: [
      ["Android siger, at en indstilling er begrænset", "Åbn hjælpen under trinet med vagten i Plainphone. Tryk på de tre prikker i Appinfo, og vælg Tillad begrænsede indstillinger. Gå tilbage til Plainphone, og prøv igen. Vagten lukker apps, du ikke har tilladt."],
      ["Android spørger, om den må forbinde til et VPN", "Tryk på OK. Så kan Plainphone tjekke webadresser med dit webfilter."],
      ["Jeg åbnede appen fra installationsvinduet", "Gå tilbage til Chrome, og tryk på Åbn Plainphone på opsætningssiden. Hvis du allerede har indtastet en PIN-kode på telefonen, skal du bruge den samme i dashboardet."],
    ],
    nextTitle: "Når telefonen er forbundet",
    next: "Tilføj kontakter, vælg apps fra kataloget, eller sæt skoletid i dashboardet.",
    steps: [
      {
        title: "Nulstil telefonen",
        body: [
          "Gem først det, du vil beholde, hvis telefonen skal nulstilles. Vælg derefter Indstillinger → System → Nulstil → Slet alle data. Vent, til velkomstskærmen vises.",
          "Menuernes navne varierer lidt fra mærke til mærke. Er der en Google-konto på telefonen, så fjern den først (Indstillinger → Konti). Ellers beder telefonen om kontoen efter nulstillingen.",
        ],
        fig: "reset",
      },
      {
        title: "Tryk 6 gange på velkomstskærmen",
        body: [
          "Tryk hurtigt 6 gange på det samme tomme sted på den første velkomstskærm. Tryk ikke på Start. En QR-læser åbner. På nogle telefoner spørger den først, om du vil hente den.",
        ],
        fig: "welcome",
      },
      {
        title: "Scan QR-koden",
        body: [
          "Scan koden fra dashboardet, og vælg derefter et Wi-Fi-netværk. Telefonen henter Plainphone og slår låsen til, før du tager telefonen i brug.",
          "Siger telefonen, at den bliver styret af en organisation, er det Plainphone. Accepter det: det er sådan, låsen virker.",
        ],
        fig: "scan",
      },
      {
        title: "Kun Android 10 til 13: vælg standardapp til telefon",
        body: [
          "Under opsætningen eller lige efter spørger telefonen, om du vil angive Plainphone som standardapp til telefon. Tryk <strong>Angiv som standard</strong>. Nåede du det ikke, så åbn Plainphone-appen, så spørger den igen.",
          "På Android 14 og nyere sker det af sig selv.",
        ],
        fig: "dialog",
      },
    ],
    figs: {
      lightScan: "En telefonskærm med et kamera, der scanner en kode.",
      download: "En telefonskærm med en pil, der viser, hvor du henter appen.",
      permissions: "En telefonskærm med to kontakter til indstillinger.",
      reset: "Tegning af en telefon med en liste over indstillinger, hvor rækken til at slette alle data er markeret.",
      welcome: "Tegning af en telefon på den første velkomstskærm. Seks tryk på det samme tomme sted, markeret »6×«.",
      scan: "To tegninger af en telefon. På den første indrammer en QR-læser en QR-kode. På den anden en liste over Wi-Fi-netværk, hvor ét er valgt.",
      dialog: "Tegning af en telefon med en dialogboks og to knapper, »Angiv som standard« og »Annuller«.",
    },
    drawing: { taps: "6×", set: "Angiv som standard", cancel: "Annuller" },
    troubleTitle: "Hvis noget går galt",
    trouble: [
      [
        "QR-koden er udløbet eller virker ikke",
        "En kode virker én gang og i 24 timer. Åbn telefonen i dashboardet, og vælg <strong>Vis QR-koden til opsætning</strong> for at få en ny. En ny kode får den gamle til at holde op med at virke.",
      ],
      [
        "Telefonen siger, at enheden ikke kan sættes op",
        "Tjek, at telefonen har Android 10 eller nyere (Indstillinger → Om telefonen). Ældre telefoner kan ikke bruges.",
      ],
      [
        "Telefonen viser en kode i stedet for at forbinde",
        "Vælg <strong>Tilføj telefon</strong> i dashboardet, derefter <strong>Indtast koden</strong> nederst, og skriv den kode, telefonen viser.",
      ],
      [
        "Seks tryk gør ingenting",
        "Telefonen skal stå på allerførste velkomstskærm. Tryk hurtigt ét sted midt på skærmen, og tryk ikke på Start.",
      ],
    ],
    help: "Sidder du stadig fast? <a href=\"https://github.com/plainphone/plainphone/issues\">Opret en sag på GitHub</a> (et issue).",
    testedTitle: "Testede telefoner",
    tested: {
      caption: "Telefoner, som Plainphone er sat op på",
      cols: ["Telefon", "Android", "Resultat"],
      rows: [["OnePlus 5T (A5010)", "Android 10", "Virker"]],
      body: [
        "Virker betyder, at opsætning, låsen og forbindelsen til dashboardet er bekræftet på denne telefon. Den har endnu ikke været igennem hele tjeklisten over omgåelser.",
        "Android 14 eller nyere anbefales. Den klarer alt selv og låser telefonappen i Indstillinger.",
        "På Android 10 til 13 er der ét kendt hul: barnet kan skifte til den indbyggede telefonapp i Indstillinger. Så bliver opkald ikke filtreret, før Plainphone er valgt igen. Dashboardet viser det inden for 15 minutter.",
      ],
    },
  },
  footer: {
    maintained: "Plainphone vedligeholdes af <a href=\"https://mahoje.dk\">Mahoje</a> i Danmark.",
    setup: "Guide: <a href=\"/da/setup/\">Sæt en telefon op</a>.",
    privacy: "Siden sætter ingen cookies og bruger ingen statistik. <a href=\"/da/privacy/\">Privatlivspolitik</a>.",
    license: "Koden er under <a href=\"https://github.com/plainphone/plainphone/blob/main/LICENSE\">Apache-2.0</a>. Skrift: Atkinson Hyperlegible Next, <a href=\"/fonts/OFL.txt\">SIL OFL</a>.",
  },
  notFound: {
    title: "Siden findes ikke",
    body: "Der er ikke noget på denne adresse.",
    back: "Gå til forsiden",
  },
};
