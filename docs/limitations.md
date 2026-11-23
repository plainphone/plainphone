# Known limitations

Plainphone reduces what a phone can reach. It does not make a phone safe, and some things cannot be
blocked by any app. This page lists what Plainphone cannot block today, per mode, what strong mode
needs, what has not run on a real phone yet and how the Google Play edition differs. Each item
links to the details.

Plainphone is in public alpha. It has had little testing on real phones and no external security
audit. The [bypass checklist](bypass-checklist.md) is how a phone gets tested. A way around the lock
that is not on this page is a security bug: report it privately as described in
[SECURITY.md](../SECURITY.md).

## Both modes

- **The web filter blocks whole domains.** It does not see pages inside a site or traffic sent
  straight to an IP address, and its lists cannot know every site.
  [What private DNS covers](dns-bypass.md#what-private-dns-covers)
- **Apps with their own way to the internet** can get around the filter: their own encrypted DNS on
  an unknown address, built-in IP addresses, or a built-in proxy (Telegram, Opera's browser VPN,
  Tor-based apps). The Plainphone DNS server blocks the names of public DNS-over-HTTPS services,
  which covers most apps. Every app a parent allows adds to this risk.
  [Apps a parent might allow](dns-bypass.md#apps-a-parent-might-allow)
- **Calls and chats inside messenger apps** (WhatsApp, Signal, Snapchat and similar) are not limited
  to approved contacts. No Android API lets another app filter them. They stay closed unless a
  parent allows them. [Contacts: not covered yet](contacts.md#not-covered-yet)
- **MMS and group messages** are dropped while Plainphone is the SMS app, also from approved
  contacts. RCS chat is off then too, so messages fall back to SMS.
  [Contacts: not covered yet](contacts.md#not-covered-yet)
- **Voicemail** can be called only once its number is added as a contact. Visual voicemail is not
  handled. [Contacts: not covered yet](contacts.md#not-covered-yet)
- **Preinstalled apps with SMS permission** (some carrier apps, sometimes the assistant) may send or
  read SMS without Plainphone.
  [Checklist row C18](bypass-checklist.md#calls-and-messages-phase-2)

## Strong mode

- **A factory reset from recovery mode**, and on Samsung flashing in Download mode, cannot be
  blocked by any app. Afterwards, Factory Reset Protection can ask for a Google account, but only
  with Google Play services, only if a Google account was linked or signed in, and not on a phone
  whose bootloader was already unlocked. A new account can take 72 hours to work. Test it on the
  exact model (checklist row R5) before relying on it.
  [Factory reset protection](policies.md#factory-reset-protection)
- **Plain DNS sent straight to a public resolver** by IP address gets past private DNS. No app
  allowed by default is known to do this. The always-on VPN that would close it is not built.
  [Always-on VPN as a later layer](dns-bypass.md#always-on-vpn-as-a-later-layer)
- **Some system apps refuse to be hidden.** The status screen lists them.
  [What Android does not let us block](policies.md#what-android-does-not-let-us-block)
- **App clones** (Dual Messenger and similar) may still appear on some makers' phones. Plainphone
  removes the extra profile at the next lock check, within 15 minutes, or reports that it could not.
  [Checklist row A10](bypass-checklist.md#installing-apps)
- **On Android 10, Force stop** of Plainphone is possible outside install windows. Restrictions
  already set stay in place.
  [Force stop during an install window](policies.md#force-stop-during-an-install-window-android-10)
- **The system check** can be fooled by a rooted phone that uses a leaked attestation key.
  [System check](bypass-checklist.md#system-check)
- **Web shortcuts** ("Add to home screen") are allowed. Only the web filter applies to them.
  [Checklist row A7](bypass-checklist.md#installing-apps)

## Light mode

Light mode adds friction. It is not a lock, and the dashboard says so.
[What can be got around](light-mode.md#what-can-be-got-around)

- **Apps are closed after they open, not hidden.** A quick child sees the first frame.
- **A factory reset from Settings** removes Plainphone. The parent sees the phone go offline.
- **Safe mode** starts the phone without Plainphone until the next normal restart.
- **Switching Plainphone off in Settings** is blocked by reading the screen. An unusual Settings
  layout or language may slip through. The parent is told.
- **New apps can be installed.** Each one is closed as soon as Android announces it, until the
  parent allows it.
- **The default phone and SMS app** can be changed. Calls and SMS are then unfiltered until
  Plainphone is chosen again. The parent sees it.
- **Another VPN, or Private DNS set to another address,** takes over from the web filter. The parent
  sees the missing filter. [What the VPN does not do](light-mode-vpn.md#what-it-does-not-do)
- **Chrome's incognito mode and its own secure DNS setting** can only be locked in strong mode.
- **Picture-in-picture on Android 10** can keep some apps floating above the stop screen. This
  still has to be checked on real phones (checklist row L-T8).
- **adb and a computer** get around everything.

## Open mode

[Open mode](open-mode.md#limits) allows every app except the ones on the block list.

- **A newly installed app on the block list** can open for a few seconds, until the phone has synced.
- **The lists of known apps** cannot cover every betting or social app. Block the rest one by one.

## What strong mode needs

- **A factory reset first.** Strong mode is set up by scanning a QR code on the first setup
  screen, so everything on the phone is erased. Light mode needs no reset.
  [Set up a test phone](setup-test-phone.md)
- **Android 10 or newer.** Android 14 or newer gives the full lock. On Android 10 to 13 someone can
  switch back to the built-in phone app, app cloning is not blocked by Plainphone, and Android 10
  has no factory reset protection with chosen accounts.
  [What works on which version](android-versions.md#what-works-on-which-version)
- **Wi-Fi without a login page, or mobile data,** during setup.
- **Google Play Protect may block the setup** on phones with Google Play services, because
  Plainphone is not on Android Enterprise's list of approved apps. Nobody has tried it on a real
  phone yet (issue #255). [The open question](setup-test-phone.md#3-scan-the-qr-code)
- **Factory reset protection needs Google Play services** and a linked Google account. Without
  them nothing stops a reset from bringing the phone back as new.
  [Factory reset protection](policies.md#factory-reset-protection)

## Not yet tried on a real phone

The emulator suite runs on Android 10 and 14 for every merge, but these have not run on a
physical phone yet:

- **The bypass checklist** as a whole: its result log is still empty.
  [Result log](bypass-checklist.md#result-log)
- **The fallbacks on Android 10 to 13:** the phone app dialog, sending SMS, location, and the
  incoming call notification. [Android versions](android-versions.md#not-yet-tested-on-a-real-phone)
- **Calls and messages on Samsung and Xiaomi,** whose phone apps may behave differently around
  roles and call screening. [Contacts: not covered yet](contacts.md#not-covered-yet)
- **Sync timing in Doze** and location on Samsung and Xiaomi. [Phone sync](phone-sync.md#not-done-yet)
- **QR setup with Play Protect** (above) and **"Block connections without VPN"** in light mode.
  [Always-on VPN](light-mode-vpn.md#always-on-vpn-and-block-connections-without-vpn)

## The Google Play edition

The app on Google Play is a smaller build than the one on GitHub Releases and F-Droid, to follow
Play's policies. [The Play edition](play/play-edition.md)

- **Light mode and the Child profile only.** No strong mode and no Myself profile. For those,
  install the GitHub edition.
- **No device admin,** so Plainphone can be uninstalled from Settings. Plainphone closes the
  uninstall screens, and the parents see the phone go quiet if it is removed anyway.
  [No device admin](play/play-edition.md#no-device-admin)
- **Updates come from Google Play,** not from the dashboard's **Update now**.
- **A notification is always shown** while Plainphone is on, and the guard and location each get
  their own explanation screen before Android asks.

## The hosted test service

- **Up to 10 phones per family** on app.plainphone.org (`HOUSEHOLD_PHONE_CAP`). Phones already
  set up keep working; only adding one more is refused. Your own server has no cap unless you set
  one. [Phones per household](operations.md#phones-per-household)
- **A limited number of new families per day** when the daily cap is on. People who already have
  an account always get in. [Daily cap](operations.md#daily-cap-on-new-households)
- **The service can read the data you put in it.** End-to-end encryption is not built yet.
  [Privacy](privacy.md)
