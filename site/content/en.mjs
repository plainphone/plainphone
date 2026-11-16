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
        a: "As little as it can. When location arrives, only the phone’s last known position will be kept, never a history. No tracking, no ads, nothing sold. For adults managing their own phone, location will be off by default. Today there is no server, so nothing is collected at all.",
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
  footer: {
    maintained: "Plainphone is maintained by <a href=\"https://mahoje.dk\">Mahoje</a> in Denmark.",
    privacy: "This site sets no cookies and runs no analytics.",
    license: "Code under <a href=\"https://github.com/plainphone/plainphone/blob/main/LICENSE\">Apache-2.0</a>. Font: Atkinson Hyperlegible Next, <a href=\"/fonts/OFL.txt\">SIL OFL</a>.",
  },
  notFound: {
    title: "Page not found",
    body: "There is nothing at this address.",
    back: "Go to the front page",
  },
};
