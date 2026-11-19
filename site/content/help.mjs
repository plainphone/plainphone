// SPDX-License-Identifier: Apache-2.0
import { translations } from "./help-translations.mjs";

export const help = {
  ...translations,
  en: {
    path: "/help/",
    title: "Help and support",
    topics: "Help topics",
    lead: "Get help installing, unlocking or resetting a phone with Plainphone.",
    sections: [
      {
        id: "recovery",
        title: "I can’t release or factory reset the phone",
        body: [
          "If you can open Maintenance with the parent PIN, try Release Device Owner in strong mode or Switch Plainphone off in light mode. If release fails or Android blocks a reset from Settings, a reset from recovery may help.",
          "<strong>A factory reset erases the data on the phone.</strong> Back up what you can and check that you know the screen lock and the sign-in for a Google Account previously synced with the phone. Android may ask for them during setup.",
          "If you linked parent Google accounts under Household → Protect against reset, Android may require one of those accounts, even if it was never signed in on the phone. Before wiping, confirm you can sign in, wait until the account’s Ready from time, and open the phone in the dashboard and check that its latest report under <strong>Phone status</strong> shows reset protection is on. If you cannot confirm access to an eligible account, contact support before wiping.",
          { steps: [
            "Switch the phone off. Look up how to start recovery mode for your exact model on the manufacturer’s support site. The buttons vary by model.",
            "In recovery, choose <strong>Wipe data/factory reset</strong> or the equivalent option, then confirm the erase. Follow the instructions on the recovery screen.",
            "Choose <strong>Reboot system now</strong> or the equivalent option. Follow Android setup. Remove the old phone from the dashboard if it still appears there. To use Plainphone again, install the current version and pair the phone again.",
          ] },
          '<a href="https://support.google.com/android/answer/6088915?hl=en">Google’s guide to preparing for a factory reset</a>',
        ],
      },
      {
        id: "play-protect",
        title: "Play Protect blocks the installation",
        body: [
          'Use the <a href="/setup/">official Plainphone setup guide</a> and download a fresh copy of the app from the link there. If Play Protect offers to scan the app, let it finish.',
          "If Android still blocks it or identifies the app as harmful, keep Play Protect on and contact support from another device. Include the wording shown on the phone and leave out account details.",
        ],
      },
      {
        id: "restricted-settings",
        title: "Android 13 or later says a setting is restricted",
        body: [
          "Open Settings, then Apps, and choose Plainphone. In App info, open the three-dot menu and choose Allow restricted settings. Confirm if Android asks, then return to Plainphone and retry the setup step.",
          "Only allow restricted settings for an app you trust. If the menu item is missing, contact support.",
        ],
      },
      {
        id: "vpn",
        title: "The web filter stops working with another VPN",
        body: [
          "In light mode, Plainphone uses Android’s VPN slot for its web filter. Android allows one active VPN per profile. Disconnect the other VPN, turn off Always-on VPN for it if enabled, then return to Plainphone and turn the web filter back on. If you need to keep the other VPN on, Plainphone can use Android’s Private DNS for the web filter instead. In the dashboard or parent app, open the phone’s Web filter and turn on Private DNS. During first setup, choose it when Plainphone asks about another VPN.",
          "In strong mode, Plainphone uses Android Private DNS. A VPN can use its own DNS instead. Disconnect it to check whether the filter starts working again.",
        ],
      },
    ],
    contact: "Contact support",
    contactText: "Describe what you tried and what happened. You can paste the diagnostics from Maintenance or the dashboard. Leave out names, account details and other personal information.",
  },
  da: {
    path: "/da/help/",
    title: "Hjælp og support",
    topics: "Emner på hjælpesiden",
    lead: "Få hjælp til at installere Plainphone, frigive en telefon eller nulstille den.",
    sections: [
      {
        id: "recovery",
        title: "Jeg kan ikke frigive eller nulstille telefonen",
        body: [
          "Hvis du kan åbne Vedligeholdelse med forældrenes pinkode, så prøv at frigive telefonen i stærk tilstand eller vælge Slå Plainphone fra i let tilstand. Hvis frigivelsen mislykkes, eller Android blokerer nulstilling fra Indstillinger, kan du prøve at nulstille fra gendannelsestilstand.",
          "<strong>En fabriksnulstilling sletter data på telefonen.</strong> Tag en sikkerhedskopi af det, du kan, og tjek, at du kender skærmlåsen og kan logge ind på en Google-konto, der tidligere har været synkroniseret med telefonen. Android kan bede om dem under opsætningen.",
          "Hvis I har tilknyttet forældrenes Google-konti under Husstand → Beskyt mod nulstilling, kan Android kræve en af dem, selv om kontoen aldrig har været brugt på telefonen. Før du sletter telefonen, så tjek, at du kan logge ind, vent til tidspunktet under Klar fra, og åbn telefonen i kontrolpanelet, og tjek under <strong>Telefonens status</strong>, at den seneste rapport viser, at beskyttelse mod nulstilling er slået til. Kontakt support før nulstillingen, hvis du er i tvivl om, hvorvidt du har adgang til en konto, der kan låse telefonen op.",
          { steps: [
            "Sluk telefonen. Find vejledningen til gendannelsestilstand for netop din model hos producenten. Knapperne varierer efter model.",
            "Vælg <strong>Wipe data/factory reset</strong> eller den tilsvarende mulighed i gendannelsesmenuen, og bekræft sletningen. Følg vejledningen på skærmen.",
            "Vælg <strong>Reboot system now</strong> eller den tilsvarende mulighed. Følg Androids opsætning. Fjern den gamle telefon fra kontrolpanelet, hvis den stadig står der. Hvis du vil bruge Plainphone igen, så installér den nyeste version, og tilknyt telefonen på ny.",
          ] },
          '<a href="https://support.google.com/android/answer/6088915?hl=da">Googles vejledning til at forberede en fabriksnulstilling</a>',
        ],
      },
      {
        id: "play-protect",
        title: "Play Protect blokerer installationen",
        body: [
          'Brug den <a href="/da/setup/">officielle opsætningsvejledning</a>, og hent appen igen via linket i vejledningen. Hvis Play Protect tilbyder at scanne appen, så lad scanningen køre færdig.',
          "Hvis Android stadig blokerer appen eller markerer den som skadelig, så lad Play Protect være slået til, og kontakt support fra en anden enhed. Skriv, hvad der står på telefonen, og udelad kontooplysninger.",
        ],
      },
      {
        id: "restricted-settings",
        title: "Android 13 eller nyere siger, at en indstilling er begrænset",
        body: [
          "Åbn Indstillinger, vælg Apps, og vælg Plainphone. Åbn menuen med de tre prikker i Appoplysninger, og vælg Tillad begrænsede indstillinger. Bekræft, hvis Android spørger. Gå tilbage til Plainphone, og prøv trinnet igen.",
          "Tillad kun begrænsede indstillinger for apps, du stoler på. Kontakt support, hvis menupunktet mangler.",
        ],
      },
      {
        id: "vpn",
        title: "Webfilteret holder op med at virke med en anden VPN",
        body: [
          "I let tilstand bruger webfilteret Androids VPN-forbindelse. Android tillader én aktiv VPN pr. profil. Afbryd den anden VPN, slå Altid aktiv VPN fra for den, hvis den er slået til, og åbn Plainphone for at slå webfilteret til igen. Skal den anden VPN blive ved med at køre, kan Plainphone bruge Androids private DNS til webfilteret i stedet. I dashboardet eller forældreappen åbner du telefonens Webfilter og slår Privat DNS til. Ved første opsætning vælger du det, når Plainphone spørger om en anden VPN.",
          "I stærk tilstand bruger Plainphone Androids Private DNS. En VPN kan bruge sin egen DNS. Afbryd den for at se, om filteret virker igen.",
        ],
      },
    ],
    contact: "Kontakt support",
    contactText: "Beskriv, hvad du har prøvet, og hvad der skete. Du kan indsætte de tekniske oplysninger fra Vedligeholdelse eller kontrolpanelet. Udelad navne, kontooplysninger og andre personoplysninger.",
  },
};
