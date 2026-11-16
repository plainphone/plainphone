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
| A10 | App cloning (Samsung Dual Messenger, Xiaomi Dual apps) | Not available | Settings → Advanced features → Dual Messenger (Samsung); Settings → Apps → Dual apps (Xiaomi) |

## Resetting and removing Plainphone

| # | Attempt | Expected | How to test |
|---|---|---|---|
| R1 | Factory reset from Settings | Option is greyed out or refused | Settings → System → Reset options |
| R2 | Uninstall Plainphone | Not possible | Long-press the icon; Settings → Apps → Plainphone |
| R3 | Disable or force-stop Plainphone | Disable is not offered. Force stop is allowed, but the lock stays, because restrictions live in the system | Settings → Apps → Plainphone; then retry A1 and R1 |
| R4 | Remove Plainphone as device admin | Not offered | Settings → Security → Device admin apps |
| R5 | Recovery reset (Power + Volume up at boot) | **Cannot be blocked.** The reset works. Afterwards: with FRP accounts or a previous Google account on the phone, it asks for that account; without one, the phone is free | Test once at the end. Note what the phone asks for after the reset |
| R6 | Samsung Find My Mobile / Google Find My Device remote erase | Works if the child knows an account on the phone. Then as R5 | Only if an account is signed in |
| R7 | Clear Plainphone's data | Not offered for a Device Owner | Settings → Apps → Plainphone → Storage |
| R8 | Reset app preferences / reset network settings | App preferences can be reset but do not show hidden apps. Network reset is blocked | Settings → System → Reset options |

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
| N1 | Change private DNS | Greyed out, shows `family.adguard-dns.com` | Settings → Network → Private DNS |
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
| X4 | Battery saver kills Plainphone | The lock stays (it lives in the system). Maintenance unlock may not re-lock on time if the alarm is delayed; it always re-locks at the next reboot | Lift the lock, lock the screen for 40 minutes, check |

## Maintenance screen

| # | Attempt | Expected | How to test |
|---|---|---|---|
| M1 | Guess the PIN | From the 5th wrong PIN, each wrong PIN locks for 1, 2, 4 ... minutes. Force-stopping Plainphone or rebooting does not reset the count | Enter wrong PINs, force-stop the app, try again |
| M2 | Screenshot or screen recording of the PIN screen | Black / blocked (`FLAG_SECURE`) | Take a screenshot on the PIN screen |
| M3 | Lift the lock and wait | Lock returns after the set time | Lift for 30 minutes, check after 31 |
| M4 | Lift the lock and reboot | Lock returns at boot | Lift, restart, check |
| M5 | Release Device Owner | Everything is unlocked, Plainphone can be uninstalled | Do this last |

## Result log

| # | Pass/Fail | Notes |
|---|---|---|
| | | |

Phone model: ________ Android version: ________ Security patch: ________ Plainphone version: ________
