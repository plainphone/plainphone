// SPDX-License-Identifier: Apache-2.0
// "Give directly" page (issue #103), one entry per language.
//
// UNLINKED ON PURPOSE. Until Mads has confirmed that each organisation below agrees to be named,
// this page is not in the navigation, the footer or the sitemap, and the build gives it
// <meta name="robots" content="noindex"> (see givingPage in build.mjs). To publish it, link it from
// the footer, add it to the sitemap routes, drop `noindex`, and in scripts/check.mjs move "giving/" from
// the unlisted `givingPaths` into `routes`. Never mention a charity share of any purchase here.

// Names only, no logos. Each link is the organisation's own donation page, except
// Center for Digital Pædagogik, which has no donation page, so its homepage is linked.
export const organisations = [
  ["Børns Vilkår", "https://indsamling.bornsvilkar.dk/"],
  ["Red Barnet", "https://indsamling.redbarnet.dk/"],
  ["Center for Digital Pædagogik", "https://cfdp.dk/"],
  ["Psykiatrifonden", "https://psykiatrifonden.dk/stoet"],
  ["headspace Danmark", "https://headspace.dk/stoet/"],
  ["Danmarks Naturfredningsforening", "https://www.dn.dk/stoet/"],
  ["Den Danske Naturfond", "https://naturfonden.dk/stoet/"],
  ["Trees for the Future", "https://trees.org/support/personal-ways-to-give"],
  ["Læger uden Grænser", "https://msf.dk/stoet/"],
  ["Against Malaria Foundation", "https://www.againstmalaria.com/Donation.aspx"],
];

export const giving = {
  en: {
    path: "/giving/",
    title: "Give directly: Plainphone",
    h1: "Give directly",
    lead: "Plainphone is free. If you want to give something, give it to one of these.",
    description: "Plainphone is free. If you want to give something, give it to one of these organisations. Mahoje never receives the money.",
    body: [
      "You give straight to the organisation, on its own website. Mahoje never receives or handles the money, and giving unlocks nothing in Plainphone. Nobody asks whether you gave.",
    ],
    listTitle: "Organisations",
    listNote: "Each link goes to the organisation’s own website.",
  },
  da: {
    path: "/da/giving/",
    title: "Giv direkte: Plainphone",
    h1: "Giv direkte",
    lead: "Plainphone er gratis. Hvis du har lyst til at give noget, så giv det til en af disse.",
    description: "Plainphone er gratis. Hvis du har lyst til at give noget, så giv det til en af disse organisationer. Mahoje modtager aldrig pengene.",
    body: [
      "Du giver direkte til organisationen på dens egen hjemmeside. Mahoje modtager eller håndterer aldrig pengene, og at give låser ikke noget op i Plainphone. Ingen spørger, om du har givet.",
    ],
    listTitle: "Organisationer",
    listNote: "Hvert link går til organisationens egen hjemmeside.",
  },
  sv: {
    path: "/sv/giving/",
    title: "Ge direkt: Plainphone",
    h1: "Ge direkt",
    lead: "Plainphone är gratis. Om du vill ge något, ge det till en av dessa.",
    description: "Plainphone är gratis. Om du vill ge något, ge det till en av dessa organisationer. Mahoje tar aldrig emot pengarna.",
    body: [
      "Du ger direkt till organisationen, på dess egen webbplats. Mahoje tar aldrig emot eller hanterar pengarna, och att ge låser inte upp något i Plainphone. Ingen frågar om du har gett.",
    ],
    listTitle: "Organisationer",
    listNote: "Varje länk går till organisationens egen webbplats.",
  },
  nb: {
    path: "/nb/giving/",
    title: "Gi direkte: Plainphone",
    h1: "Gi direkte",
    lead: "Plainphone er gratis. Hvis du har lyst til å gi noe, gi det til en av disse.",
    description: "Plainphone er gratis. Hvis du har lyst til å gi noe, gi det til en av disse organisasjonene. Mahoje mottar aldri pengene.",
    body: [
      "Du gir direkte til organisasjonen, på nettstedet deres. Mahoje mottar eller håndterer aldri pengene, og å gi låser ikke opp noe i Plainphone. Ingen spør om du har gitt.",
    ],
    listTitle: "Organisasjoner",
    listNote: "Hver lenke går til organisasjonens eget nettsted.",
  },
  de: {
    path: "/de/giving/",
    title: "Direkt spenden: Plainphone",
    h1: "Direkt spenden",
    lead: "Plainphone ist kostenlos. Wenn Sie etwas geben möchten, geben Sie es einer dieser Organisationen.",
    description: "Plainphone ist kostenlos. Wenn Sie etwas geben möchten, geben Sie es einer dieser Organisationen. Mahoje erhält das Geld nie.",
    body: [
      "Sie spenden direkt an die Organisation, auf deren eigener Website. Mahoje nimmt das Geld nie entgegen und fasst es nie an, und eine Spende schaltet in Plainphone nichts frei. Niemand fragt, ob Sie gespendet haben.",
    ],
    listTitle: "Organisationen",
    listNote: "Jeder Link führt zur eigenen Website der Organisation.",
  },
};
