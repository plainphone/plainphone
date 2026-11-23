# Known limitations

Plainphone reduces what a phone can reach. It does not make a phone safe, and some things cannot be
blocked by any app. This page lists what Plainphone cannot block today, per mode, and links to the
details.

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
