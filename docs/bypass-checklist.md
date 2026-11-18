# Bypass checklist

Every attempt a curious child (or an adult on a bad day) might make, the result we expect from phase 1, and how to test it. Run it on a phone set up with [setup-test-phone.md](setup-test-phone.md), with the lock on (the Plainphone app says "Locked" and every line says `OK`).

Record each result in the table at the bottom of a copy of this file, with the phone model, Android version and Plainphone version. **Pass** means the attempt failed. **Fail** means the attempt worked, and that is a bypass. File it as a security issue (see [SECURITY.md](../SECURITY.md)).

## Installing apps

| # | Attempt | Expected | How to test |
|---|---|---|---|
| A1 | Install an app from Play Store | Play Store is not on the home screen. If reached via a link, the install is refused ("blocked by your admin") | Search for Play Store in the app drawer and in Settings → Apps. Open a `https://play.google.com/store/apps/details?id=...` link in Chrome |
| A2 | Install an APK downloaded in Chrome | Blocked: "Install unknown apps" is unavailable | Download any APK (for example F-Droid's) in Chrome and tap it |
| A3 | Install an APK from a USB stick or SD card | Storage is not mounted, and installs are blocked anyway | Plug in a USB-C stick or SD card with an APK |
| A4 | Copy an APK from a PC over USB | USB file transfer is not offered | Connect to a PC and pick "File transfer" in the USB notification |
| A5 | Nearby Share / Quick Share an APK from another phone | The file may arrive, but installing it is blocked | Send an APK from a second phone |
| A6 | Maker store (Galaxy Store, Xiaomi GetApps) | Hidden, and installs blocked | Look for the store; open a store link in Chrome |
| A7 | Install via a web app / "Add to home screen" | Allowed: a web shortcut is not an app. The DNS filter is what stops harmful sites | Add a site to the home screen, note what it is |
| A8 | Re-enable a hidden app from Settings → Apps | The app is not listed, or cannot be enabled | Search Settings → Apps for YouTube |
| A9 | Open a hidden app by a link (for example `youtube.com` opening the YouTube app) | Opens in Chrome or not at all, never in the hidden app | Tap a YouTube link in Messages |
| A10 | App cloning (Samsung Dual Messenger, Xiaomi Dual apps, OnePlus Parallel Apps) | Not available. If a phone still creates a clone (an extra Android user, often 999), the step `extra users and profiles` removes it at the next lock check (at the latest 15 minutes) or reports it as failed | Settings → Advanced features → Dual Messenger (Samsung); Settings → Apps → Dual apps (Xiaomi) |

## Resetting and removing Plainphone

| # | Attempt | Expected | How to test |
|---|---|---|---|
| R1 | Factory reset from Settings | Option is greyed out or refused | Settings → System → Reset options. If a reset confirmation appears, cancel it |
| R2 | Uninstall Plainphone | Not possible | Long-press the icon; Settings → Apps → Plainphone |
| R3 | Disable or force-stop Plainphone | Disable is not offered. Android 11+: Force stop and Clear data are greyed out (`setUserControlDisabledPackages`). Android 10: Force stop is allowed. Restrictions already set stay in place. Force stop during an open window leaves its lifted restriction off until Plainphone starts again (known residual risk) | Settings → Apps → Plainphone. On Android 10, repeat during an open fallback window and verify relock after restarting Plainphone. Then retry A1 and R1 |
| R4 | Remove Plainphone as device admin | Not offered | Settings → Security → Device admin apps |
| R5 | Reset from recovery with a parent's FRP account set | **Destructive.** Does setup accept the child's previous screen-lock PIN? Record whether the PIN alone completes setup. Then check that the parent's linked Google account can complete setup | Last, on the test phone only. Use an established Google account, OEM unlocking off, and wait until the phone reports reset protection set |
| R6 | Add or remove an account in strong mode | Settings, Play, Chrome and YouTube block adding an account. Verify the parent-PIN catalog flow and its fallback on a physical phone (recipe below) | Settings → Accounts |
| R7 | Clear Plainphone's data | Not offered for a Device Owner | Settings → Apps → Plainphone → Storage |
| R8 | Reset app preferences / reset network settings | App preferences can be reset but do not show hidden apps. Network reset is blocked | Settings → System → Reset options |
| R9 | Remote erase with a signed-in test account | **Destructive.** Record what setup asks for after the erase. Keep separate from R5 since the reset path differs | Optional, on the test phone only |
| R10 | Force stop and maintenance expiry | On Android 11+, Force stop and Clear data should be unavailable. On OnePlus Android 10, check the existing behavior and let a 30-minute maintenance unlock expire with the screen off | Settings → Apps → Plainphone |

### R6 on a physical phone

1. Run `adb shell dumpsys user | grep no_modify_accounts`. Verify that ordinary approved app installation and a wrong parent PIN both keep account changes blocked.
2. Add the parent's Google account during a maintenance unlock, then end maintenance. On a debug build, inspect the Google sign-in baseline in `CatalogAccounts.start`. The Google fingerprint set must be non-empty with the known account present. Record only whether the count is positive.
3. Try catalog Google sign-in with the correct PIN. If Play services rejects restricted sign-in, select **Allow accounts briefly**. Exactly one new Google account must restore `no_modify_accounts` before Play opens, with no dashboard warning. Repeat with cancellation and with sign-in left open for three minutes. Both must restore the restriction. A Google sign-in that completes late must produce a dashboard warning and leave the account on the phone.
4. In separate fallback runs, press Home and use **Settings → Accounts** to remove an account or add a non-Google account. Verify immediate relock and the unexpected account change warning in the dashboard after sync.
5. During fallback, run `adb shell am kill org.plainphone.app` and verify the process exited. Android may keep the foreground watchdog alive. Once Plainphone restarts, confirm that `no_modify_accounts` is set again. See R3 for force stop on Android 10.
6. After relock, verify that **Settings → Accounts → Add**, Play's **Add account**, and Chrome and YouTube sign-in block adding a new account.

## Safe mode, users and profiles

| # | Attempt | Expected | How to test |
|---|---|---|---|
| U1 | Safe mode (long-press "Power off" in the power menu) | No safe mode prompt, phone restarts normally | Hold the power button, long-press "Power off" |
| U2 | Safe mode from the boot key combination (Volume down while booting) | Starts normally without safe mode | Restart, hold Volume down |
| U3 | Add a user or a guest | Not available | Settings → System → Multiple users; quick settings user icon |
| U4 | Private space (Android 15+) | Not available | Settings → Security & privacy → Private space |
| U5 | Work profile / Samsung Secure Folder | Not available | Settings → Security → Secure Folder (Samsung); install a work profile is blocked anyway |
| U6 | Xiaomi Second space | Not available | Settings → Special features → Second space |

## Developer tools

| # | Attempt | Expected | How to test |
|---|---|---|---|
| D1 | Turn on developer options (tap build number 7 times) | Refused ("not available for this user" / "blocked by admin") | Settings → About phone → Build number |
| D2 | adb over USB | No USB debugging prompt, `adb devices` shows nothing | Connect to a PC and run `adb devices` |
| D3 | Wireless debugging | Not available | Same as D1 |

## Network filter

| # | Attempt | Expected | How to test |
|---|---|---|---|
| N1 | Change private DNS | Greyed out, shows the host from the QR code (`<id>.dns.plainphone.org`, or the placeholder `family.adguard-dns.com`) | Settings → Network → Private DNS |
| N2 | A known adult site in Chrome | Blocked (AdGuard Family block page or "site can't be reached") | Visit a well-known porn domain |
| N3 | Same in an in-app browser | Blocked | Open a link from Messages or Maps that opens inside the app |
| N4 | Chrome "Use secure DNS" with another provider | Setting is locked by the administrator | Chrome → Settings → Privacy and security → Use secure DNS |
| N5 | Chrome incognito | Not available | Chrome menu → New incognito tab |
| N6 | Google search without SafeSearch | SafeSearch is forced on | Search for an explicit term on google.com |
| N7 | VPN app or built-in VPN | Cannot add or connect | Settings → Network → VPN |
| N8 | Other Wi-Fi network (for example a phone hotspot) | Filter still applies: private DNS is global | Connect to a hotspot and repeat N2 |
| N9 | Mobile data instead of Wi-Fi | Filter still applies | Turn off Wi-Fi and repeat N2 |
| N10 | Network that blocks port 853 | **Known weak spot:** with a forced host, Android does not fall back to plain DNS, so the internet stops working rather than becoming unfiltered. Note what happens | Use a network that blocks DoT, if available |
| N11 | Install a user CA certificate (for a filtering proxy) | Not allowed | Settings → Security → Encryption & credentials → Install a certificate |
| N12 | Manual Wi-Fi proxy | Possible, but needs a proxy server; private DNS still applies to name lookups. Note result | Wi-Fi → Edit → Proxy → Manual |

## Calls and messages (phase 2)

Before you start: add one approved contact on the maintenance screen (for example your own phone), and have a second phone whose number is **not** approved. See [contacts.md](contacts.md) for how the rule works.

| # | Attempt | Expected | How to test |
|---|---|---|---|
| C1 | Call the phone from a number that is not approved | The phone does not ring. The caller hears busy or is rejected. Nothing in the call log; the call shows under "Blocked" on the maintenance screen | Call from the second phone |
| C2 | Call from a hidden number (`#31#` before the number, or "Show my caller ID: off") | Rejected like C1, logged as "hidden number" | Hide caller ID on the second phone and call |
| C3 | Call from an approved number | Rings, can be answered, sound, mute, speaker and keypad work | Call from the approved phone |
| C4 | Call a number that is not approved from Plainphone's keypad | Refused with "Only approved contacts can be called" | Type the second phone's number and press call |
| C5 | Call a number that is not approved from the maker's dialer, a contact card, or a `tel:` link in Chrome or Maps | The call is ended at once; a "Call not allowed" notification appears | The system dialer stays visible on purpose (emergency fallback). Try it, and try a phone number shown on a web page and in Maps |
| C6 | Call 112 (or the local emergency number) | **Do not actually place an emergency call.** Check instead that 112 is not refused by Plainphone's keypad (the call screen opens), then hang up before it connects, or use the emergency number test mode if the carrier has one. Also check the lock screen's emergency button opens the emergency dialer | Ideally in a place where a dropped emergency call is expected and harmless, or skip and note |
| C7 | Emergency call-back | After an emergency call, incoming calls from any number ring for 60 minutes | Only test if C6 was done for real. Otherwise rely on the unit tests and note "not tested" |
| C8 | SMS from a number that is not approved | No notification, not shown in Messages, logged on the maintenance screen | Text from the second phone |
| C9 | SMS from an approved number | Shown with a notification; reply works | Text from the approved phone and reply |
| C10 | SMS with a link from an approved contact | The link opens in Chrome and the DNS filter applies | Send `https://` link to a blocked site |
| C11 | Messenger apps (WhatsApp, Signal, Telegram) | Hidden by default. If a parent allows one, calls and chats in it are **not** covered by the list (documented). Note whether its in-app browser is filtered | Look for them; if allowed, call through them |
| C12 | Google Messages "Messages for web" / RCS | Google Messages is hidden once Plainphone is the SMS app and is not the SMS app, so it cannot send or pair with the web | Look for Messages; go to messages.google.com/web on a PC |
| C13 | Change the default phone app | On Android 14+, Android blocks the change. On Android 10–13, switch to the built-in dialer after granting both extra call roles. Repeat C1, C4, C5 and C6. Calls with hidden or unknown caller ID can bypass screening. Check that the dashboard reports the changed dialer and reopening Plainphone asks for the role | Settings → Apps → Default apps |
| C14 | MMS / group message from an approved contact | Dropped in phase 2 (documented). Note what the sender sees | Send a picture or a group message |
| C15 | Reply with a message from the incoming-call screen | Only sent if the caller is approved | Decline a call from an approved number with a quick reply |
| C16 | Voicemail | The voicemail number is blocked unless added as a contact (documented). Note whether missed calls from unknown numbers still reach voicemail | Call from the second phone, check the carrier's voicemail |
| C17 | Call or text from a contact written in another format (with/without +45, with spaces) | Matched as the same contact | Add `12 34 56 78`, call from `+4512345678` |
| C18 | Send an SMS through another app (Google Assistant "send a message to …", a carrier app) | Note whether it goes out without Plainphone. Expected: refused or routed through Plainphone (documented gap if not) | Ask the assistant, if visible, to text the second phone |
| C19 | Dial 114 and hang up at once, then call from the second phone | Still blocked: only a connected emergency call opens the call-back window | Dial 114, hang up before it connects, call from the second phone |

## Time

| # | Attempt | Expected | How to test |
|---|---|---|---|
| T1 | Change date or time manually | Greyed out, automatic time is forced | Settings → System → Date & time |
| T2 | Change time zone | Greyed out | Same |
| T3 | Airplane mode + reboot to stop time sync | Time stays roughly right (the clock keeps running). Note the result for phase 3 school time | Turn on airplane mode and restart |

## Maker-specific (Samsung)

| # | Attempt | Expected | How to test |
|---|---|---|---|
| S1 | Galaxy Store, Samsung Internet, Samsung Health | Hidden | Look in the app drawer |
| S2 | Bixby or Samsung's own browser in Edge panels or the lock screen | Hidden apps do not open | Swipe in the edge panel; Bixby key |
| S3 | Samsung DeX | Note whether it opens hidden apps | Connect to a monitor/PC if possible |
| S4 | Samsung Smart Switch restore of old apps | Installs blocked | Run Smart Switch from another phone |
| S5 | Maintenance mode (Settings → Battery and device care → Maintenance mode) | Should not be available (it creates a separate user) | Look for the option |
| S6 | Download mode / Odin flashing | **Cannot be blocked.** Afterwards as R5 | Only note, do not flash |

## Maker-specific (Xiaomi)

| # | Attempt | Expected | How to test |
|---|---|---|---|
| X1 | GetApps, Mi Browser, Themes, Games | Hidden | App drawer |
| X2 | "Install via USB" with a Mi account | Blocked | Developer options are blocked anyway |
| X3 | Xiaomi security app "Hidden apps" / App lock | Cannot show apps hidden by Plainphone | Security app |
| X4 | Battery saver kills Plainphone | The lock stays (it lives in the system). Android 11+: Plainphone is exempt from App Standby (`setUserControlDisabledPackages`), so the re-lock should come on time. Android 10: a maintenance unlock may not re-lock on time if the alarm is delayed; it always re-locks at the next reboot | Lift the lock, lock the screen for 40 minutes, check |

## Maintenance screen

| # | Attempt | Expected | How to test |
|---|---|---|---|
| M1 | Guess the PIN | From the 5th wrong PIN, each wrong PIN locks for 1, 2, 4 ... minutes. Force-stopping Plainphone or rebooting does not reset the count | Enter wrong PINs, force-stop the app, try again |
| M2 | Screenshot or screen recording of the PIN screen | Black / blocked (`FLAG_SECURE`) | Take a screenshot on the PIN screen |
| M3 | Lift the lock and wait | Lock returns after the set time | Lift for 30 minutes, check after 31 |
| M4 | Lift the lock and reboot | Lock returns at boot | Lift, restart, check |
| M5 | Release Device Owner | Everything is unlocked, Plainphone can be uninstalled | Do this last |

## DNS bypass by allowed apps (phase 2)

| # | Attempt | Expected | How to test |
|---|---|---|---|
| N13 | An allowed app with its own DNS-over-HTTPS | Only Chrome is allowed by default and its DoH is off. For any extra allowed app, note whether it reaches a blocked site. See [dns-bypass.md](dns-bypass.md) | Open a blocked site from inside each allowed app that can show web pages |
| N14 | A DoH resolver by hostname (`https://cloudflare-dns.com/dns-query`) | Blocked by the Plainphone resolver once phase 2's DNS is live (with the AdGuard placeholder: note the result) | Open the URL in Chrome |

## System check

A rooted phone can still report `verified` if it uses a leaked attestation keybox that has not been revoked. Treat a positive attestation as one check, and verify expected lock behavior on the actual phone.

## Result log

| # | Pass/Fail | Notes |
|---|---|---|
| | | |

Phone model: ________ Android version: ________ Security patch: ________ Plainphone version: ________
