// SPDX-License-Identifier: Apache-2.0
// English copy. Strings may contain trusted inline HTML (links, <em>).
export default {
  lang: "en",
  path: "/",
  title: "Plainphone | Android parental controls and a simpler phone",
  description: "Set up an Android as your child’s first phone or a simpler phone for yourself. Keep calls and essential apps, and choose which apps and websites to limit.",
  ogAlt: "Plainphone: Your phone, minus the noise. Calls, messages and camera are switched on; social media and the app store are off.",
  landing: {
    setup: "Setup",
    faq: "FAQ",
    menu: "Menu",
    start: "Get started",
    guide: "How to set it up",
    code: "See the code",
    security: "Security",
    help: "Product and help",
    project: "Project",
    languages: "Languages",
    day: ["Day one with Plainphone", "Pick Strong or Light mode in the parent dashboard.", "Choose who will use the phone.", "Follow the setup guide and connect the phone.", "Agree on the rules together and try a call and the apps you need."],
    childSees: "The phone shows which apps are available and how much time is left for apps with a limit. It tells your child when time is up and shows a notification when it sends its location.",
    privacyNote: "No cookies, analytics, tracking or third-party requests on this website.",
    groups: {
      gettingStarted: "Getting started",
      safety: "Safety",
      privacy: "Privacy",
      price: "Price",
      technical: "Technical",
      selfHosting: "Self-hosting",
    },
    questions: [
      ["gettingStarted", "Which phones work?", "Start with Android 10 or later. Check the setup guide for the tested model and the limits that apply to your Android version."],
      ["gettingStarted", "Can I keep school apps, Aula, MitID or BankID?", "You can allow apps a child needs. Aula and MitID are in the Danish app catalogue. Test sign-in and other essential functions on your specific phone before relying on them, including for BankID."],
      ["gettingStarted", "Can I use Plainphone as a dumbphone?", "Yes. Keep calls, texts and the apps you need, and leave distracting apps off the list. Choose Myself if you are setting up your own phone."],
      ["safety", "What if the phone is lost?", "If Find is enabled, you can request its location. The phone needs a connection to send a new location. Check the timestamp to see when the position was last updated."],
      ["safety", "Can my child still call 112?", "Yes. Plainphone always allows 112. Android places the emergency call."],
      ["safety", "What if I change my mind?", "Release the phone in the parent dashboard and wait for the online phone to confirm. You can then remove Plainphone or reset the phone in Android. Back up your files before a reset."],
      ["privacy", "What data do you keep and for how long?", "We keep account details and phone rules while you use the service. Decided requests are normally kept for 30 days and we keep 30 nightly database backups. If location is enabled, we store only the latest position. See the privacy policy for the full list."],
      ["privacy", "How do I delete my data?", "In Settings, choose Delete my account. Shared households keep their phones and rules for the other members. If you are the only member of a household with a Myself phone, remove that phone through its key first. The privacy policy explains when backups expire."],
      ["privacy", "Who is behind Plainphone?", "Mahoje in Denmark (CVR 39413892) maintains the project and operates the hosted service. The source code is public."],
      ["technical", "What does Plainphone do to battery life?", "It syncs in the background. Web filtering and optional location can also use battery. We have no battery life estimate. Some phones need a change to Android’s battery settings for reliable sync."],
      ["technical", "Do rules work offline?", "The phone keeps the last rules it received. It needs a connection to receive changes or send a new location."],
      ["selfHosting", "Can I host Plainphone myself?", "Yes. The self-hosting guide covers Docker, PostgreSQL, HTTPS and email for sign-in. Web filtering needs a separate DNS service."],
    ],
  },
  skip: "Skip to content",
  nav: { label: "Main", source: "Source code", language: "Language" },
  status: "Early version for testing.",
  compatibility: {
    path: "/apps/",
    title: "Does my app work with Plainphone?",
    lead: "Find Android apps and check which websites the web filter blocks by default.",
    label: "App or website",
    hint: "Try MitID or youtube.com. Package names and pasted links work too.",
    catalog: "Apps in the catalog",
    websites: "Known websites",
    noApps: "No match in the catalog. You can still allow other Android apps on the phone.",
    noWebsites: "No known website matches. The default filter status is unknown.",
    limits: "Catalog entries help you find and add apps. An app can use several domains, and this list covers selected websites only. Each phone’s settings and changes to filter lists can affect what opens.",
    filters: {
      social: "Social media · blocked by default on both profiles.",
      adult: "Adult content · blocked by default on both profiles.",
      gambling: "Gambling · blocked by default on both profiles.",
      games: "Games · blocked by default on both profiles.",
      dating: "Dating · blocked by default on both profiles.",
      video: "Video · blocked by default on both profiles.",
      youtube: "Video · strict Restricted Mode by default on a child’s phone and moderate Restricted Mode by default on a self-managed phone.",
      tracking: "Ads and tracking · blocked by default on both profiles.",
      help: "Health information · always available through the web filter.",
    },
  },
  hero: {
    title: "Your phone, minus the noise.",
    lead: "Plainphone turns an Android phone into a phone with calls, texts and the apps you choose.",
  },
  who: {
    title: "Who it’s for",
    paths: [
      {
        id: "child",
        title: "For my child",
        body: "Choose the apps and approved contacts together. Give your child more freedom as they grow.",
      },
      {
        id: "self",
        title: "For myself",
        body: "Use Myself to put a delay on rule changes or ask someone you trust to approve them, including by QR code. You can cancel a pending change.",
      },
    ],
  },
  how: {
    title: "How it works",
    lead: "You’ll need Android 10 or later. Choose a setup mode for your phone.",
    steps: [
      {
        title: "Strong mode",
        body: "Start with a new or reset phone to make the rules harder to bypass.",
      },
      {
        title: "Light mode",
        body: "Keep your existing setup and use app limits with gentler protection.",
      },
    ],
    guide: "Open the setup guide",
    available: "Available now: approved contacts, a web filter with categories, and optional text, call and contact history. You can also use the phone’s filter address on a router or VPN. Phone updates and server backups are supported.",
    note: "Coming soon: SOS.",
  },
  open: {
    title: "Open source",
    body: "Plainphone’s source code is public under the Apache-2.0 licence.",
    github: "View the code on GitHub",
    issues: "Report a bug publicly or suggest a change",
    privateReport: "Report a security or privacy flaw privately",
    contribute: "Read the contribution guide",
  },
  hosting: {
    title: "Run it on your own server",
    body: "You’ll need Docker with PostgreSQL, an HTTPS address and SMTP for sign-in emails. The Android phone connects to your server during setup. Open the parent dashboard at your own address, or build the native parent app with that address. Run a separate DNS service if you want web filtering.",
    guide: "Read the self-hosting guide",
  },
  price: {
    title: "Price",
    body: "Plainphone is free today. Running it on your own server and keeping one fully protected phone on our hosted service will always be free. Later we’ll charge for additional phones on our service. We’ll tell early users well in advance.",
    items: [
      {
        q: "What does it cost?",
        a: "It’s free today. Later, only additional phones on our hosted service will cost money.",
      },
      {
        q: "What will always be free?",
        a: "Self-hosting and one fully protected phone on our hosted service.",
      },
      {
        q: "What if I run it on my own server?",
        a: "Plainphone won’t charge you. You cover your own server and any services you use.",
      },
    ],
  },
  privacySummary: {
    title: "Privacy",
    body: "This website uses no cookies or analytics. Plainphone shows no ads and never sells your data.",
    link: "Read the privacy policy",
  },
  phones: {
    title: "Tested phones",
    body:
      "One so far: a OnePlus 5T on Android 10. Setup, the lock and the connection to the dashboard work, as the <a href=\"/setup/#tested\">setup guide</a> shows. It has not been through our <a href=\"https://github.com/plainphone/plainphone/blob/main/docs/bypass-checklist.md\">bypass checklist</a> on real hardware yet, and a phone counts as fully tested only after it has passed every test on that list. Until then, please treat Plainphone as an experiment.",
  },
  faq: {
    title: "Questions",
    items: [
      {
        group: "gettingStarted",
        q: "Does it work on iPhone?",
        a: "Plainphone protects a child’s Android phone. For parents, the iPhone app is in development. You can already use the parent dashboard in Safari.",
      },
      {
        group: "safety",
        q: "Can it be bypassed?",
        a: "Strong mode makes changes harder by protecting Android settings and app installation. Light mode uses permissions that can be removed, so it’s easier to turn off. Try the setup on your own phone before relying on it. A factory reset outside Android Settings can still erase the phone and remove Plainphone. With reset protection set up and working on that phone, setup can require the parent’s linked Google account before the phone can be used again.",
      },
      {
        group: "safety",
        q: "What about WhatsApp, Snapchat and other chat apps?",
        a: "Chat apps stay hidden unless you allow them, and approved contacts cover calls and texts, not what happens inside those apps. If a whole class is on one app, software will not fix that. Talking with the other parents often does.",
      },
    ],
  },
  why: {
    path: "/why/",
    h1: "Why Plainphone works the way it does",
    lead: "Plainphone is for families who want their child to have a phone while they wait to give them a full smartphone. Research helps us choose what to build.",
    sections: [
      ["Bedtime", "Having a phone in the bedroom is linked to poorer sleep in children and teens. Plainphone’s bedtime schedule limits which apps are available. The Danish Health Authority recommends leaving the phone outside the bedroom."],
      ["What the research can tell us", "Large studies find small average links between technology use and well-being. A National Academies review found too little evidence to establish a causal effect of social media on adolescent health across the population. We don’t know whether a restricted phone like Plainphone improves well-being. The Danish Wellbeing Commission recommends waiting until 13 for a smartphone or a tablet of the child’s own."],
      ["School time", "You choose when the schedule runs and which apps are available. Research on school phone rules is mixed, and we don’t know whether a schedule like this improves well-being."],
      ["Web filtering", "When configured, the filter blocks requests to web addresses in the categories you choose. It can reduce some exposure, and studies have found little evidence that filters change how often teens encounter sexual material. Filters can also block useful health information. Talk with your child about what they might come across."],
      ["Privacy, help and growing independence", "Children should be able to understand the rules, see when their location is shared and reach help privately. We use these principles when designing Plainphone. Revisit the rules together as your child grows."],
      ["For adults", "In a short study of a different app, a pause and the option to cancel gave people a chance to change their mind about opening an app. People cancelled less often as the study went on. That’s a reason to make cancelling easy when we design a pause."],
    ],
    sourcesTitle: "Sources",
    sources: [
      ["Carter et al. on devices and sleep", "https://doi.org/10.1001/jamapediatrics.2016.2341"],
      ["Danish Health Authority screen-use advice", "https://www.sst.dk/vidensbase/forebyggelse/anbefalinger-om-brug-af-skaerm"],
      ["Danish Wellbeing Commission recommendations", "https://regeringen.dk/aktuelt/nyheder/2025/trivselskommissionens-anbefalinger-er-klar/"],
      ["National Academies review of social media and adolescent health", "https://www.nationalacademies.org/read/27396/chapter/2"],
      ["Orben and Przybylski on digital technology and well-being", "https://www.nature.com/articles/s41562-018-0506-1"],
      ["Goodyear et al. on school phone policies", "https://doi.org/10.1016/j.lanepe.2025.101211"],
      ["Przybylski and Nash on internet filtering", "https://pubmed.ncbi.nlm.nih.gov/29995533/"],
      ["Richardson et al. on filters and access to health information", "https://doi.org/10.1001/jama.288.22.2887"],
      ["European Commission guidelines on minors", "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A52025XC05519"],
      ["UN Committee on the Rights of the Child, General Comment No. 25", "https://www.ohchr.org/en/documents/general-comments-and-recommendations/general-comment-no-25-2021-childrens-rights-relation"],
      ["Grüning et al. on the one sec app", "https://www.pnas.org/doi/10.1073/pnas.2213114120"],
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
              "the language chosen for Plainphone on the phone, if the adult picks one",
              "a few short facts the phone reports when it pairs, such as its model and Android version, and its latest status: battery level, app version, whether its lock is intact and which web filter address it uses. Each report replaces the one before",
              "if you turn on protection against reset, your household keeps your numeric Google account ID and when it was linked. Disconnect it in Household settings to delete it, or delete your Plainphone account. We do not store your Google email address or sign-in tokens for this feature",
              "for a phone in strong mode, the latest system check, including whether the bootloader is locked, the security patch level and the check time. Each check replaces the previous one, and removing the phone deletes it. We do not keep its certificate chain",
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
          "Location is a setting for each phone, with four choices: off; only when a parent presses Find; on Find and when an “Are you okay?” goes unanswered; or always on, every five minutes, for a time the parent picks (an hour, today or a week), after which it goes back to Find and “Are you okay?” by itself. A child’s phone starts with Find and “Are you okay?”, not always on. An adult’s own phone starts with location off, and turning it on is the owner’s choice. A parent can change it at any time.",
          "The phone is open about it. Each time it sends a single position (Find, or an unanswered “Are you okay?”), it shows a short notice saying so. When location is always on, the phone shows that the whole time, in a notification and on Plainphone’s own screen. The child can open “What can my parents see?” on the phone: it explains the current setting and lists each time the position was sent in the last 30 days. That list stays on the phone.",
          "“Are you okay?” asks the child to answer within a time the parent picks. If the child answers, no position is sent. If nobody answers in time, the phone sends one position. “Ring the phone” plays an alarm sound and vibrates for at most five minutes; it sends no position. The server keeps a ring or a question (times and the answer, and the approved number for “Call me”) for a day after it ends, then deletes it.",
          "A child can send an SOS with a time, battery level and one location when location is enabled. Parents can acknowledge it. The SOS history, including acknowledgment and location, is deleted after 30 days or when the phone is removed. When the server is unreachable, a fallback text can include a map link. Native notifications are relayed through Expo and Apple or Google. Map coordinates are sent to Google Maps only when a parent opens the link.",
          "The server keeps only the latest position: coordinates, accuracy and time. Each new position replaces the old one, and no history is kept. Switching location off, or removing the phone, deletes the stored position.",
          "The dashboard shows the position on a map. The map tiles come from OpenFreeMap (tiles.openfreemap.org, OpenStreetMap data), so loading them tells OpenFreeMap roughly which area is being looked at, along with the parent’s IP address. The map is only loaded on the location page. The parent app on a phone uses OpenStreetMap’s tile servers, and only after the parent taps Show map. If a parent chooses “Drive there” with Google Maps or Apple Maps, or copies the position, the coordinates go to that app, and its own policy applies from there.",
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
          "We send email only to run the service: sign-in links, invitations, the messages a trusted person gets, and an alert when a phone reports a required setting was switched off or it has been quiet for a long time. No newsletters and no ads. The mail is sent from our own mail server in the EU. The logo in our emails is loaded from plainphone.org, which Cloudflare hosts, so if your mail program shows images, Cloudflare sees your IP address when it fetches the logo. The logo’s address has no identifier and is the same for everyone, so it does not tell us who opened a mail.",
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
                [
                  "Setup code hashes and saved setup settings",
                  "Eligible for cleanup 30 days after the code expires. Removing the phone deletes them",
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
    h1: "Set up a phone",
    description: "Set up Plainphone on a new Android phone or one already in use, with a private setup code from your dashboard.",
    lead: "You need an Android 10 or newer phone and the dashboard open on a second device.",
    question: "Is the phone new or already in use?",
    strong: "It is new or reset",
    strongHelp: "Recommended. Plainphone can protect more settings on a fresh phone.",
    strongLanguage: "Before showing the QR code, choose the phone language. Android uses it during setup. You can change the language in Plainphone later from the phone settings in the dashboard.",
    light: "It is already in use",
    lightHelp: "Keep the phone’s data and turn protection on in Android settings.",
    startStrong: "Start setup for a new or reset phone",
    startLight: "Start setup for a phone in use",
    stepsLink: "See the steps",
    start: "In the dashboard, say who the phone is for and create a setup link.",
    lightSteps: [
      ["Open the download on the phone", "Scan the code from the dashboard with the phone’s camera, or open the private link in Chrome on that phone.", "lightScan"],
      ["Install Plainphone", "Download the app and open the file. If Android blocks it, tap Settings, turn on Allow from this source, go back and tap Install.", "download"],
      ["Return to Chrome and tap Open Plainphone", "Choose Child or Myself on the phone. Check the masked account and household, then choose a PIN of 6 to 12 digits and enter it twice. Follow the prompts to finish setup.", "permissions"],
    ],
    lightHelpItems: [
      ["Android says a setting is restricted", "On Android 13 or later, this can affect the phone app, messages app or guard. Open App info from Plainphone. Tap ⋮ (top right), then Allow restricted settings. Return to Plainphone and try again."],
      ["I set up the wrong phone", "Tap Undo setup in Plainphone within ten minutes of finishing light-mode setup. This switches Plainphone off and removes the phone from the dashboard when it can connect."],
      ["Android asks to start a VPN connection", "Tap OK. That is how Plainphone checks web addresses against your web filter."],
      ["I opened the app from the installer", "Go back to Chrome and tap Open Plainphone on the setup page. If you already entered a PIN on the phone, use that same PIN in the dashboard."],
    ],
    nextTitle: "Once the phone is connected",
    next: "In the dashboard, add contacts, choose apps from the catalog or set school hours.",
    steps: [
      {
        title: "Reset the phone",
        body: [
          "On a phone you need to reset, back up anything you want to keep, then choose Settings → System → Reset → Erase all data. Wait until the welcome screen appears.",
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
          "Scan the code from the dashboard, then choose a Wi-Fi network. The phone downloads Plainphone. When Plainphone opens, confirm whose phone it is and check the dashboard account shown on the phone.",
          "If the phone says it will be managed by an organisation, that is Plainphone. Accept: it is how the lock works.",
        ],
        fig: "scan",
      },
      {
        title: "Android 10 to 13 only: set the default phone app",
        body: [
          "After you confirm the dashboard account, the phone asks <em>Set Plainphone as your default phone app?</em> Tap <strong>Set as default</strong>. Missed it? Open the Plainphone app and it asks again.",
          "On Android 14 and newer this happens by itself.",
        ],
        fig: "dialog",
      },
      {
        title: "Allow Plainphone to run in the background",
        body: ["Tap <strong>Continue</strong>, then allow it in Android so Plainphone can update itself safely. If you skip this step, open Plainphone again to get the prompt."],
      },
    ],
    figs: {
      lightScan: "A phone camera framing a setup code.",
      download: "A phone screen with a download arrow.",
      permissions: "A phone screen with two settings switches.",
      reset: "A drawing of a phone showing a settings list, with the row for erasing all data marked.",
      welcome: "A drawing of a phone on its first welcome screen. Six taps in the same empty spot, marked “6×”.",
      scan: "Two drawings of a phone. On the first, a QR reader frames a QR code. On the second, a list of Wi-Fi networks with one chosen.",
      dialog: "A drawing of a phone with a dialog that has two buttons, “Set as default” and “Cancel”.",
    },
    drawing: { taps: "6×", set: "Set as default", cancel: "Cancel" },
    troubleTitle: "If something goes wrong",
    trouble: [
      ["Updates still don’t run", "OnePlus, Oppo, Xiaomi and Samsung may have extra battery settings. Allow background activity for Plainphone and remove it from sleeping apps if that option exists. Find the instructions for your model at <a href=\"https://dontkillmyapp.com/\">Don’t kill my app!</a>."],
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
    license: "Code under <a href=\"https://github.com/plainphone/plainphone/blob/main/LICENSE\">Apache-2.0</a>. Fonts: Schibsted Grotesk and IBM Plex Mono, <a href=\"/fonts/OFL.txt\">SIL OFL</a>.",
  },
  notFound: {
    title: "Page not found",
    body: "There is nothing at this address.",
    back: "Go to the front page",
  },
};
