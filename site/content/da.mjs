// SPDX-License-Identifier: Apache-2.0
// Danish copy. Strings may contain trusted inline HTML (links, <em>).
export default {
  lang: "da",
  path: "/da/",
  title: "Plainphone: en rolig telefon lavet af en almindelig Android",
  description:
    "Gratis open source-software, der gør en almindelig Android-telefon rolig: opkald, sms, kamera og de apps, du vælger. Ingen feeds, ingen reklamer.",
  ogAlt: "Plainphone: din telefon, uden støjen.",
  skip: "Gå til indholdet",
  nav: { label: "Hovedmenu", source: "Kildekode", switchLabel: "English", switchLang: "en" },
  status: "Tidlig udgave. Open source. Endnu ikke klar til daglig brug.",
  hero: {
    title: "Din telefon, uden støjen.",
    lead:
      "Plainphone gør en almindelig Android-telefon rolig. Den beholder det, du har brug for, og fjerner stille og roligt resten. Det er gratis, og koden er åben.",
    staysLabel: "Det beholder du",
    stays: ["Opkald", "Sms", "Kamera", "Kort, musik og de apps, du vælger"],
    goesLabel: "Det ryger",
    goes: ["Feeds fra sociale medier", "Reklamer", "Spil", "Porno og spil om penge", "App-butikker, medmindre du giver adgang"],
  },
  who: {
    title: "Hvem det er til",
    lead: "Alle, der vil have et roligere liv med en telefon i. Reglerne er de samme. Forskellen er, hvem der har nøglen. Det er det, Plainphone er ved at blive bygget til.",
    paths: [
      {
        id: "child",
        title: "Til mit barn",
        body:
          "En første telefon, der kan ringe, skrive, finde vej hjem og spille musik, uden de dele, der sluger en eftermiddag. Du har nøglen: du kommer til at vælge apps og kontakter og kan åbne mere op, efterhånden som barnet bliver ældre.",
      },
      {
        id: "self",
        title: "Til mig selv",
        body:
          "Mindre skærmtid, uden at give slip på kort, netbank eller kamera. Du får selv nøglen, med en forsinkelse: når du løsner en regel, træder den først i kraft efter fx 24 timer, så et svagt øjeblik når at gå over. Eller lad en, du stoler på, godkende det.",
      },
    ],
  },
  how: {
    title: "Sådan virker det",
    steps: [
      {
        title: "Nulstil telefonen",
        body: "En Android-telefon med Android 14 eller nyere (se testede telefoner nedenfor). Opsætningen sletter den, så gem det, du vil beholde, først.",
      },
      {
        title: "Scan en QR-kode",
        body: "Tryk seks gange på velkomstskærmen, og scan koden. Telefonen installerer Plainphone og låser sig selv, før den bliver taget i brug.",
      },
      {
        title: "Vælg reglerne",
        body: "Vælg hvilke apps der vises, hvem der kan ringe, og hvornår skoletid eller ro om aftenen begynder. En strammere regel kommer til at gælde med det samme.",
      },
    ],
    note:
      "I dag virker trin 1 og 2 på testtelefoner. Stedet, hvor du vælger reglerne, er ved at blive bygget.",
  },
  compare: {
    title: "Sammenlignet med de typiske alternativer",
    lead: "Hver løsning er et fornuftigt valg for nogen. Sådan placerer Plainphone sig. Kolonnen for Plainphone viser målet; i dag virker kun låsen.",
    caption: "Plainphone sammenlignet med en simpel telefon, et børneur og indbygget forældrekontrol",
    cols: ["Simpel telefon", "Børneur", "Indbygget forældrekontrol", "Plainphone"],
    rows: [
      ["Kort, musik, netbank og skoleapps", "Nej", "Nej", "Ja", "Ja, dem du vælger (planlagt)"],
      ["Webfilter, der også virker inde i apps", "Intet internet", "Intet internet", "Delvist", "Ja, i de fleste apps (planlagt)"],
      ["Kun godkendte kan ringe", "Nogle modeller", "Ja", "Delvist", "Ja, opkald og sms (planlagt)"],
      ["Virker på en telefon, du allerede har", "Nej", "Nej", "Ja", "Ja, Android 14+"],
      ["Også til voksne", "Ja", "Nej", "Mest til børn", "Ja (planlagt)"],
      ["Pris", "En ny telefon", "Et nyt ur, ofte med abonnement", "Gratis", "Gratis"],
    ],
  },
  phones: {
    title: "Testede telefoner",
    body:
      "Ingen endnu. En telefon kommer først på listen, når den har klaret alle test i vores <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/bypass-checklist.md\">tjekliste over omgåelser</a> på rigtig hardware. Indtil da er Plainphone et eksperiment.",
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
        a: "Så lidt som muligt. Når placering kommer, gemmes kun telefonens seneste position, aldrig en historik. Ingen sporing, ingen reklamer, intet bliver solgt. For voksne, der styrer deres egen telefon, er placering slået fra som standard. I dag er der ingen server, så der bliver slet ikke indsamlet noget.",
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
  footer: {
    maintained: "Plainphone vedligeholdes af <a href=\"https://mahoje.dk\">Mahoje</a> i Danmark.",
    privacy: "Siden sætter ingen cookies og bruger ingen statistik.",
    license: "Koden er under <a href=\"https://github.com/plainphone/plainphone/blob/main/LICENSE\">Apache-2.0</a>. Skrift: Atkinson Hyperlegible Next, <a href=\"/fonts/OFL.txt\">SIL OFL</a>.",
  },
  notFound: {
    title: "Siden findes ikke",
    body: "Der er ikke noget på denne adresse.",
    back: "Gå til forsiden",
  },
};
