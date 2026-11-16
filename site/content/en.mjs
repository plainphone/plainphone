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
        body: "An Android phone with Android 14 or newer (see tested phones below). Setup erases it, so save what you want to keep first.",
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
      ["Works on a phone you already own", "No", "No", "Yes", "Yes, Android 14+"],
      ["For adults too", "Yes", "No", "Mostly for children", "Yes (planned)"],
      ["Price", "A new phone", "A new device, often a subscription", "Free", "Free"],
    ],
  },
  phones: {
    title: "Tested phones",
    body:
      "None yet. A phone goes on this list only after it has passed every test in our <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/bypass-checklist.md\">bypass checklist</a> on real hardware. Until then, please treat Plainphone as an experiment.",
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
      "Plainphone is early. The parent app and the server exist, but the Plainphone app on the phone does not connect to them yet, so today it sends nothing to the server. Where something only starts once phones are connected, this page says so. A phone can already be set up to use the web filter, which is covered below.",
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
          `To reach us, open an issue at <a href="https://github.com/plainphone/plainphone/issues">github.com/plainphone/plainphone/issues</a>. Issues are public, so keep personal details, such as your email address, out of them. If your request needs details that must stay private, use the private report form described in <a href="https://github.com/plainphone/plainphone/blob/main/SECURITY.md">SECURITY.md</a> (Security, then Report a vulnerability) and say that it is a privacy request. It is made for security reports, but it reaches the maintainers privately, and we reply there.`,
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
              "your household: its name, who is in it, and the invitations you have sent, with the invited email address and expiry date",
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
              "a few short facts the phone reports when it pairs, such as its model and Android version",
              "the apps on the phone (name and package name) and which of them are allowed",
              "approved contacts: the names and numbers a parent types into the parent app. The server holds nothing else from the phone’s contacts",
              "web filter settings: which categories are blocked, and the domains the parent allows or blocks",
              "school time and bedtime, and the apps allowed during them",
              "on an adult’s own phone: the settings of the key (a delay, or the email address of a trusted person) and a record of the changes that waited for the key",
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
          `Allowed lookups are passed on over encrypted connections to Quad9 (Switzerland) and Mullvad, with Cloudflare as a fallback. They see the domain and our server’s address, never the phone’s, and no part of the phone’s IP address is passed on. The technical details are in <a href="https://github.com/plainphone/plainphone/blob/main/docs/privacy.md">docs/privacy.md</a>.`,
        ],
      },
      {
        id: "email",
        title: "Email",
        body: [
          "We send email only to run the service: sign-in links, invitations and the message a trusted person gets. No newsletters and no ads. The mail is sent from our own mail server in the EU. The logo in our emails is loaded from app.plainphone.org and has no identifier in its address. It is the same for everyone, so it does not tell us who opened a mail.",
        ],
      },
      {
        id: "cookies",
        title: "This website, cookies and browser storage",
        body: [
          "plainphone.org sets no cookies, runs no analytics and loads no scripts, fonts or images from other sites. It is hosted on Cloudflare Pages, so Cloudflare, like any web host, handles your IP address and the address you ask for when it delivers a page. Links to other sites, such as GitHub, are ordinary links. Once you follow one, that site’s policy applies.",
          "The parent app at app.plainphone.org sets one cookie, pp_session. It keeps you signed in, is only sent to our own server, cannot be read by scripts on the page (HttpOnly), is only sent on same-site requests (SameSite=Strict) and lasts 60 days at most. You need it to sign in, so there is no cookie banner.",
          "The app also remembers, in your browser, your language choice (local storage) and, only while you sign in, where to go afterwards and an invitation or pairing code (session storage, cleared when the tab closes). A service worker keeps a copy of the app’s own files so it opens without a network. It never stores your data.",
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
              "Cloudflare hosts this website (plainphone.org).",
              "Quad9 and Mullvad, with Cloudflare as a fallback, answer allowed web filter lookups, as described above.",
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
                  "Until the account is deleted. There is no delete button yet, so ask us (see Your rights)",
                ],
                [
                  "Household, phones, apps, contacts, school time, filter settings",
                  "Until the phone or the household is removed. There is no button for either in the app yet, so ask us. A removed contact or schedule is deleted when the removal takes effect",
                ],
                [
                  "Latest position",
                  "Only the latest one. Deleted when you switch location off or remove the phone",
                ],
                [
                  "Changes that waited for the key on an adult’s own phone",
                  "Until the phone is removed",
                ],
                [
                  "Invitations",
                  "They stop working after 7 days. The record is not deleted automatically yet. You can withdraw an open invitation, and we can remove the rest when you ask",
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
              "leave a household (the last member cannot leave)",
              "log out, which ends the session",
            ],
          },
          "There is no button yet to rename or remove a phone, delete your account, download your data or remove an expired invitation. Ask us for these (see Who is responsible). Removing a phone deletes everything stored about it and asks the web filter to forget its ClientID. We check that you control the email address before we change or delete anything, and we aim to answer within a month.",
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
  footer: {
    maintained: "Plainphone is maintained by <a href=\"https://mahoje.dk\">Mahoje</a> in Denmark.",
    privacy: "This site sets no cookies and runs no analytics. <a href=\"/privacy/\">Privacy policy</a>.",
    license: "Code under <a href=\"https://github.com/plainphone/plainphone/blob/main/LICENSE\">Apache-2.0</a>. Font: Atkinson Hyperlegible Next, <a href=\"/fonts/OFL.txt\">SIL OFL</a>.",
  },
  notFound: {
    title: "Page not found",
    body: "There is nothing at this address.",
    back: "Go to the front page",
  },
};
