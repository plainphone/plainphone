// SPDX-License-Identifier: Apache-2.0
// Machine-translated copy. Needs native review. Strings may contain trusted inline HTML (links, <em>).
export default {
  lang: "de",
  path: "/de/",
  title: "Plainphone | Kindersicherung für das erste Android-Handy",
  description: "Richten Sie ein Android-Handy für Ihr Kind oder als einfaches Handy für sich selbst ein. Behalten Sie Anrufe und wichtige Apps und wählen Sie, welche Apps und Webseiten Sie begrenzen.",
  ogAlt: "Plainphone: Ihr Telefon ohne Ablenkung. Anrufe, SMS und Kamera sind an, soziale Medien und der App-Store sind aus.",
  landing: {
    setup: "Einrichtung",
    faq: "Fragen",
    menu: "Menü",
    start: "Loslegen",
    guide: "So richten Sie es ein",
    code: "Quellcode ansehen",
    security: "Sicherheit",
    help: "Produkt und Hilfe",
    project: "Projekt",
    languages: "Sprachen",
    day: ["Der erste Tag mit Plainphone", "Wählen Sie im Elternbereich den starken oder den leichten Modus.", "Wählen Sie, wer das Handy benutzt.", "Folgen Sie der Anleitung und verbinden Sie das Handy.", "Vereinbaren Sie die Regeln gemeinsam und probieren Sie einen Anruf und die Apps aus, die Sie brauchen."],
    childSees: "Auf dem Handy sieht Ihr Kind, welche Apps verfügbar sind und wie viel Zeit für Apps mit einem Zeitlimit übrig ist. Das Handy meldet, wenn die Zeit abgelaufen ist, und zeigt eine Benachrichtigung an, wenn es seinen Standort sendet.",
    privacyNote: "Diese Website verwendet keine Cookies, keine Besuchsstatistik, kein Tracking und keine Anfragen an Drittanbieter.",
    status: "Status",
    groups: {
      gettingStarted: "Einstieg",
      safety: "Sicherheit",
      privacy: "Datenschutz",
      price: "Preis",
      technical: "Technik",
      selfHosting: "Eigener Server",
    },
    questions: [
      ["gettingStarted", "Welche Handys funktionieren?", "Sie brauchen Android 10 oder neuer. In der Anleitung stehen das getestete Modell und die Einschränkungen für Ihre Android-Version."],
      ["gettingStarted", "Kann ich Schul-Apps, Aula, MitID oder BankID behalten?", "Sie können benötigte Apps erlauben. Aula und MitID stehen im dänischen App-Katalog. Probieren Sie die Anmeldung und andere wichtige Funktionen auf dem konkreten Gerät aus, auch wenn Sie BankID brauchen."],
      ["gettingStarted", "Kann ich aus meinem Smartphone ein einfaches Handy machen?", "Ja. Behalten Sie Anrufe, SMS und die Apps, die Sie brauchen. Lassen Sie ablenkende Apps von der Liste weg. Wählen Sie Für mich selbst für Ihr eigenes Handy."],
      ["safety", "Was mache ich, wenn das Handy verloren geht?", "Wenn die Ortung aktiv ist, können Sie den Standort anfragen. Das Handy braucht eine Verbindung, um einen neuen Standort zu senden. Der Zeitstempel zeigt die letzte Aktualisierung."],
      ["safety", "Kann mein Kind weiter 112 anrufen?", "Ja. Plainphone erlaubt Anrufe an 112 immer. Android stellt den Notruf her."],
      ["safety", "Was ist, wenn ich es mir anders überlege?", "Geben Sie das Handy im Elternbereich frei und warten Sie, bis es online bestätigt. Dann können Sie Plainphone deinstallieren oder das Handy in Android zurücksetzen. Sichern Sie vorher Ihre Dateien."],
      ["privacy", "Welche Daten speichern Sie und wie lange?", "Kontodaten und Handyregeln bleiben gespeichert, solange Sie den Dienst nutzen. Entschiedene Anfragen bleiben normalerweise 30 Tage gespeichert. Wir behalten 30 nächtliche Sicherungen der Datenbank. Bei aktivierter Ortung speichern wir nur den letzten Standort. Die vollständige Liste steht in der Datenschutzerklärung."],
      ["privacy", "Wie lösche ich meine Daten?", "Wählen Sie in den Einstellungen Mein Konto löschen. In einem geteilten Haushalt bleiben Handys und Regeln für die übrigen Mitglieder erhalten. Wenn Sie das einzige Mitglied eines Haushalts mit einem Handy mit dem Profil Für mich selbst sind, entfernen Sie dieses Handy zuerst mit seinem Schlüssel. Die Datenschutzerklärung erklärt, wann Sicherungskopien ablaufen."],
      ["privacy", "Wer steckt hinter Plainphone?", "Mahoje in Dänemark (CVR 39413892) pflegt das Projekt und betreibt den Dienst. Der Quellcode ist öffentlich."],
      ["technical", "Wie wirkt sich Plainphone auf den Akku aus?", "Das Handy synchronisiert im Hintergrund. Webfilter und Ortung können ebenfalls Strom verbrauchen. Zur Akkulaufzeit gibt es keine Messwerte. Bei manchen Geräten müssen Sie die Akku-Einstellungen für eine zuverlässige Synchronisation anpassen."],
      ["technical", "Gelten die Regeln ohne Internet?", "Das Handy behält die zuletzt erhaltenen Regeln bei. Für Änderungen oder einen neuen Standort braucht es eine Verbindung."],
      ["selfHosting", "Kann ich Plainphone selbst betreiben?", "Ja. Die Anleitung erklärt Docker, PostgreSQL, HTTPS und E-Mail für die Anmeldung. Für den Webfilter brauchen Sie einen separaten DNS-Dienst."],
    ],
  },
  skip: "Zum Inhalt springen",
  nav: { label: "Hauptnavigation", source: "Quellcode", language: "Sprache" },
  status: "Frühe Version zum Ausprobieren.",
  compatibility: {
    path: "/de/apps/",
    title: "Funktioniert meine App mit Plainphone?",
    lead: "Finden Sie Android-Apps und sehen Sie nach, welche Websites der Webfilter standardmäßig blockiert.",
    label: "App oder Website",
    hint: "Versuchen Sie es mit MitID oder youtube.com. Sie können auch Paketnamen eingeben oder Links einfügen.",
    catalog: "Apps im Katalog",
    websites: "Bekannte Websites",
    noApps: "Keine passende App im Katalog gefunden. Sie können weiterhin andere Android-Apps auf dem Telefon zulassen.",
    noWebsites: "Keine passende bekannte Website gefunden. Die Standardeinstellung des Filters für diese Website ist daher unbekannt.",
    limits: "Der Katalog hilft Ihnen, Apps zu finden und hinzuzufügen. Eine App kann mehrere Domains verwenden. Die Liste enthält ausgewählte Websites. Welche Seiten sich öffnen lassen, hängt von den Einstellungen des Telefons und den aktuellen Filterlisten ab.",
    filters: {
      social: "Soziale Medien · auf beiden Telefontypen standardmäßig blockiert.",
      adult: "Inhalte für Erwachsene · auf beiden Telefontypen standardmäßig blockiert.",
      gambling: "Glücksspiel · auf beiden Telefontypen standardmäßig blockiert.",
      games: "Spiele · auf beiden Telefontypen standardmäßig blockiert.",
      dating: "Dating · auf beiden Telefontypen standardmäßig blockiert.",
      video: "Videos · auf beiden Telefontypen standardmäßig blockiert.",
      tracking: "Werbung und Tracking · auf beiden Telefontypen standardmäßig blockiert.",
      youtube: "Videos · auf Kindertelefonen standardmäßig streng eingeschränkter Modus, auf selbst verwalteten Telefonen moderat eingeschränkter Modus.",
      help: "Gesundheitsinformationen · bleiben mit dem Webfilter immer zugänglich.",
    },
  },
  hero: {
    title: "Ihr Telefon ohne Ablenkung.",
    lead: "Mit Plainphone wird ein Android-Handy zum Telefon für Anrufe, SMS und die Apps, die Sie auswählen.",
  },
  who: {
    title: "Für wen ist Plainphone gedacht?",
    paths: [
      {
        id: "child",
        title: "Für mein Kind",
        body: "Wählen Sie gemeinsam Apps und erlaubte Kontakte aus. Geben Sie Ihrem Kind mehr Freiraum, wenn es älter wird.",
      },
      {
        id: "self",
        title: "Für mich selbst",
        body: "Lassen Sie Lockerungen erst nach einer Wartezeit gelten oder bitten Sie eine Vertrauensperson um Zustimmung, etwa per QR-Code. Während Sie warten, können Sie die Änderung zurücknehmen.",
      },
    ],
  },
  how: {
    title: "So funktioniert es",
    lead: "Sie brauchen Android 10 oder neuer. Wählen Sie eine passende Einrichtung für Ihr Handy.",
    steps: [
      {
        title: "Starker Modus",
        body: "Beginnen Sie mit einem neuen oder zurückgesetzten Handy, damit sich die Regeln schwerer umgehen lassen.",
      },
      {
        title: "Leichter Modus",
        body: "Behalten Sie Ihre Einrichtung und beschränken Sie den Zugriff auf Apps mit einem leichteren Schutz.",
      },
    ],
    guide: "Einrichtungsanleitung öffnen",
    available: "Sie können bereits erlaubte Kontakte auswählen, Websites nach Kategorien filtern und den Verlauf für SMS, Anrufe und Kontakte aktivieren. Die Filteradresse des Handys lässt sich auch auf einem Router oder mit einem VPN nutzen. Das Handy kann sich selbst aktualisieren und der Server kann Sicherungskopien erstellen.",
    note: "SOS: Ihr Kind kann eine Taste gedrückt halten, um einen dringenden SOS-Ruf oder eine Hilfeanfrage zu senden. Die Eltern erhalten den Standort, wenn die Standortfreigabe aktiviert ist. Ist das Handy offline, kann stattdessen eine SMS gesendet werden. Die 112 ist auf demselben Bildschirm.",
  },
  open: {
    title: "Offener Quellcode",
    body: "Der Quellcode von Plainphone ist unter der Apache-2.0-Lizenz öffentlich zugänglich.",
    github: "Quellcode auf GitHub ansehen",
    issues: "Einen Fehler öffentlich melden oder eine Änderung vorschlagen",
    privateReport: "Ein Sicherheits- oder Datenschutzproblem vertraulich melden",
    contribute: "Anleitung zum Mitmachen lesen",
  },
  hosting: {
    title: "Plainphone auf dem eigenen Server betreiben",
    body: "Sie brauchen Docker mit PostgreSQL, eine HTTPS-Adresse und SMTP für Anmelde-E-Mails. Das Android-Handy verbindet sich bei der Einrichtung mit Ihrem Server. Öffnen Sie die Elternoberfläche unter Ihrer eigenen Adresse oder bauen Sie die Eltern-App mit dieser Adresse. Der Webfilter braucht einen eigenen DNS-Dienst.",
    guide: "Anleitung für den eigenen Server lesen",
  },
  price: {
    title: "Preis",
    body: "Plainphone ist derzeit kostenlos. Der Betrieb auf dem eigenen Server und ein Handy mit vollem Schutz bei unserem Dienst bleiben immer kostenlos. Für weitere Handys bei unserem Dienst werden wir später eine Gebühr erheben. Wer früh dabei ist, wird rechtzeitig informiert.",
    items: [
      {
        q: "Was kostet Plainphone?",
        a: "Derzeit ist es kostenlos. Später kosten nur zusätzliche Handys bei unserem Dienst Geld.",
      },
      {
        q: "Was bleibt immer kostenlos?",
        a: "Der Betrieb auf Ihrem eigenen Server und ein Handy mit vollem Schutz bei unserem Dienst.",
      },
      {
        q: "Was gilt beim Betrieb auf meinem eigenen Server?",
        a: "Plainphone erhebt dafür keine Gebühr. Sie tragen die Kosten für Ihren Server und die Dienste, die Sie nutzen.",
      },
    ],
  },
  privacySummary: {
    title: "Datenschutz",
    body: "Diese Website verwendet weder Cookies noch Besuchsanalysen. Plainphone zeigt keine Werbung und verkauft Ihre Daten nie.",
    link: "Datenschutzerklärung lesen",
  },
  phones: {
    title: "Getestete Telefone",
    body:
      "Eines bisher: ein OnePlus 5T auf Android 10. Einrichtung, Sperre und Verbindung zum Dashboard funktionieren, wie der <a href=\"/de/setup/#tested\">Setup-Guide</a> zeigt. Es hat unsere <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/bypass-checklist.md\">Bypass-Checkliste</a> auf echter Hardware noch nicht durchlaufen und ein Telefon gilt erst dann als vollständig getestet, wenn es alle Tests auf dieser Liste bestanden hat. Bis dahin betrachten Sie Plainphone bitte als Experiment.",
  },
  faq: {
    title: "Fragen",
    items: [
      {
        group: "gettingStarted",
        q: "Funktioniert es auf dem iPhone?",
        a: "Plainphone schützt das Android-Handy des Kindes. Die Eltern-App für iPhone ist in Entwicklung. Der Elternbereich ist bereits in Safari verfügbar.",
      },
      {
        group: "safety",
        q: "Kann es umgangen werden?",
        a: "Der starke Modus schützt Android-Einstellungen und erschwert die Installation von Apps. Der leichte Modus verwendet Berechtigungen, die sich entfernen lassen. Er lässt sich daher leichter abschalten. Probiere die Einrichtung auf eurem eigenen Handy aus. Ein Zurücksetzen auf Werkseinstellungen außerhalb der Android-Einstellungen kann das Handy weiterhin löschen und Plainphone entfernen. Wenn der Schutz vor Zurücksetzen auf dem Handy eingerichtet ist und funktioniert, kann die Einrichtung das verknüpfte Google-Konto der Eltern verlangen, bevor das Handy wieder benutzt werden kann.",
      },
      {
        group: "safety",
        q: "Was ist mit WhatsApp, Snapchat und anderen Chat-Apps?",
        a: "Chat-Apps bleiben verborgen, es sei denn, Sie erlauben dies, und genehmigte Kontakte decken Anrufe und Textnachrichten ab, nicht aber das, was in diesen Apps passiert. Wenn sich eine ganze Klasse in einer App befindet, kann die Software das Problem nicht beheben. Das Gespräch mit den anderen Eltern reicht oft aus.",
      },
    ],
  },
  why: {
    path: "/de/why/",
    h1: "Warum Plainphone so funktioniert, wie es funktioniert",
    lead: "Plainphone ist für Familien gedacht, die möchten, dass ihr Kind ein Telefon hat, während es darauf wartet, ihm ein vollwertiges Smartphone zu geben. Forschung hilft uns bei der Entscheidung, was wir bauen wollen.",
    sections: [
      ["Schlafenszeit", "Ein Telefon im Schlafzimmer führt bei Kindern und Jugendlichen zu schlechterem Schlaf. Der Schlafenszeitplan von Plainphone schränkt die verfügbaren Apps ein, und das Telefon bleibt still: Nur Eltern, 112 und Hilfetelefone klingeln. Das lässt sich ausschalten. Die dänische Gesundheitsbehörde empfiehlt, das Telefon außerhalb des Schlafzimmers zu lassen."],
      ["Was uns die Forschung sagen kann", "Große Studien finden kleine durchschnittliche Zusammenhänge zwischen Technologienutzung und Wohlbefinden. Eine Untersuchung der National Academies ergab zu wenig Beweise, um einen kausalen Effekt von sozialen Medien auf die Gesundheit von Jugendlichen in der gesamten Bevölkerung nachzuweisen. Wir wissen nicht, ob ein eingeschränktes Telefon wie Plainphone das Wohlbefinden verbessert. Die dänische Wohlfahrtskommission empfiehlt, mit dem Erwerb eines eigenen Smartphones oder Tablets bis zum Alter von 13 Jahren zu warten."],
      ["Schulzeit", "Sie entscheiden, wann der Zeitplan ausgeführt wird und welche Apps verfügbar sind. Die Forschung zu Telefonregeln in der Schule ist gemischt und wir wissen nicht, ob ein solcher Zeitplan das Wohlbefinden verbessert."],
      ["Webfilterung", "Wenn der Filter konfiguriert ist, blockiert er Anfragen an Webadressen in den von Ihnen ausgewählten Kategorien. Dadurch kann die Exposition etwas verringert werden, und Studien haben kaum Belege dafür gefunden, dass Filter die Häufigkeit, mit der Teenager auf sexuelles Material stoßen, beeinflussen. Filter können auch nützliche Gesundheitsinformationen blockieren. Sprechen Sie mit Ihrem Kind darüber, was ihm begegnen könnte."],
      ["Privatsphäre, Hilfe und wachsende Unabhängigkeit", "Kinder sollten in der Lage sein, die Regeln zu verstehen, zu sehen, wann ihr Standort geteilt wird, und privat Hilfe zu erreichen. Wir verwenden diese Prinzipien bei der Entwicklung von Plainphone. Gehen Sie die Regeln gemeinsam noch einmal durch, während Ihr Kind wächst."],
      ["Für Erwachsene", "In einer kurzen Untersuchung einer anderen App gaben eine Pause und die Möglichkeit zum Abbrechen den Leuten die Möglichkeit, ihre Meinung über das Öffnen einer App zu ändern. Im Verlauf der Studie stornierten die Teilnehmer seltener. Das ist ein Grund, das Abbrechen bei der Gestaltung einer Pause zu vereinfachen."],
    ],
    sourcesTitle: "Quellen",
    sources: [
      ["Carter et al. auf Geräten und Schlaf", "https://doi.org/10.1001/jamapediatrics.2016.2341"],
      ["Ratschläge der dänischen Gesundheitsbehörde zur Bildschirmnutzung", "https://www.sst.dk/vidensbase/forebyggelse/anbefalinger-om-brug-af-skaerm"],
      ["Empfehlungen der Dänischen Wohlfahrtskommission", "https://regeringen.dk/aktuelt/nyheder/2025/trivselskommissionens-anbefalinger-er-klar/"],
      ["Überprüfung der National Academies zu sozialen Medien und der Gesundheit von Jugendlichen", "https://www.nationalacademies.org/read/27396/chapter/2"],
      ["Orben und Przybylski über digitale Technologie und Wohlbefinden", "https://www.nature.com/articles/s41562-018-0506-1"],
      ["Goodyear et al. zu den Telefonrichtlinien der Schule", "https://doi.org/10.1016/j.lanepe.2025.101211"],
      ["Przybylski und Nash über Internetfilterung", "https://pubmed.ncbi.nlm.nih.gov/29995533/"],
      ["Richardson et al. zu Filtern und Zugang zu Gesundheitsinformationen", "https://doi.org/10.1001/jama.288.22.2887"],
      ["Leitlinien der Europäischen Kommission zu Minderjährigen", "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A52025XC05519"],
      ["UN-Ausschuss für die Rechte des Kindes, Allgemeiner Kommentar Nr. 25", "https://www.ohchr.org/en/documents/general-comments-and-recommendations/general-comment-no-25-2021-childrens-rights-relation"],
      ["Grüning et al. auf der One-Second-App", "https://www.pnas.org/doi/10.1073/pnas.2213114120"],
    ],
  },
  privacy: {
    path: "/de/privacy/",
    title: "Datenschutzerklärung: Plainphone",
    description:
      "Was Plainphone über Sie und die von Ihnen verwalteten Telefone speichert, wie lange, wer sonst noch beteiligt ist und wie Sie uns bitten können, die Daten zu korrigieren oder zu löschen.",
    h1: "Datenschutzerklärung",
    updated: "Zuletzt aktualisiert am 20. November 2026",
    lead:
      "Plainphone behält so wenig wie möglich und so kurz wie möglich. Auf dieser Seite erfahren Sie, was das in der Praxis bedeutet. Es ist geschrieben, um gelesen zu werden, und nicht, um Dinge zu verbergen.",
    status:
      "Plainphone ist früh. Die Eltern-App, der Server, der Webfilter und die Plainphone-App auf dem Telefon funktionieren alle zusammen, aber es ist noch nicht bereit für den täglichen Gebrauch. Wenn sich ändert, was Plainphone speichert, ändert sich zuerst diese Seite.",
    tocLabel: "Auf dieser Seite",
    short: {
      title: "Die Kurzversion",
      list: [
        "Diese Website setzt keine Cookies, führt keine Analysen durch und lädt nichts von anderen Websites.",
        "Die Eltern-App speichert Ihre E-Mail-Adresse und die Regeln, die Sie für jedes Telefon festlegen. Wenn ein Telefon entfernt wird, werden alle darauf gespeicherten Daten gelöscht.",
        "Wenn die Funktion „Standort“ aktiviert ist, wird nur die letzte bekannte Position des Telefons angezeigt. Wir speichern keinen Verlauf.",
        "Der Webfilter führt keine Liste der Websites, die ein Telefon besucht.",
        "Wir verkaufen keine Daten, schalten keine Werbung und erstellen keine Profile.",
      ],
    },
    sections: [
      {
        id: "controller",
        title: "Wer ist verantwortlich?",
        body: [
          "Plainphone ist ein Open-Source-Projekt, das von <a href=\"https://mahoje.dk\">Mahoje</a> in Dänemark verwaltet wird. Wir sind für die Daten im gehosteten Dienst verantwortlich: die übergeordnete App unter app.plainphone.org und den Webfilter unter dns.plainphone.org.",
          "Für alles rund um Ihre Daten, etwa eine Kopie davon oder deren Löschung, schreiben Sie an <a href=\"mailto:privacy@plainphone.org\">privacy@plainphone.org</a>. Bei Fragen, die nicht persönlicher Natur sind, können Sie auch ein Problem unter <a href=\"https://github.com/plainphone/plainphone/issues\">github.com/plainphone/plainphone/issues</a> eröffnen. Da die Probleme jedoch öffentlich sind, halten Sie persönliche Daten wie Ihre E-Mail-Adresse fern. Sicherheitsprobleme durchlaufen das in <a href=\"https://github.com/plainphone/plainphone/blob/main/SECURITY.md\">SECURITY.md</a> beschriebene private Meldeformular.",
        ],
      },
      {
        id: "why",
        title: "Warum wir Ihre Daten verwenden",
        body: [
          "Wir verwenden es, um Plainphone für Sie auszuführen: um Sie anzumelden, um die von Ihnen festgelegten Regeln auf die von Ihnen verwalteten Telefone anzuwenden und um den Dienst funktionsfähig und sicher zu halten. Rechtsgrundlage ist die Vereinbarung zwischen Ihnen und dem Dienst (Artikel 6 Absatz 1 Buchstabe b DSGVO) und unser berechtigtes Interesse an der Sicherheit und der Unterbindung von Missbrauch (Artikel 6 Absatz 1 Buchstabe f). Bei jemandem, der von einer anderen Person eingeladen wird, handelt es sich um die Anfrage dieser Person und unser Interesse an der Übermittlung dieser Anfrage (Artikel 6 Absatz 1 Buchstabe f). Wir verwenden die Daten für keinen anderen Zweck.",
        ],
      },
      {
        id: "account",
        title: "Ihr Konto",
        body: [
          "Sie melden sich mit Ihrer E-Mail-Adresse und einem Link an, den wir Ihnen senden. Es gibt kein Passwort. Wir speichern:",
          {
            list: [
              "Ihre E-Mail-Adresse und Ihre Sprache (Englisch oder Dänisch)",
              "den von Ihnen angeforderten Anmeldelink: Ihre E-Mail-Adresse, eine Ablaufzeit und einen Hash des Links. Sie wird etwa einen Tag nach Ablauf gelöscht, auch wenn für diese Adresse kein Konto vorhanden ist",
              "Ihre Sitzung: ein Hash des Schlüssels, den Ihr Browser speichert, und wann diese endet (höchstens 60 Tage oder wenn Sie sich abmelden). Wir speichern weder Ihre IP-Adresse noch Ihr Gerät",
              "Ihr Haushalt: sein Name, wer darin ist und die Einladungen, die Sie gesendet haben, mit der eingeladenen E-Mail-Adresse und dem Ablaufdatum. Eine Einladung wird gelöscht, wenn sie angenommen wird, und einen Tag nach Ablauf",
            ],
          },
          "Jeder in einem Haushalt kann die E-Mail-Adressen der anderen sehen und alle ihre Telefone verwalten. Anmeldelinks, Sitzungen und die von Telefonen verwendeten Schlüssel werden als Hashes gespeichert.",
        ],
      },
      {
        id: "phones",
        title: "Telefone und Regeln",
        body: [
          "Ein Elternteil oder ein Erwachsener für sein eigenes Telefon fügt ein Telefon hinzu, indem er den angezeigten Code eingibt. Kinder erhalten kein Konto und werden nie nach einer E-Mail-Adresse gefragt. Für jedes Telefon speichern wir, was der Erwachsene einrichtet:",
          {
            list: [
              "die in Plainphone auf dem Telefon verwendete Sprache, sofern die erwachsene Person eine ausgewählt hat",
              "den Namen, den der Erwachsene dem Telefon gibt, ob es sich um das Telefon eines Kindes oder eines Erwachsenen handelt, seine Zeitzone und wann es zuletzt den Server kontaktiert hat",
              "Ein paar kurze Fakten, die das Telefon beim Koppeln meldet, etwa sein Modell und seine Android-Version sowie seinen aktuellen Status: Akkustand, App-Version, ob die Sperre intakt ist und welche Webfilteradresse es verwendet. Jeder Bericht ersetzt den vorherigen",
              "Wenn Sie den Schutz vor Zurücksetzen aktivieren, behält Ihr Haushalt Ihre numerische Google-Konto-ID und den Zeitpunkt der Verknüpfung. Trennen Sie es in den Haushaltseinstellungen, um es zu löschen, oder löschen Sie Ihr Plainphone-Konto. Für diese Funktion speichern wir weder Ihre Google-E-Mail-Adresse noch Ihre Anmeldetokens",
              "bei einem Telefon im starken Modus die letzte Systemprüfung, einschließlich der Frage, ob der Bootloader gesperrt ist, der Sicherheitspatch-Stufe und der Prüfzeit. Jede Prüfung ersetzt die vorherige, und durch das Entfernen des Telefons wird es gelöscht. Wir behalten die Zertifikatskette nicht bei",
              "die Apps auf dem Telefon (Name und Paketname) und welche davon erlaubt sind",
              "Genehmigte Kontakte: die Namen und Nummern, die ein Elternteil in die Eltern-App eingibt. Der Server speichert nichts anderes von den Kontakten des Telefons",
              "Webfiltereinstellungen: Welche Kategorien blockiert werden und welche Domänen das übergeordnete Element zulässt oder blockiert",
              "Schul- und Schlafenszeit sowie die während dieser Zeit erlaubten Apps",
              "auf dem eigenen Telefon eines Erwachsenen: die Einstellungen des Schlüssels (eine Verzögerung oder die E-Mail-Adresse einer vertrauenswürdigen Person) und die Änderungen, die auf den Schlüssel warten. Eine angewendete, stornierte oder abgelehnte Änderung wird 30 Tage lang aufbewahrt und dann gelöscht",
              "Anfragen, die das Telefon sendet: eine App aus seiner eigenen Liste oder ein Kontakt (Name und Nummer), den jemand auf dem Telefon hinzufügen möchte. Jede Anfrage wird aufbewahrt, solange sie offen ist, und 30 Tage lang, nachdem ein Elternteil sie genehmigt oder abgelehnt hat",
              "Nach wie vielen Stunden der Stille gilt das Telefon als still (eine Einstellung pro Telefon, die von den Eltern gemeinsam genutzt wird) und für jeden Elternteil, ob er darüber benachrichtigt werden möchte",
            ],
          },
          "Eine von Ihnen benannte Vertrauensperson erhält eine E-Mail. Sobald sie angemeldet sind, können sie den Namen des Telefons, die Anfrage und Ihre E-Mail-Adresse sehen.",
        ],
      },
      {
        id: "children",
        title: "Kinder",
        body: [
          "Kinder erstellen keine Konten. Ein Elternteil tut dies und der Elternteil entscheidet, was über das Telefon des Kindes gespeichert wird. Wir erfassen wissentlich keine Daten direkt von Kindern, zeigen keine Werbung und erstellen keine Profile von Kindern. Die sensibelsten Daten über das Telefon eines Kindes sind sein letzter bekannter Standort und die Liste der genehmigten Kontakte. Wir empfehlen Ihnen, Ihrem Kind zu sagen, was das Telefon teilt und warum.",
        ],
      },
      {
        id: "location",
        title: "Standort",
        body: [
          "Der Standort ist eine Einstellung für jedes Telefon mit vier Auswahlmöglichkeiten: Aus; nur wenn ein Elternteil auf „Suchen“ klickt; auf „Suchen“ und wenn ein „Geht es dir gut?“ angezeigt wird. bleibt unbeantwortet; oder immer eingeschaltet, alle fünf Minuten, für eine vom Elternteil ausgewählte Zeit (eine Stunde, heute oder eine Woche), danach geht es zurück zu „Suchen“ und „Geht es dir gut?“ allein. Das Telefon eines Kindes beginnt mit „Suchen“ und „Geht es dir gut?“ und ist nicht immer eingeschaltet. Das eigene Telefon eines Erwachsenen startet mit ausgeschalteter Standortbestimmung, und das Einschalten ist die Entscheidung des Besitzers. Ein Elternteil kann es jederzeit ändern.",
          "Das Telefon ist darüber offen. Jedes Mal, wenn eine einzelne Position gesendet wird (Suchen oder ein unbeantwortetes „Geht es dir gut?“), wird eine kurze Mitteilung darüber angezeigt. Wenn der Standort immer aktiviert ist, zeigt das Telefon dies ständig in einer Benachrichtigung und auf dem Display von Plainphone an. Das Kind kann „Was können meine Eltern sehen?“ öffnen. am Telefon: Es erklärt die aktuelle Einstellung und listet jedes Mal auf, wann die Position in den letzten 30 Tagen gesendet wurde. Diese Liste bleibt auf dem Telefon.",
          "\"Geht es dir gut?\" fordert das Kind auf, innerhalb einer von den Eltern festgelegten Zeitspanne zu antworten. Wenn das Kind antwortet, wird keine Position gesendet. Wenn niemand rechtzeitig antwortet, sendet das Telefon eine Position. „Telefon klingeln“ ertönt einen Alarmton und vibriert höchstens fünf Minuten lang; es sendet keine Position. Der Server speichert einen Klingelton oder eine Frage (Zeiten und Antwort sowie die genehmigte Nummer für „Ruf mich an“) noch einen Tag lang, nachdem er beendet ist, und löscht ihn dann.",
          "Der Server speichert nur die aktuelle Position: Koordinaten, Genauigkeit und Zeit. Jede neue Position ersetzt die alte und es wird kein Verlauf gespeichert. Durch das Ausschalten der Standortbestimmung oder das Entfernen des Telefons wird die gespeicherte Position gelöscht.",
          "Das Dashboard zeigt die Position auf einer Karte an. Die Kartenkacheln stammen von OpenFreeMap (tiles.openfreemap.org, OpenStreetMap-Daten). Durch das Laden dieser Karten erfahren OpenFreeMap ungefähr, welcher Bereich angezeigt wird, zusammen mit der IP-Adresse des übergeordneten Elements. Die Karte wird nur auf der Standortseite geladen. Die übergeordnete App auf einem Telefon verwendet die Kachelserver von OpenStreetMap und zwar erst, nachdem die übergeordnete App auf Karte anzeigen tippt. Wenn ein Elternteil mit Google Maps oder Apple Maps „Hierhin fahren“ wählt oder die Position kopiert, werden die Koordinaten an diese App übertragen und von dort aus gelten die eigenen Richtlinien.",
        ],
      },
      {
        id: "filter",
        title: "Der Webfilter",
        body: [
          "Jedes Telefon erhält eine eigene Adresse in unserem filternden DNS-Dienst (dns.plainphone.org). So funktioniert der Webfilter in jeder App. Die Adresse enthält eine zufällige ClientID, nicht Ihren Namen, Ihre Nummer oder Geräte-ID. Um zu antworten, sieht der Filter, nach welchen Domains das Telefon fragt. Es rettet sie nicht:",
          {
            list: [
              "Kein Abfrageprotokoll. Es ist ausgeschaltet und die Telefone sind auch davon ausgeschlossen, falls es versehentlich eingeschaltet wird.",
              "Keine IP-Adressen. Die Adresse des Telefons wird gekürzt, bevor sie in die Filterstatistik gelangt.",
              "Nur Zähler: die Anzahl der Suchvorgänge und Blöcke, die am häufigsten angeforderten Domänen und die am stärksten ausgelasteten Client-IDs als Gesamtwerte. Sie werden nach 24 Stunden gelöscht.",
              "Die Filtereinstellungen für jedes Telefon (Client-ID, Profil, erlaubte und blockierte Domänen) bleiben erhalten, bis das Telefon entfernt wird.",
            ],
          },
          "Plainphone hält Helpline-Anrufe, Textnachrichten und Aktivitäten auf dem Hilfebildschirm von Elternberichten fern. Android kann weiterhin aktuelle Anrufe und Textgespräche auf dem Telefon speichern. Suchen nach geschützten Hilfe- und Gesundheitsdomänen werden von den Statistiken des Filters ausgeschlossen.",
          "Erlaubte Suchvorgänge werden über verschlüsselte Verbindungen an Quad9 (Schweiz) und Mullvad weitergeleitet, mit Cloudflare als Fallback. Sie sehen die Domain und die Adresse unseres Servers, niemals die des Telefons, und es wird kein Teil der IP-Adresse des Telefons weitergegeben. Die technischen Details finden Sie in <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/privacy.md\">docs/privacy.md</a>.",
        ],
      },
      {
        id: "email",
        title: "E-Mail",
        body: [
          "Wir versenden E-Mails nur, um den Dienst auszuführen: Anmeldelinks, Einladungen, die Nachrichten, die eine vertrauenswürdige Person erhält, und eine Warnung, wenn ein Telefon meldet, dass eine erforderliche Einstellung deaktiviert wurde oder es längere Zeit still war. Keine Newsletter und keine Werbung. Der Versand der Mail erfolgt von unserem eigenen Mailserver in der EU. Das Logo in unseren E-Mails wird von plainphone.org geladen, das Cloudflare hostet. Wenn Ihr E-Mail-Programm also Bilder anzeigt, sieht Cloudflare Ihre IP-Adresse, wenn es das Logo abruft. Die Adresse des Logos hat keine Kennung und ist für alle gleich, sodass wir nicht erfahren, wer eine E-Mail geöffnet hat.",
        ],
      },
      {
        id: "billing",
        title: "Zahlung",
        body: [
          "Plainphone verlangt noch kein Geld, und der gehostete Dienst hat heute keine kostenpflichtigen Funktionen. Dieser Abschnitt beschreibt, was gespeichert wird, sobald die Zahlung eingeschaltet ist. Dann ändert sich zuerst diese Seite.",
          "Für jeden Haushalt speichern wir:",
          {
            list: [
              "seinen Tarif (kostenlos oder bezahlt) und welcher Anbieter die Zahlung abwickelt: Google Play oder Stripe",
              "die Kennungen beim Anbieter: bei Stripe eine Kundennummer und eine Abonnementnummer, bei Google Play das Kauf-Token",
              "wenn Sie dafür zahlen, eine Wartezeit auf einem Handy mit dem Profil Für mich selbst vorzeitig zu beenden: Betrag und Währung, den Zeitpunkt Ihrer Einwilligung, der Zahlung, der Freischaltung, eines Widerrufs und einer Erstattung sowie die Vertragsnummer",
            ],
          },
          "Belege werden per E-Mail an die Adresse Ihres Kontos gesendet.",
          "Wir sehen oder speichern niemals Kartennummern oder andere Kartendaten. Zahlungen werden von Stripe (im Web-Dashboard) oder von Google Play (in der Plainphone-App aus Google Play) abgewickelt. Was dort erhoben wird, regeln deren eigene Datenschutzerklärungen.",
          "Wenn ein Handy oder ein Haushalt gelöscht wird, bleiben die Kaufdaten für die Buchhaltung gespeichert, wie es das Buchführungsrecht verlangt. Sobald Ihr Konto gelöscht ist, bleiben sie ohne Verbindung zum Konto erhalten.",
        ],
      },
      {
        id: "cookies",
        title: "Diese Website, Cookies und Browserspeicher",
        body: [
          "plainphone.org setzt keine Cookies, führt keine Analysen durch und lädt keine Skripte, Schriftarten oder Bilder von anderen Websites. Es wird auf Cloudflare Pages gehostet, sodass Cloudflare wie jeder Webhost Ihre IP-Adresse und die Adresse, nach der Sie fragen, wenn eine Seite bereitgestellt wird, verwaltet. Bei Links zu anderen Websites wie GitHub handelt es sich um normale Links. Sobald Sie einem folgen, gelten die Richtlinien dieser Website.",
          "Die übergeordnete App unter app.plainphone.org setzt ein Cookie, pp_session. Es sorgt dafür, dass Sie angemeldet bleiben, wird nur an unseren eigenen Server gesendet, kann nicht von Skripten auf der Seite gelesen werden (HttpOnly), wird nur bei Anfragen auf derselben Website gesendet (SameSite=Strict) und dauert maximal 60 Tage. Sie benötigen es, um sich anzumelden, daher gibt es kein Cookie-Banner.",
          "Die App merkt sich außerdem in Ihrem Browser Ihre Sprachauswahl und, wenn Sie Benachrichtigungen aktivieren, die ID der Benachrichtigungsadresse dieses Geräts (lokaler Speicher) und, nur während Sie sich anmelden, den Ort, an den Sie anschließend gehen müssen, sowie einen Einladungs- oder Kopplungscode (Sitzungsspeicher, gelöscht, wenn der Tab geschlossen wird). Ein Servicemitarbeiter behält eine Kopie der eigenen Dateien der App, sodass sie ohne Netzwerk geöffnet werden kann. Es speichert niemals Ihre Daten.",
          "Wenn Sie Benachrichtigungen aktivieren, übermittelt uns Ihr Browser eine Adresse an seinen Push-Dienst (Google für Chrome, Apple für Safari, Mozilla für Firefox, Microsoft für Edge) und zwei Schlüssel. Wir speichern sie mit einer kurzen Bezeichnung wie „Chrome · Android“, bis Sie Benachrichtigungen deaktivieren, sich auf diesem Gerät abmelden, das Gerät unter „Einstellungen“ entfernen, der Push-Dienst mitteilt, dass die Adresse nicht mehr gültig ist, oder Sie Ihr Konto löschen. Jede Benachrichtigung wird für Ihr Gerät verschlüsselt, bevor sie unseren Server verlässt, sodass der Push-Dienst sie zwar zustellen, aber nicht lesen kann. Es sieht, wann und an welche Adresse eine Benachrichtigung gesendet wurde.",
        ],
      },
      {
        id: "others",
        title: "Wer ist sonst noch beteiligt?",
        body: [
          "Wir verkaufen keine Daten, geben sie nicht für Werbung weiter und nutzen sie nicht, um ein Profil zu erstellen. Diese helfen uns bei der Durchführung des Dienstes:",
          {
            list: [
              "Hetzner (Deutschland) vermietet uns die Server, auf denen die übergeordnete App, ihre Datenbank und der Webfilter laufen. Backups werden im Objektspeicher in der EU aufbewahrt.",
              "Unser eigener Mailserver in der EU versendet die E-Mails. Es handelt sich nicht um einen E-Mail-Dienst eines Drittanbieters.",
              "Cloudflare hostet diese Website (plainphone.org) und das Logo in unseren E-Mails.",
              "Quad9 und Mullvad, mit Cloudflare als Fallback, beantworten zulässige Webfilter-Suchen, wie oben beschrieben.",
              "Wenn Sie Benachrichtigungen aktivieren: Der Push-Dienst Ihres Browsers (Google, Apple, Mozilla oder Microsoft) stellt sie zu. Der Inhalt ist Ende-zu-Ende verschlüsselt.",
              "Wenn die Zahlung eingeschaltet ist: Stripe oder Google Play wickelt die Zahlung ab, wie unter Zahlung beschrieben.",
            ],
          },
          "Konto- und Telefondaten werden auf Servern in der EU gespeichert.",
        ],
      },
      {
        id: "retention",
        title: "Wie lange behalten wir Dinge?",
        body: [
          {
            table: {
              caption: "Wie lange jede Art von Daten aufbewahrt wird",
              cols: ["Was", "Wie lange"],
              rows: [
                ["Anmeldelinks", "Ungefähr einen Tag nach Ablauf (nach 15 Minuten)"],
                ["Sitzungen", "Bis sie ablaufen (60 Tage) oder Sie sich abmelden"],
                [
                  "Pairing-Codes",
                  "Innerhalb eines Tages gelöscht. Dazu gehört auch der Schlüssel, den ein Telefon einmal erfasst. Bis dahin werden sie in lesbarer Form gespeichert",
                ],
                [
                  "Ihr Konto (E-Mail-Adresse, Sprache)",
                  "Bis Sie das Konto unter „Einstellungen“ in der App löschen oder uns darum bitten",
                ],
                [
                  "Haushalt, Telefone, Apps, Kontakte, Schulzeit, Filtereinstellungen",
                  "Bis das Telefon entfernt wird (auf der Telefonseite in der App) oder Ihr Konto gelöscht wird. Ein Haushalt wird mit dem Account seines letzten Mitglieds gelöscht. Ein entfernter Kontakt oder Zeitplan wird gelöscht, sobald die Entfernung wirksam wird",
                ],
                [
                  "Neueste Position",
                  "Nur das neueste. Wird gelöscht, wenn Sie den Standort ausschalten oder das Telefon entfernen",
                ],
                [
                  "Änderungen, die auf den Schlüssel auf dem eigenen Telefon eines Erwachsenen warteten",
                  "Solange die Änderungen ausstehen und 30 Tage nachdem sie umgesetzt, abgebrochen oder abgelehnt wurden",
                ],
                [
                  "Anfragen von einem Telefon (einer App oder einem Kontakt)",
                  "Während sie geöffnet sind und 30 Tage, nachdem sie zugelassen oder abgelehnt wurden",
                ],
                [
                  "Benachrichtigungsadressen (eine pro Gerät)",
                  "Bis Sie Benachrichtigungen deaktivieren oder sich auf diesem Gerät abmelden oder es entfernen, lehnt der Push-Dienst sie ab oder Sie löschen Ihr Konto",
                ],
                [
                  "Einladungen",
                  "Wird bei Annahme gelöscht. Andernfalls funktionieren sie nach 7 Tagen nicht mehr und werden einen Tag später gelöscht. Sie können eine offene Einladung jederzeit zurückziehen",
                ],
                [
                  "Hashwerte der Einrichtungscodes und gespeicherte Einrichtungseinstellungen",
                  "Können 30 Tage nach Ablauf des Codes bereinigt werden. Beim Entfernen des Telefons werden sie gelöscht",
                ],
                ["Webfilterzähler", "24 Stunden"],
                [
                  "Backups der Datenbank",
                  "Jede Nacht eingenommen und bis zu 30 Tage lang aufbewahrt. Gelöschte Daten können in einem Backup verbleiben, bis sie rotiert werden",
                ],
                ["Backups der Webfiltereinstellungen", "Die letzten 14 Tagesexemplare"],
              ],
            },
          },
          "Wie bei jedem Webdienst schreibt der Webserver vor der App normale technische Protokolle (IP-Adresse, Uhrzeit, angeforderte Adresse). Wir verwenden sie nur, um den Dienst am Laufen zu halten und Missbrauch zu verhindern. Die App selbst speichert IP-Adressen aus Gründen der Geschwindigkeitsbegrenzung nur im Speicher und schreibt sie niemals in ihre Datenbank.",
        ],
      },
      {
        id: "rights",
        title: "Ihre Rechte",
        body: [
          "Sie können von uns kostenlos eine Kopie der von uns über Sie gespeicherten Daten anfordern, diese berichtigen, löschen, die Art und Weise ihrer Nutzung einschränken, sie in einem gängigen Format übergeben oder eine Nutzung, der Sie widersprechen, unterbinden. Sie können sich auch an <a href=\"https://www.datatilsynet.dk/\">Datatilsynet</a>, die dänische Datenschutzbehörde, oder an die Behörde in Ihrem eigenen Land wenden.",
          "In der Eltern-App können Sie einiges davon bereits selbst erledigen:",
          {
            list: [
              "Ändern Sie die Kontakte, Apps, den Webfilter und die Zeitpläne eines Telefons",
              "Position ausschalten, wodurch die gespeicherte Position gelöscht wird",
              "eine offene Einladung zurückziehen",
              "ein Telefon umbenennen oder entfernen. Durch das Entfernen wird alles gelöscht, was darüber gespeichert ist, und der Webfilter wird aufgefordert, seine ClientID zu vergessen, bis er dies bestätigt. Auf dem eigenen Telefon eines Erwachsenen wartet die Entnahme auf den Schlüssel",
              "einen Haushalt verlassen (das letzte Mitglied kann den Haushalt nicht verlassen, aber sein Konto löschen)",
              "Löschen Sie Ihr Konto unter Einstellungen. Ein Haushalt, den Sie mit einem anderen Elternteil teilen, bleibt mit seinen Telefonen bei ihm. Ein Haushalt, zu dem nur Sie gehören, wird mit seinen Telefonen gelöscht. Wenn Sie jemandes Vertrauensperson sind, wird der Schlüssel stattdessen zu einer Verzögerung. In einem Haushalt, zu dem nur Sie gehören, müssen Telefone mit Schlüssel (das eigene Telefon eines Erwachsenen) zuerst über den Schlüssel entfernt werden",
              "Abmelden, wodurch die Sitzung beendet wird",
            ],
          },
          "Es gibt noch keine Schaltfläche zum Herunterladen Ihrer Daten. Fragen Sie uns danach oder nach irgendetwas anderem auf dieser Liste (siehe Wer ist verantwortlich). Wir prüfen, ob Sie die E-Mail-Adresse kontrollieren, bevor wir etwas ändern oder löschen, und sind bestrebt, innerhalb eines Monats zu antworten.",
        ],
      },
      {
        id: "selfhost",
        title: "Betreiben Sie Ihren eigenen Server",
        body: [
          "Plainphone kann auf Ihrem eigenen Server laufen. Wenn Sie dies tun, sind Sie für diesen Server und seine Daten verantwortlich und diese Richtlinie gilt nicht dafür. Die Software speichert, was auf dieser Seite beschrieben wird, aber Sie entscheiden, wo sie ausgeführt wird, wie lange Backups aufbewahrt werden (das Beispiel-Setup speichert 14 tägliche und 8 wöchentliche Kopien) und welche E-Mail- und DNS-Dienste sie verwendet. Die Leitfäden sind <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/self-hosting.md\">self-hosting.md</a> und <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/self-hosting-dns.md\">self-hosting-dns.md</a>.",
        ],
      },
      {
        id: "changes",
        title: "Änderungen an dieser Richtlinie",
        body: [
          "Wenn sich unsere Vorgehensweise ändert, ändern wir diese Seite und das Datum oben, bevor die Änderung in Kraft tritt. Die Seite ist Teil des öffentlichen Projekts, sodass jede Änderung in ihrem <a href=\"https://github.com/plainphone/plainphone/commits/main/site/content\">Verlauf auf GitHub</a> eingesehen werden kann.",
        ],
      },
    ],
  },
  setup: {
    path: "/de/setup/",
    title: "Richten Sie ein Telefon ein: Plainphone",
    h1: "Richten Sie ein Telefon ein",
    description: "Richten Sie Plainphone auf einem neuen oder bereits verwendeten Android-Telefon mit einem privaten Einrichtungscode über Ihr Dashboard ein.",
    lead: "Sie benötigen ein Telefon mit Android 10 oder neuer und das Dashboard muss auf einem zweiten Gerät geöffnet sein.",
    question: "Ist das Telefon neu oder bereits in Gebrauch?",
    strong: "Es ist neu oder zurückgesetzt",
    strongHelp: "Empfohlen. Plainphone kann mehr Einstellungen auf einem neuen Telefon schützen.",
    strongLanguage: "Wählen Sie vor dem Anzeigen des QR-Codes die Sprache des Telefons. Android verwendet sie bei der Einrichtung. Die Sprache in Plainphone können Sie später im Dashboard in den Telefoneinstellungen ändern.",
    light: "Es ist bereits im Einsatz",
    lightHelp: "Behalten Sie die Daten des Telefons und aktivieren Sie den Schutz in den Android-Einstellungen.",
    startStrong: "Starten Sie die Einrichtung für ein neues oder zurückgesetztes Telefon",
    startLight: "Starten Sie die Einrichtung für ein verwendetes Telefon",
    stepsLink: "Schritte ansehen",
    start: "Geben Sie im Dashboard an, für wen das Telefon bestimmt ist, und erstellen Sie einen Einrichtungslink.",
    lightSteps: [
      ["Öffnen Sie den Download auf dem Telefon", "Scannen Sie den Code im Dashboard mit der Kamera des Telefons oder öffnen Sie den privaten Link in Chrome auf diesem Telefon.", "lightScan"],
      ["Installieren Sie Plainphone", "Laden Sie die App herunter und öffnen Sie die Datei. Wenn Android es blockiert, tippen Sie auf „Einstellungen“, aktivieren Sie „Von dieser Quelle zulassen“, gehen Sie zurück und tippen Sie auf „Installieren“.", "download"],
      ["Kehren Sie zu Chrome zurück und tippen Sie auf „Plainphone öffnen“.", "Wählen Sie am Telefon „Kind“ oder „Ich“. Überprüfen Sie das maskierte Konto und den Haushalt, wählen Sie dann eine PIN mit 6 bis 12 Ziffern und geben Sie diese zweimal ein. Befolgen Sie die Anweisungen, um die Einrichtung abzuschließen.", "permissions"],
    ],
    lightHelpItems: [
      ["Android gibt an, dass eine Einstellung eingeschränkt ist", "Bei Android 13 oder höher kann sich dies auf die Telefon-App, die Nachrichten-App oder den Guard auswirken. Öffnen Sie die App-Info von Plainphone. Tippen Sie auf ⋮ (oben rechts) und dann auf „Eingeschränkte Einstellungen zulassen“. Kehren Sie zu Plainphone zurück und versuchen Sie es erneut."],
      ["Ich habe das falsche Telefon eingerichtet", "Tippen Sie innerhalb von zehn Minuten nach Abschluss der Einrichtung im einfachen Modus in Plainphone auf „Einrichtung rückgängig machen“. Dadurch wird Plainphone ausgeschaltet und das Telefon aus dem Dashboard entfernt, wenn eine Verbindung hergestellt werden kann."],
      ["Android fordert dazu auf, eine VPN-Verbindung herzustellen", "Tippen Sie auf OK. Auf diese Weise vergleicht Plainphone Webadressen mit Ihrem Webfilter."],
      ["Ich habe die App über das Installationsprogramm geöffnet", "Gehen Sie zurück zu Chrome und tippen Sie auf der Einrichtungsseite auf Open Plainphone. Wenn Sie bereits eine PIN auf dem Telefon eingegeben haben, verwenden Sie dieselbe PIN im Dashboard."],
    ],
    nextTitle: "Sobald das Telefon verbunden ist",
    next: "Fügen Sie im Dashboard Kontakte hinzu, wählen Sie Apps aus dem Katalog aus oder legen Sie Schulzeiten fest.",
    steps: [
      {
        title: "Setzen Sie das Telefon zurück",
        body: [
          "Auf einem Telefon, das Sie zurücksetzen müssen, müssen Sie alles sichern, was Sie behalten möchten, und dann Einstellungen → System → Zurücksetzen → Alle Daten löschen wählen. Warten Sie, bis der Begrüßungsbildschirm angezeigt wird.",
          "Die Menünamen unterscheiden sich ein wenig zwischen den Marken. Wenn auf dem Telefon ein Google-Konto vorhanden ist, entfernen Sie es zuerst (Einstellungen → Konten), andernfalls fragt das Telefon nach dem Zurücksetzen danach.",
        ],
        fig: "reset",
      },
      {
        title: "Tippen Sie sechsmal auf den Begrüßungsbildschirm",
        body: [
          "Tippen Sie auf dem ersten Begrüßungsbildschirm sechsmal hintereinander schnell auf dieselbe leere Stelle. Drücken Sie nicht Start. Es öffnet sich ein QR-Reader. Auf einigen Telefonen werden Sie zunächst aufgefordert, es herunterzuladen.",
        ],
        fig: "welcome",
      },
      {
        title: "Scannen Sie den QR-Code",
        body: [
          "Scannen Sie den Code im Dashboard und wählen Sie dann ein WLAN-Netzwerk aus. Das Telefon lädt Plainphone herunter. Wenn Plainphone geöffnet wird, bestätigen Sie, um welches Telefon es sich handelt, und überprüfen Sie das auf dem Telefon angezeigte Dashboard-Konto.",
          "Wenn auf dem Telefon steht, dass es von einer Organisation verwaltet wird, dann ist das Plainphone. Akzeptieren: So funktioniert die Sperre.",
        ],
        fig: "scan",
      },
      {
        title: "Nur Android 10 bis 13: Legen Sie die Standard-Telefon-App fest",
        body: [
          "Nachdem Sie das Dashboard-Konto bestätigt haben, fragt das Telefon: <em>Plainphone als Standard-Telefon-App festlegen?</em> Tippen Sie auf <strong>Als Standard festlegen</strong>. Haben Sie es verpasst? Öffnen Sie die Plainphone-App und Sie werden erneut gefragt.",
          "Unter Android 14 und neuer geschieht dies von selbst.",
        ],
        fig: "dialog",
      },
      {
        title: "Plainphone im Hintergrund ausführen lassen",
        body: ["Tippen Sie auf <strong>Continue</strong> und erteilen Sie dann die Berechtigung in Android, damit Plainphone sich sicher selbst aktualisieren kann. Wenn Sie diesen Schritt überspringen, öffnen Sie Plainphone erneut, um die Abfrage wieder anzuzeigen."],
      },
    ],
    figs: {
      lightScan: "Eine Telefonkamera, die einen Setup-Code einrahmt.",
      download: "Ein Telefonbildschirm mit einem Download-Pfeil.",
      permissions: "Ein Telefonbildschirm mit zwei Einstellungsschaltern.",
      reset: "Eine Zeichnung eines Telefons mit einer Einstellungsliste, in der die Zeile zum Löschen aller Daten markiert ist.",
      welcome: "Eine Zeichnung eines Telefons auf seinem ersten Begrüßungsbildschirm. Sechsmal auf die gleiche leere Stelle tippen, markiert mit „6×“.",
      scan: "Zwei Zeichnungen eines Telefons. Beim ersten Frame erstellt ein QR-Reader einen QR-Code. Auf der zweiten Seite finden Sie eine Liste der Wi-Fi-Netzwerke, von denen eines ausgewählt ist.",
      dialog: "Eine Zeichnung eines Telefons mit einem Dialogfeld mit zwei Schaltflächen: „Als Standard festlegen“ und „Abbrechen“.",
    },
    drawing: { taps: "6×", set: "Als Standard festlegen", cancel: "Stornieren" },
    troubleTitle: "Wenn etwas schief geht",
    trouble: [
      [
        "Der QR-Code ist abgelaufen oder funktioniert nicht",
        "Ein Code funktioniert einmal und 24 Stunden lang. Öffnen Sie das Telefon im Dashboard und wählen Sie <strong>Setup-QR-Code anzeigen</strong>, um einen neuen zu erhalten. Ein neuer Code verhindert, dass der alte funktioniert.",
      ],
      [
        "Das Telefon sagt „Gerät kann nicht eingerichtet werden“",
        "Überprüfen Sie, ob das Telefon über Android 10 oder neuer verfügt (Einstellungen → Über das Telefon). Ältere Telefone können nicht verwendet werden.",
      ],
      [
        "Das Telefon zeigt einen Code an, anstatt eine Verbindung herzustellen",
        "Wählen Sie im Dashboard <strong>Telefon hinzufügen</strong>, dann <strong>Geben Sie unten den Code</strong> ein und geben Sie den Code ein, den das Telefon anzeigt.",
      ],
      [
        "Sechsmaliges Antippen bringt nichts",
        "Das Telefon muss sich auf dem ersten Begrüßungsbildschirm befinden. Tippen Sie schnell auf eine Stelle in der Mitte und drücken Sie nicht die Starttaste.",
      ],
    ],
    help: "Stecken Sie immer noch fest? <a href=\"https://github.com/plainphone/plainphone/issues\">Öffnen Sie ein Problem auf GitHub</a>.",
    testedTitle: "Getestete Telefone",
    tested: {
      caption: "Telefone, auf denen Plainphone eingerichtet wurde",
      cols: ["Telefon", "Android", "Ergebnis"],
      rows: [["OnePlus 5T (A5010)", "Android 10", "Funktioniert"]],
      body: [
        "Funktioniert bedeutet, dass die Einrichtung, die Sperre und die Verbindung zum Dashboard auf diesem Telefon bestätigt werden. Die vollständige Bypass-Checkliste wurde noch nicht durchlaufen.",
        "Empfohlen wird Android 14 oder neuer. Es erledigt alles von selbst und sperrt die Telefon-App in den Einstellungen.",
        "Bei Android 10 bis 13 gibt es eine bekannte Lücke: Das Kind kann in den Einstellungen zur integrierten Telefon-App wechseln. Anrufe werden dann erst gefiltert, wenn erneut „Plainphone“ ausgewählt wird. Das Dashboard zeigt es innerhalb von 15 Minuten an.",
      ],
    },
  },
  footer: {
    maintained: "Plainphone wird von <a href=\"https://mahoje.dk\">Mahoje</a> in Dänemark verwaltet.",
    setup: "Anleitung: <a href=\"/de/setup/\">Ein Telefon einrichten</a>.",
    privacy: "Diese Website setzt keine Cookies und führt keine Analysen durch. <a href=\"/de/privacy/\">Datenschutzerklärung</a>.",
    license: "Code unter <a href=\"https://github.com/plainphone/plainphone/blob/main/LICENSE\">Apache-2.0</a>. Schriftarten: Schibsted Grotesk und IBM Plex Mono, <a href=\"/fonts/OFL.txt\">SIL OFL</a>.",
  },
  notFound: {
    title: "Seite nicht gefunden",
    body: "An dieser Adresse gibt es nichts.",
    back: "Gehen Sie zur Startseite",
  },
};
