// SPDX-License-Identifier: Apache-2.0
export const translations = {
  sv: {
    path: "/sv/help/",
    title: "Hjälp och support",
    topics: "Hjälpavsnitt",
    lead: "Få hjälp med att installera Plainphone, frigöra en telefon eller återställa den.",
    sections: [
      {
        id: "recovery",
        title: "Jag kan inte frigöra eller fabriksåterställa telefonen",
        body: [
          "Om du kan öppna Underhåll med förälderns PIN-kod, försök frigöra telefonen i starkt läge eller stänga av Plainphone i lätt läge. Om det misslyckas eller Android blockerar återställning från Inställningar kan du prova återställningsläget.",
          "<strong>En fabriksåterställning raderar data på telefonen.</strong> Säkerhetskopiera det du kan och kontrollera att du kan låsa upp skärmen och logga in på ett Google-konto som tidigare synkroniserats med telefonen. Android kan fråga efter dem under konfigurationen.",
          "Om du har lagt till en förälders Google-konto under Hushåll → Skydda mot återställning kan Android kräva det kontot, även om det aldrig använts på telefonen. Kontrollera att du kan logga in, vänta till tidpunkten då kontot är redo och kontrollera på telefonens sida i kontrollpanelen att telefonens senaste rapport visar att återställningsskyddet är på. Kontakta supporten före återställningen om du är osäker på om du har tillgång till ett konto som kan låsa upp telefonen.",
          { steps: [
            "Stäng av telefonen. Sök på tillverkarens supportsida efter hur du öppnar återställningsläget på just din modell. Knapparna varierar mellan modeller.",
            "Välj <strong>Wipe data/factory reset</strong> eller motsvarande i återställningsmenyn och bekräfta raderingen. Följ instruktionerna på skärmen.",
            "Välj <strong>Reboot system now</strong> eller motsvarande. Följ Androids konfigurationssteg. Ta bort den gamla telefonen från kontrollpanelen om den fortfarande visas. Installera den aktuella versionen och parkoppla telefonen igen om du vill fortsätta använda Plainphone.",
          ] },
          '<a href="https://support.google.com/android/answer/6088915?hl=sv">Googles guide till att förbereda en fabriksåterställning</a>',
        ],
      },
      {
        id: "play-protect",
        title: "Play Protect blockerar installationen",
        body: [
          'Följ <a href="/sv/setup/">Plainphones officiella installationsguide</a> och ladda ner appen på nytt via länken där. Om Play Protect erbjuder sig att genomsöka appen, låt kontrollen gå klart.',
          "Om Android fortfarande blockerar appen eller markerar den som skadlig, låt Play Protect vara på och kontakta supporten från en annan enhet. Skriv vad det står på telefonen och utelämna kontouppgifter.",
        ],
      },
      {
        id: "restricted-settings",
        title: "Android 13 eller senare säger att en inställning är begränsad",
        body: [
          "Öppna Inställningar, välj Appar och sedan Plainphone. Öppna menyn med tre punkter i appinformationen och välj Tillåt begränsade inställningar. Bekräfta om Android frågar, gå tillbaka till Plainphone och försök igen.",
          "Tillåt bara begränsade inställningar för appar du litar på. Kontakta supporten om alternativet saknas.",
        ],
      },
      {
        id: "vpn",
        title: "Webbfiltret slutar fungera med en annan VPN",
        body: [
          "I lätt läge använder Plainphone Androids VPN-anslutning för webbfiltret. Android tillåter en aktiv VPN per profil. Koppla från den andra VPN-anslutningen, stäng av Alltid aktiv VPN för den om det är aktiverat och slå sedan på webbfiltret igen i Plainphone. Behöver du behålla den andra VPN-anslutningen kan Plainphone använda Androids privata DNS för webbfiltret i stället. I dashboarden eller föräldraappen öppnar du telefonens Webbfilter och slår på Privat DNS. Vid första installationen väljer du det när Plainphone frågar om en annan VPN.",
          "I starkt läge använder Plainphone Androids privata DNS. En VPN kan använda sin egen DNS. Koppla från den och kontrollera om filtret fungerar igen.",
        ],
      },
      {
        id: "limitations",
        title: "Något slinker förbi filtret eller låset",
        body: [
          "Inget filter fångar allt, och vissa saker kan ingen app blockera, till exempel en fabriksåterställning från återställningsläget eller chattar i meddelandeappar. Sidan med <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/limitations.md\">kända begränsningar</a> (på engelska) visar vad Plainphone inte kan blockera i dag i starkt och lätt läge.",
          "Har du hittat ett sätt förbi låset som inte finns på listan, rapportera det privat enligt <a href=\"https://github.com/plainphone/plainphone/blob/main/SECURITY.md\">SECURITY.md</a> och inte offentligt på GitHub.",
        ],
      },
    ],
    contact: "Kontakta supporten",
    contactText: "Beskriv vad du provade och vad som hände. Du kan klistra in diagnostik från Underhåll eller kontrollpanelen. Utelämna namn, kontouppgifter och andra personuppgifter.",
    statusText: "Se om Plainphone fungerar som vanligt på <a {STATUS_LINK}>statussidan</a>. Den visar appen, webbfiltret och webbplatsen.",
  },
  nb: {
    path: "/nb/help/",
    title: "Hjelp og brukerstøtte",
    topics: "Hjelpeemner",
    lead: "Få hjelp til å installere Plainphone, frigjøre en telefon eller tilbakestille den.",
    sections: [
      {
        id: "recovery",
        title: "Jeg kan ikke frigjøre eller tilbakestille telefonen",
        body: [
          "Hvis du kan åpne Vedlikehold med foreldrenes PIN-kode, kan du prøve å frigjøre telefonen i sterk modus eller slå av Plainphone i lett modus. Hvis det mislykkes eller Android blokkerer tilbakestilling fra Innstillinger, kan du prøve gjenopprettingsmodus.",
          "<strong>En tilbakestilling til fabrikkinnstillinger sletter dataene på telefonen.</strong> Sikkerhetskopier det du kan, og sjekk at du kan låse opp skjermen og logge på en Google-konto som tidligere ble synkronisert med telefonen. Android kan be om dette under oppsettet.",
          "Hvis du har lagt til en forelders Google-konto under Husstand → Beskytt mot tilbakestilling, kan Android kreve den, selv om kontoen aldri har vært brukt på telefonen. Sjekk at du kan logge på, vent til tidspunktet kontoen er klar, og sjekk på telefonens side i kontrollpanelet at den siste rapporten fra telefonen viser at tilbakestillingsbeskyttelsen er på. Kontakt brukerstøtte før du tilbakestiller telefonen hvis du er usikker på om du har tilgang til en konto som kan låse den opp.",
          { steps: [
            "Slå av telefonen. Se produsentens brukerstøtte for hvordan du starter gjenopprettingsmodus på akkurat din modell. Knappene varierer fra modell til modell.",
            "Velg <strong>Wipe data/factory reset</strong> eller tilsvarende i gjenopprettingsmenyen, og bekreft slettingen. Følg instruksjonene på skjermen.",
            "Velg <strong>Reboot system now</strong> eller tilsvarende. Følg oppsettet i Android. Fjern den gamle telefonen fra kontrollpanelet hvis den fortsatt vises. Hvis du vil bruke Plainphone igjen, installer den nyeste versjonen og koble til telefonen på nytt.",
          ] },
          '<a href="https://support.google.com/android/answer/6088915?hl=no">Googles veiledning til å forberede en tilbakestilling</a>',
        ],
      },
      {
        id: "play-protect",
        title: "Play Protect blokkerer installasjonen",
        body: [
          'Bruk <a href="/nb/setup/">den offisielle oppsettsveiledningen for Plainphone</a> og last ned appen på nytt via lenken der. La Play Protect fullføre skanningen hvis du får tilbud om det.',
          "Hvis Android fremdeles blokkerer appen eller merker den som skadelig, la Play Protect være på og kontakt brukerstøtte fra en annen enhet. Skriv hva som står på telefonen, og utelat kontoopplysninger.",
        ],
      },
      {
        id: "restricted-settings",
        title: "Android 13 eller nyere sier at en innstilling er begrenset",
        body: [
          "Åpne Innstillinger, velg Apper og deretter Plainphone. Åpne menyen med tre prikker i appinformasjonen og velg Tillat begrensede innstillinger. Bekreft hvis Android spør. Gå tilbake til Plainphone og prøv igjen.",
          "Tillat begrensede innstillinger bare for apper du stoler på. Kontakt brukerstøtte hvis menypunktet mangler.",
        ],
      },
      {
        id: "vpn",
        title: "Nettfilteret slutter å virke med et annet VPN",
        body: [
          "I lett modus bruker Plainphone Androids VPN-tilkobling til nettfilteret. Android tillater én aktiv VPN-tilkobling per profil. Koble fra den andre VPN-tilkoblingen, slå av Alltid aktivt VPN for den hvis det er på, og slå på nettfilteret igjen i Plainphone. Hvis du må beholde det andre VPN-et på, kan Plainphone bruke Androids private DNS til nettfilteret i stedet. I dashbordet eller foreldreappen åpner du telefonens Nettfilter og slår på Privat DNS. Ved første oppsett velger du det når Plainphone spør om et annet VPN.",
          "I sterk modus bruker Plainphone Androids private DNS. En VPN-tjeneste kan bruke sin egen DNS. Koble fra VPN-tjenesten for å se om filteret fungerer igjen.",
        ],
      },
      {
        id: "limitations",
        title: "Noe slipper forbi filteret eller låsen",
        body: [
          "Ikke noe filter fanger alt, og noen ting kan ingen app blokkere, for eksempel en tilbakestilling fra gjenopprettingsmodus eller chatter i meldingsapper. Siden med <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/limitations.md\">kjente begrensninger</a> (på engelsk) viser hva Plainphone ikke kan blokkere i dag i sterk og lett modus.",
          "Har du funnet en vei rundt låsen som ikke står på listen, rapporter den privat som beskrevet i <a href=\"https://github.com/plainphone/plainphone/blob/main/SECURITY.md\">SECURITY.md</a> og ikke offentlig på GitHub.",
        ],
      },
    ],
    contact: "Kontakt brukerstøtte",
    contactText: "Beskriv hva du prøvde og hva som skjedde. Du kan lime inn diagnostikk fra Vedlikehold eller kontrollpanelet. Utelat navn, kontoopplysninger og andre personopplysninger.",
    statusText: "Se om Plainphone kjører som normalt på <a {STATUS_LINK}>statussiden</a>. Den viser appen, nettfilteret og nettsiden.",
  },
  de: {
    path: "/de/help/",
    title: "Hilfe und Support",
    topics: "Hilfethemen",
    lead: "Hier finden Sie Hilfe beim Installieren von Plainphone sowie beim Freigeben oder Zurücksetzen eines Handys.",
    sections: [
      {
        id: "recovery",
        title: "Ich kann das Handy nicht freigeben oder auf Werkseinstellungen zurücksetzen",
        body: [
          "Wenn Sie die Wartung mit der Eltern-PIN öffnen können, versuchen Sie im starken Modus, das Handy freizugeben, oder schalten Sie Plainphone im leichten Modus aus. Falls das fehlschlägt oder Android das Zurücksetzen über die Einstellungen blockiert, können Sie den Wiederherstellungsmodus versuchen.",
          "<strong>Beim Zurücksetzen auf Werkseinstellungen werden die Daten auf dem Handy gelöscht.</strong> Sichern Sie, was Sie können, und prüfen Sie, ob Sie den Bildschirm entsperren und sich bei einem Google-Konto anmelden können, das zuvor mit dem Handy synchronisiert wurde. Android kann bei der Einrichtung danach fragen.",
          "Wenn Sie unter Haushalt → Vor dem Zurücksetzen schützen ein Google-Konto eines Elternteils hinterlegt haben, kann Android dieses Konto verlangen, auch wenn es auf dem Handy nie verwendet wurde. Prüfen Sie, ob Sie sich anmelden können, warten Sie bis zum angezeigten Zeitpunkt und sehen Sie auf der Geräteseite im Dashboard nach, ob der letzte Bericht des Handys zeigt, dass der Schutz vor dem Zurücksetzen aktiv ist. Wenden Sie sich vor dem Zurücksetzen an den Support, wenn Sie sich beim Zugriff auf ein zum Entsperren geeignetes Konto unsicher sind.",
          { steps: [
            "Schalten Sie das Handy aus. Sehen Sie auf der Supportseite des Herstellers nach, wie Sie den Wiederherstellungsmodus für Ihr Modell starten. Die Tasten hängen vom Modell ab.",
            "Wählen Sie im Wiederherstellungsmenü <strong>Wipe data/factory reset</strong> oder die entsprechende Option und bestätigen Sie das Löschen. Folgen Sie den Anweisungen auf dem Bildschirm.",
            "Wählen Sie <strong>Reboot system now</strong> oder die entsprechende Option. Folgen Sie der Android-Einrichtung. Entfernen Sie das alte Handy aus dem Dashboard, falls es dort noch angezeigt wird. Wenn Sie Plainphone wieder verwenden möchten, installieren Sie die aktuelle Version und koppeln Sie das Handy erneut.",
          ] },
          '<a href="https://support.google.com/android/answer/6088915?hl=de">Googles Anleitung zur Vorbereitung auf das Zurücksetzen</a>',
        ],
      },
      {
        id: "play-protect",
        title: "Play Protect blockiert die Installation",
        body: [
          'Verwenden Sie die <a href="/de/setup/">offizielle Einrichtungsanleitung für Plainphone</a> und laden Sie die App über den dortigen Link erneut herunter. Wenn Play Protect anbietet, die App zu prüfen, warten Sie den Abschluss der Prüfung ab.',
          "Wenn Android die App weiterhin blockiert oder als schädlich einstuft, lassen Sie Play Protect eingeschaltet und kontaktieren Sie den Support von einem anderen Gerät. Geben Sie den Wortlaut der Meldung wieder und lassen Sie Kontodaten weg.",
        ],
      },
      {
        id: "restricted-settings",
        title: "Android 13 oder neuer meldet, dass eine Einstellung eingeschränkt ist",
        body: [
          "Öffnen Sie die Einstellungen, wählen Sie Apps und dann Plainphone. Öffnen Sie in der App-Info das Dreipunkt-Menü und wählen Sie Eingeschränkte Einstellungen zulassen. Bestätigen Sie die Rückfrage von Android, falls sie erscheint. Kehren Sie zu Plainphone zurück und versuchen Sie es erneut.",
          "Erlauben Sie eingeschränkte Einstellungen nur für Apps, denen Sie vertrauen. Wenn der Menüpunkt fehlt, wenden Sie sich an den Support.",
        ],
      },
      {
        id: "vpn",
        title: "Der Webfilter funktioniert mit einem anderen VPN nicht mehr",
        body: [
          "Im leichten Modus nutzt der Webfilter die VPN-Verbindung von Android. Android erlaubt ein aktives VPN pro Profil. Trennen Sie das andere VPN, deaktivieren Sie dafür die Option Durchgehend aktives VPN, falls sie eingeschaltet ist, und schalten Sie den Webfilter in Plainphone wieder ein. Muss das andere VPN eingeschaltet bleiben, kann Plainphone stattdessen das private DNS von Android für den Webfilter verwenden. Im Dashboard oder in der Eltern-App öffnen Sie den Webfilter des Telefons und schalten Privates DNS ein. Bei der ersten Einrichtung wählen Sie es, wenn Plainphone nach einem anderen VPN fragt.",
          "Im starken Modus verwendet Plainphone die Funktion Privates DNS von Android. Ein VPN kann einen eigenen DNS-Dienst verwenden. Trennen Sie es, um zu prüfen, ob der Filter wieder funktioniert.",
        ],
      },
      {
        id: "limitations",
        title: "Etwas kommt am Filter oder an der Sperre vorbei",
        body: [
          "Kein Filter erkennt alles, und manches kann keine App blockieren, zum Beispiel ein Zurücksetzen auf Werkseinstellungen im Wiederherstellungsmodus oder Chats in Messenger-Apps. Die <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/limitations.md\">bekannten Einschränkungen</a> (auf Englisch) zeigen, was Plainphone heute im starken und im leichten Modus nicht blockieren kann.",
          "Wenn Sie einen Weg um die Sperre gefunden haben, der nicht auf der Liste steht, melden Sie ihn bitte vertraulich wie in <a href=\"https://github.com/plainphone/plainphone/blob/main/SECURITY.md\">SECURITY.md</a> beschrieben und nicht öffentlich auf GitHub.",
        ],
      },
    ],
    contact: "Support kontaktieren",
    contactText: "Beschreiben Sie, was Sie versucht haben und was passiert ist. Sie können Diagnosedaten aus der Wartung oder dem Dashboard einfügen. Lassen Sie Namen, Kontodaten und andere personenbezogene Daten weg.",
    statusText: "Auf der <a {STATUS_LINK}>Statusseite</a> sehen Sie, ob Plainphone normal läuft. Sie zeigt die App, den Webfilter und die Website.",
  },
};
