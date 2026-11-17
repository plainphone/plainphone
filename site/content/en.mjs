// SPDX-License-Identifier: Apache-2.0
// English copy. Strings may contain trusted inline HTML (links, <em>).
export default {
  lang: "en",
  path: "/",
  title: "Plainphone: a calm phone made from an ordinary Android",
  description:
    "Free, open-source software that turns an ordinary Android phone into a calm one: calls, messages, camera and the apps you choose. No feeds, no ads.",
  ogAlt: "Plainphone: your phone, minus the noise.",
  skip: "Skip to content",
  nav: { label: "Main", source: "Source code", switchLabel: "Dansk", switchLang: "da" },
  status: "Early. Open source. Not ready for daily use yet.",
  hero: {
    title: "Your phone, minus the noise.",
    lead:
      "Plainphone turns an ordinary Android phone into a calm one. It keeps what you need and quietly removes the rest. It is free, and the code is open.",
    staysLabel: "What stays",
    stays: ["Calls", "Messages", "Camera", "Maps, music and the apps you choose"],
    goesLabel: "What goes",
    goes: ["Social media feeds", "Ads", "Games", "Porn and gambling sites", "App stores, unless you allow them"],
  },
  who: {
    title: "Who it is for",
    lead: "Anyone who wants a quieter life with a phone in it. The rules are the same; what changes is who holds the key. This is what Plainphone is being built to do.",
    paths: [
      {
        id: "child",
        title: "For my child",
        body:
          "A first phone that can call, text, find the way home and play music, without the parts that swallow an afternoon. You hold the key: you will choose the apps and the contacts, and open things up as your child grows.",
      },
      {
        id: "self",
        title: "For myself",
        body:
          "Less screen, without giving up maps, banking or your camera. You will hold the key yourself, with a delay: loosening a rule takes effect after, say, 24 hours, so a weak moment passes. Or let a person you trust approve it.",
      },
    ],
  },
  how: {
    title: "How it works",
    steps: [
      {
        title: "Reset the phone",
        body: "An Android phone with Android 10 or newer (see tested phones below). Setup erases it, so save what you want to keep first.",
      },
      {
        title: "Scan a QR code",
        body: "Tap six times on the welcome screen and scan the code. The phone installs Plainphone and locks itself before it is ever used.",
      },
      {
        title: "Choose the rules",
        body: "Pick which apps show, who can call, and when school time or quiet hours start. A stricter rule will apply at once.",
      },
    ],
    guide: "Want to try it? <a href=\"/setup/\">Follow the step-by-step guide</a>.",
    note:
      "Today, steps 1 and 2 work on test phones. The place where you choose the rules is being built.",
  },
  compare: {
    title: "Compared with the usual options",
    lead:
      "Each option is a fair choice for someone. This is where Plainphone sits among them. The Plainphone column describes the goal; today only the lock works.",
    caption: "Plainphone compared with a basic phone, a kids’ smartwatch and built-in parental controls",
    cols: ["Basic phone", "Kids’ smartwatch", "Built-in parental controls", "Plainphone"],
    rows: [
      ["Maps, music, banking and school apps", "No", "No", "Yes", "Yes, the ones you pick (planned)"],
      ["Web filter that also works inside apps", "No internet", "No internet", "Partly", "Yes, for most apps (planned)"],
      ["Only approved people can call", "Some models", "Yes", "Partly", "Yes, calls and texts (planned)"],
      ["Works on a phone you already own", "No", "No", "Yes", "Yes, Android 10+"],
      ["For adults too", "Yes", "No", "Mostly for children", "Yes (planned)"],
      ["Price", "A new phone", "A new device, often a subscription", "Free", "Free"],
    ],
  },
  phones: {
    title: "Tested phones",
    body:
      "One so far: a OnePlus 5T on Android 10. Setup, the lock and the connection to the dashboard work, as the <a href=\"/setup/#tested\">setup guide</a> shows. It has not been through our <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/bypass-checklist.md\">bypass checklist</a> on real hardware yet, and a phone counts as fully tested only after it has passed every test on that list. Until then, please treat Plainphone as an experiment.",
  },
  open: {
    title: "Free and open source",
    body: [
      "Plainphone is free and will stay free. The code is public under the Apache-2.0 license, so anyone can read it, check it and build on it.",
      "It is being built so you can run the whole service on your own server. A shared server, hosted in the EU, is planned too.",
    ],
    follow:
      "There is no mailing list. To follow along, star or watch the project on GitHub.",
    github: "Follow on GitHub",
    donate: "Donations will open later. There is no payment link yet.",
  },
  faq: {
    title: "Questions",
    items: [
      {
        q: "Does it work on iPhone?",
        a: "Not yet. Apple does not let an app lock an iPhone the way Android does. A lighter version built on Apple’s Screen Time is planned for later; Android will stay the strong option.",
      },
      {
        q: "What does Plainphone know about me or my child?",
        a: "As little as it can. When location arrives, only the phone’s last known position will be kept, never a history. No tracking, no ads, nothing sold. For adults managing their own phone, location will be off by default. Today the app on the phone sends nothing to a server. If you sign in to the parent app, it stores your email address and the rules you set. The <a href=\"/privacy/\">privacy policy</a> has the details.",
      },
      {
        q: "What does it cost?",
        a: "Nothing. You use a phone you already have, and the software is free. Donations will help pay for the servers later.",
      },
      {
        q: "Can it be bypassed?",
        a: "Someone determined, with time and a computer, can reset an Android phone from recovery mode. Plainphone adds friction, not a prison. If a Google account is on the phone, a reset asks for it before the phone works again.",
      },
      {
        q: "What about WhatsApp, Snapchat and other chat apps?",
        a: "Chat apps stay hidden unless you allow them, and approved contacts will cover calls and texts, not what happens inside those apps. If a whole class is on one app, software will not fix that. Talking with the other parents often does.",
      },
    ],
  },
  privacy: {
    path: "/privacy/",
    title: "Privacy policy: Plainphone",
    description:
      "What Plainphone stores about you and the phones you manage, for how long, who else is involved, and how to ask us to correct or delete it.",
    h1: "Privacy policy",
    updated: "Last updated 17 November 2026",
    lead:
      "Plainphone keeps as little as it can, for as short a time as it can. This page says what that means in practice. It is written to be read, not to hide things.",
    status:
      "Plainphone is early. The parent app, the server, the web filter and the Plainphone app on the phone all work together, but it is not ready for everyday use yet. When what Plainphone stores changes, this page changes first.",
    tocLabel: "On this page",
    short: {
      title: "The short version",
      list: [
        "This website sets no cookies, runs no analytics and loads nothing from other sites.",
        "The parent app stores your email address and the rules you set for each phone. When a phone is removed, everything stored about it is deleted.",
        "Location, when it is on, is only the phone’s last known position. There is no history.",
        "The web filter does not keep a list of the sites a phone visits.",
        "We do not sell data, show ads or build profiles.",
      ],
    },
    sections: [
      {
        id: "controller",
        title: "Who is responsible",
        body: [
          `Plainphone is an open-source project maintained by <a href="https://mahoje.dk">Mahoje</a> in Denmark. We are responsible for the data in the hosted service: the parent app at app.plainphone.org and the web filter at dns.plainphone.org.`,
          `For anything about your data, such as a copy of it or deleting it, write to <a href="mailto:privacy@plainphone.org">privacy@plainphone.org</a>. For questions that are not personal, you can also open an issue at <a href="https://github.com/plainphone/plainphone/issues">github.com/plainphone/plainphone/issues</a>, but issues are public, so keep personal details such as your email address out of them. Security problems go through the private report form described in <a href="https://github.com/plainphone/plainphone/blob/main/SECURITY.md">SECURITY.md</a>.`,
        ],
      },
      {
        id: "why",
        title: "Why we use your data",
        body: [
          "We use it to run Plainphone for you: to sign you in, to apply the rules you set to the phones you manage, and to keep the service working and safe. The legal basis is the agreement between you and the service (GDPR article 6(1)(b)) and our legitimate interest in security and stopping abuse (article 6(1)(f)). For someone who is invited by another person, it is that person’s request together with our interest in delivering it (article 6(1)(f)). We use the data for nothing else.",
        ],
      },
      {
        id: "account",
        title: "Your account",
        body: [
          "You sign in with your email address and a link we send you. There is no password. We store:",
          {
            list: [
              "your email address and your language (English or Danish)",
              "the sign-in link you asked for: your email address, an expiry time and a hash of the link. It is deleted about a day after it expires, also when no account exists for that address",
              "your session: a hash of the key your browser holds and when it ends (60 days at most, or when you log out). We do not store your IP address or your device",
              "your household: its name, who is in it, and the invitations you have sent, with the invited email address and expiry date. An invitation is deleted when it is accepted, and a day after it expires",
            ],
          },
          "Everyone in a household can see each other’s email addresses and manage all of its phones. Sign-in links, sessions and the keys that phones use are stored as hashes.",
        ],
      },
      {
        id: "phones",
        title: "Phones and rules",
        body: [
          "A parent, or an adult for their own phone, adds a phone by entering the code it shows. Children get no account and are never asked for an email address. For each phone we store what the adult sets up:",
          {
            list: [
              "the name the adult gives the phone, whether it is a child’s or an adult’s own phone, its time zone and when it last contacted the server",
              "a few short facts the phone reports when it pairs, such as its model and Android version, and its latest status: battery level, app version, whether its lock is intact and which web filter address it uses. Each report replaces the one before",
              "the apps on the phone (name and package name) and which of them are allowed",
              "approved contacts: the names and numbers a parent types into the parent app. The server holds nothing else from the phone’s contacts",
              "web filter settings: which categories are blocked, and the domains the parent allows or blocks",
              "school time and bedtime, and the apps allowed during them",
              "on an adult’s own phone: the settings of the key (a delay, or the email address of a trusted person) and the changes that wait for the key. A change that has been applied, cancelled or rejected is kept for 30 days and then deleted",
              "requests the phone sends: an app from its own list, or a contact (name and number) someone on the phone asks to add. Each request is kept while it is open, and for 30 days after a parent allows or declines it",
              "after how many hours of silence the phone counts as quiet (one setting per phone, shared by its parents), and for each parent whether they want notifications about it",
            ],
          },
          "A trusted person you name gets an email. Once signed in, they can see the phone’s name, what is being asked for, and your email address.",
        ],
      },
      {
        id: "children",
        title: "Children",
        body: [
          "Children do not make accounts. A parent does, and the parent decides what is stored about the child’s phone. We do not knowingly collect data directly from a child, we show no ads, and we do not build profiles of children. The most sensitive data about a child’s phone is its last known position and its list of approved contacts. We suggest telling your child what the phone shares, and why.",
        ],
      },
      {
        id: "location",
        title: "Location",
        body: [
          "Location is a setting for each phone. It starts on for a child’s phone and off for an adult’s own phone, and a parent can change it at any time. When it is on, the phone reports its position every few minutes (five by default), and a parent can ask for a fresh one.",
          "The server keeps only the latest position: coordinates, accuracy and time. Each new position replaces the old one, and no history is kept. Switching location off, or removing the phone, deletes the stored position.",
          "If a parent chooses “Open in OpenStreetMap”, the coordinates are in the link that opens, and OpenStreetMap’s own policy applies from there.",
        ],
      },
      {
        id: "filter",
        title: "The web filter",
        body: [
          "Each phone gets its own address on our filtering DNS service (dns.plainphone.org). This is how the web filter works in every app. The address contains a random ClientID, not your name, number or device id. To answer, the filter sees which domains the phone asks for. It does not save them:",
          {
            list: [
              "No query log. It is switched off, and the phones are also excluded from it in case it is switched on by mistake.",
              "No IP addresses. The phone’s address is cut short before it reaches the filter’s statistics.",
              "Counters only: the number of lookups and blocks, the most requested domains and the busiest ClientIDs, as totals. They are deleted after 24 hours.",
              "The filter’s settings for each phone (ClientID, profile, allowed and blocked domains) are kept until the phone is removed.",
            ],
          },
          "Plainphone keeps help-line calls, texts and activity in the Help screen out of parent reports. Android can still keep recent calls and text conversations on the phone. Lookups for protected help and health domains are excluded from the filter’s statistics.",
          `Allowed lookups are passed on over encrypted connections to Quad9 (Switzerland) and Mullvad, with Cloudflare as a fallback. They see the domain and our server’s address, never the phone’s, and no part of the phone’s IP address is passed on. The technical details are in <a href="https://github.com/plainphone/plainphone/blob/main/docs/privacy.md">docs/privacy.md</a>.`,
        ],
      },
      {
        id: "email",
        title: "Email",
        body: [
          "We send email only to run the service: sign-in links, invitations, the messages a trusted person gets, and an alert when a phone’s protection is removed or it has been quiet for a long time. No newsletters and no ads. The mail is sent from our own mail server in the EU. The logo in our emails is loaded from plainphone.org, which Cloudflare hosts, so if your mail program shows images, Cloudflare sees your IP address when it fetches the logo. The logo’s address has no identifier and is the same for everyone, so it does not tell us who opened a mail.",
        ],
      },
      {
        id: "cookies",
        title: "This website, cookies and browser storage",
        body: [
          "plainphone.org sets no cookies, runs no analytics and loads no scripts, fonts or images from other sites. It is hosted on Cloudflare Pages, so Cloudflare, like any web host, handles your IP address and the address you ask for when it delivers a page. Links to other sites, such as GitHub, are ordinary links. Once you follow one, that site’s policy applies.",
          "The parent app at app.plainphone.org sets one cookie, pp_session. It keeps you signed in, is only sent to our own server, cannot be read by scripts on the page (HttpOnly), is only sent on same-site requests (SameSite=Strict) and lasts 60 days at most. You need it to sign in, so there is no cookie banner.",
          "The app also remembers, in your browser, your language choice and, if you turn on notifications, the id of this device’s notification address (local storage) and, only while you sign in, where to go afterwards and an invitation or pairing code (session storage, cleared when the tab closes). A service worker keeps a copy of the app’s own files so it opens without a network. It never stores your data.",
          "If you turn on notifications, your browser gives us an address at its push service (Google for Chrome, Apple for Safari, Mozilla for Firefox, Microsoft for Edge) and two keys. We store them, with a short label such as “Chrome · Android”, until you turn notifications off, sign out on that device, remove the device under Settings, the push service says the address is no longer valid, or you delete your account. Each notification is encrypted for your device before it leaves our server, so the push service can deliver it but not read it. It does see that a notification was sent, when, and to which address.",
        ],
      },
      {
        id: "others",
        title: "Who else is involved",
        body: [
          "We do not sell data, share it for advertising or use it to profile anyone. These help us run the service:",
          {
            list: [
              "Hetzner (Germany) rents us the servers where the parent app, its database and the web filter run. Backups are kept in object storage in the EU.",
              "Our own mail server in the EU sends the emails. It is not a third-party mail service.",
              "Cloudflare hosts this website (plainphone.org) and the logo in our emails.",
              "Quad9 and Mullvad, with Cloudflare as a fallback, answer allowed web filter lookups, as described above.",
              "If you turn on notifications: the push service of your browser (Google, Apple, Mozilla or Microsoft) delivers them. The content is encrypted end to end.",
            ],
          },
          "Account and phone data is kept on servers in the EU.",
        ],
      },
      {
        id: "retention",
        title: "How long we keep things",
        body: [
          {
            table: {
              caption: "How long each kind of data is kept",
              cols: ["What", "How long"],
              rows: [
                ["Sign-in links", "About a day after they expire (they expire after 15 minutes)"],
                ["Sessions", "Until they expire (60 days) or you log out"],
                [
                  "Pairing codes",
                  "Deleted within a day. This includes the key a phone collects once. Until then it is stored in readable form",
                ],
                [
                  "Your account (email address, language)",
                  "Until you delete the account under Settings in the app, or ask us to",
                ],
                [
                  "Household, phones, apps, contacts, school time, filter settings",
                  "Until the phone is removed (on the phone’s page in the app) or your account is deleted. A household is deleted with the account of its last member. A removed contact or schedule is deleted when the removal takes effect",
                ],
                [
                  "Latest position",
                  "Only the latest one. Deleted when you switch location off or remove the phone",
                ],
                [
                  "Changes that waited for the key on an adult’s own phone",
                  "While they wait, and 30 days after they were applied, cancelled or rejected",
                ],
                [
                  "Requests from a phone (an app or a contact)",
                  "While they are open, and 30 days after they are allowed or declined",
                ],
                [
                  "Notification addresses (one per device)",
                  "Until you turn notifications off or sign out on that device, or remove it, the push service rejects it, or you delete your account",
                ],
                [
                  "Invitations",
                  "Deleted when accepted. Otherwise they stop working after 7 days and are deleted a day later. You can withdraw an open invitation at any time",
                ],
                ["Web filter counters", "24 hours"],
                [
                  "Backups of the database",
                  "Taken every night and kept for up to 30 days. Deleted data can stay in a backup until it rotates out",
                ],
                ["Backups of the web filter settings", "The last 14 daily copies"],
              ],
            },
          },
          "Like any web service, the web server in front of the app writes ordinary technical logs (IP address, time, the address asked for). We use them only to keep the service running and to stop abuse. The app itself holds IP addresses only in memory, for rate limits, and never writes them to its database.",
        ],
      },
      {
        id: "rights",
        title: "Your rights",
        body: [
          "You can ask us, free of charge, for a copy of the data we hold about you, to correct it, to delete it, to limit how we use it, to hand it over in a common format, or to stop a use you object to. You can also complain to <a href=\"https://www.datatilsynet.dk/\">Datatilsynet</a>, the Danish Data Protection Agency, or to the authority in your own country.",
          "In the parent app you can already do some of this yourself:",
          {
            list: [
              "change a phone’s contacts, apps, web filter and schedules",
              "switch location off, which deletes the stored position",
              "withdraw an open invitation",
              "rename or remove a phone. Removing it deletes everything stored about it, and the web filter is asked to forget its ClientID until it confirms. On an adult’s own phone the removal waits for the key",
              "leave a household (the last member cannot leave, but can delete their account)",
              "delete your account under Settings. A household you share with another parent stays with them, with its phones. A household only you belong to is deleted with its phones. If you are someone’s trusted person, their key becomes a delay instead. In a household only you belong to, phones with a key (an adult’s own phone) must be removed first, through the key",
              "log out, which ends the session",
            ],
          },
          "There is no button yet to download your data. Ask us for that, or for anything else on this list (see Who is responsible). We check that you control the email address before we change or delete anything, and we aim to answer within a month.",
        ],
      },
      {
        id: "selfhost",
        title: "Running your own server",
        body: [
          `Plainphone can run on your own server. If you do that, you are responsible for that server and its data, and this policy does not cover it. The software stores what this page describes, but you choose where it runs, how long backups are kept (the sample setup keeps 14 daily and 8 weekly copies) and which mail and DNS services it uses. The guides are <a href="https://github.com/plainphone/plainphone/blob/main/docs/self-hosting.md">self-hosting.md</a> and <a href="https://github.com/plainphone/plainphone/blob/main/docs/self-hosting-dns.md">self-hosting-dns.md</a>.`,
        ],
      },
      {
        id: "changes",
        title: "Changes to this policy",
        body: [
          `If what we do changes, we change this page and the date at the top before the change takes effect. The page is part of the public project, so every change can be seen in its <a href="https://github.com/plainphone/plainphone/commits/main/site/content">history on GitHub</a>.`,
        ],
      },
    ],
  },
  setup: {
    path: "/setup/",
    title: "Set up a phone: Plainphone",
    description:
      "How to set up a phone with Plainphone: choose a PIN in the dashboard, scan a QR code on the reset phone, and let the phone lock itself. About ten minutes.",
    h1: "Set up a phone",
    lead:
      "You set up a phone with a QR code from the dashboard. It takes about ten minutes, and you need no computer.",
    needTitle: "What you need",
    need: [
      "An Android phone with Android 10 or newer that you may reset. Setup erases everything on it, so save what you want to keep first. The version is under Settings → About phone.",
      "Wi-Fi without a login page. Hotel and school networks that ask you to sign in do not work during setup.",
      "About ten minutes.",
      "The dashboard open on another device, such as your own phone or a computer: <a href=\"https://app.plainphone.org\">app.plainphone.org</a>.",
    ],
    stepsTitle: "Step by step",
    steps: [
      {
        title: "Add the phone",
        body: [
          "In the dashboard, choose <strong>Add phone</strong>. Say who the phone is for, a child or yourself, and give it a name. Only you see the name.",
        ],
        fig: "who",
      },
      {
        title: "Choose a maintenance PIN",
        body: [
          "Choose a PIN of at least 6 digits and type it twice. It opens a hidden maintenance screen on the phone: tap <strong>Version</strong> 7 times, then enter the PIN. Keep it somewhere safe, because Plainphone cannot show it again.",
          "The PIN never leaves your browser. Only a scrambled (hashed) copy goes into the QR code.",
        ],
        fig: "pin",
      },
      {
        title: "Show the QR code",
        body: [
          "The dashboard now shows a QR code. It works once, and for 24 hours. Do not share it, and keep the page open.",
        ],
        fig: "qr",
      },
      {
        title: "Reset the phone",
        body: [
          "Factory reset the phone: Settings → System → Reset → Erase all data. Or use a new phone. Wait until the welcome screen appears.",
          "The menu names differ a little between brands. If a Google account is on the phone, remove it first (Settings → Accounts), or the phone asks for it after the reset.",
        ],
        fig: "reset",
      },
      {
        title: "Tap the welcome screen 6 times",
        body: [
          "On the first welcome screen, tap the same empty spot 6 times in a row, quickly. Do not press Start. A QR reader opens. On some phones it first asks to download it.",
        ],
        fig: "welcome",
      },
      {
        title: "Scan the QR code",
        body: [
          "Scan the code from the dashboard, then choose a Wi-Fi network. The phone downloads Plainphone, makes it the device owner and locks itself.",
          "If the phone says it will be managed by an organisation, that is Plainphone. Accept: it is how the lock works.",
        ],
        fig: "scan",
      },
      {
        title: "Android 10 to 13 only: set the default phone app",
        body: [
          "During setup or just after, the phone asks <em>Set Plainphone as your default phone app?</em> Tap <strong>Set as default</strong>. Missed it? Open the Plainphone app and it asks again.",
          "On Android 14 and newer this happens by itself.",
        ],
        fig: "dialog",
      },
      {
        title: "Done",
        body: [
          "The phone connects to the dashboard by itself. There is no code to type. When it is connected, the dashboard says so. Then choose its apps and contacts.",
        ],
        fig: "done",
      },
    ],
    figs: {
      who: "The dashboard page “Who is the phone for?” with the choices Child and Self, a Name field and a Next button.",
      pin: "The dashboard page “Choose a maintenance PIN” with two PIN fields and the button “Make the QR code”.",
      qr: "The dashboard page “Set up Alma’s phone”. A box where the QR code appears, and below it “Waiting for the phone” and a note that the code works once.",
      done: "The dashboard says the phone is connected and offers a button to open it.",
      reset: "A drawing of a phone showing a settings list, with the row for erasing all data marked.",
      welcome: "A drawing of a phone on its first welcome screen. Six taps in the same empty spot, marked “6×”.",
      scan: "Two drawings of a phone. On the first, a QR reader frames a QR code. On the second, a list of Wi-Fi networks with one chosen.",
      dialog: "A drawing of a phone with a dialog that has two buttons, “Set as default” and “Cancel”.",
    },
    drawing: { taps: "6×", set: "Set as default", cancel: "Cancel" },
    troubleTitle: "If something goes wrong",
    trouble: [
      [
        "The QR code has expired or does not work",
        "A code works once, and for 24 hours. Open the phone in the dashboard and choose <strong>Show the setup QR code</strong> to get a new one. A new code stops the old one from working.",
      ],
      [
        "The phone says “Can’t set up device”",
        "Check that the phone has Android 10 or newer (Settings → About phone). Older phones cannot be used.",
      ],
      [
        "The phone shows a code instead of connecting",
        "In the dashboard, choose <strong>Add phone</strong>, then <strong>Type the code</strong> at the bottom, and enter the code the phone shows.",
      ],
      [
        "Tapping 6 times does nothing",
        "The phone must be on its very first welcome screen. Tap one spot in the middle, quickly, and do not press Start.",
      ],
    ],
    help: "Still stuck? <a href=\"https://github.com/plainphone/plainphone/issues\">Open an issue on GitHub</a>.",
    testedTitle: "Tested phones",
    tested: {
      caption: "Phones that Plainphone has been set up on",
      cols: ["Phone", "Android", "Result"],
      rows: [["OnePlus 5T (A5010)", "Android 10", "Works"]],
      body: [
        "Works means that setup, the lock and the connection to the dashboard are confirmed on this phone. It has not been through the full bypass checklist yet.",
        "Android 14 or newer is recommended. It does everything by itself and locks the phone app in Settings.",
        "Android 10 to 13 has one known gap: the child can switch to the built-in phone app in Settings. Calls are then not filtered until Plainphone is chosen again. The dashboard shows it within 15 minutes.",
      ],
    },
  },
  footer: {
    maintained: "Plainphone is maintained by <a href=\"https://mahoje.dk\">Mahoje</a> in Denmark.",
    setup: "Guide: <a href=\"/setup/\">Set up a phone</a>.",
    privacy: "This site sets no cookies and runs no analytics. <a href=\"/privacy/\">Privacy policy</a>.",
    license: "Code under <a href=\"https://github.com/plainphone/plainphone/blob/main/LICENSE\">Apache-2.0</a>. Font: Atkinson Hyperlegible Next, <a href=\"/fonts/OFL.txt\">SIL OFL</a>.",
  },
  notFound: {
    title: "Page not found",
    body: "There is nothing at this address.",
    back: "Go to the front page",
  },
};
