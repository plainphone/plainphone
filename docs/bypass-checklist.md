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
| R3 | Disable or force-stop Plainphone | Disable is not offered. Android 11+: Force stop and Clear data are greyed out (`setUserControlDisabledPackages`). Android 10: Force stop is allowed outside install windows; restrictions already set stay in place. While an install window or **Allow accounts briefly** is open, Plainphone sets `DISALLOW_APPS_CONTROL` and Settings refuses Force stop ("Disabled by your admin") until the restrictions are back ([design](policies.md#force-stop-during-an-install-window-android-10)) | Settings → Apps → Plainphone. On Android 10, repeat during an open catalog window and an open fallback window: Force stop must be refused, and `adb shell dumpsys user \| grep no_control_apps` must show the restriction. After the window closes, Force stop is offered again. Then retry A1 and R1 |
| R4 | Remove Plainphone as device admin | Not offered | Settings → Security → Device admin apps |
| R5 | Reset from recovery with a parent's FRP account set | **Destructive.** Does setup accept the child's previous screen-lock PIN? Record whether the PIN alone completes setup. Then check that the parent's linked Google account can complete setup | Last, on the test phone only. Use an established Google account, OEM unlocking off, and wait until the phone reports reset protection set |
| R6 | Add or remove an account in strong mode | Settings, Play, Chrome and YouTube block adding an account. Verify the parent-PIN catalog flow and its fallback on a physical phone (recipe below) | Settings → Accounts |
| R7 | Clear Plainphone's data | Not offered for a Device Owner | Settings → Apps → Plainphone → Storage |
| R8 | Reset app preferences / reset network settings | App preferences can be reset but do not show hidden apps. Network reset is blocked | Settings → System → Reset options |
| R9 | Remote erase with a signed-in test account | **Destructive.** Record what setup asks for after the erase. Keep separate from R5 since the reset path differs | Optional, on the test phone only |
| R10 | Force stop and maintenance expiry | On Android 11+, Force stop and Clear data should be unavailable. On Android 10 they are unavailable during install and account windows (R3). A maintenance unlock does not take them away: the parents hold the phone. Let a 30-minute maintenance unlock expire with the screen off and check that the lock returns | Settings → Apps → Plainphone. On OnePlus Android 10, also try the maker's "close all apps" in recents during an install window and record whether it force-stops Plainphone (residual risk) |

### R6 on a physical phone

1. Run `adb shell dumpsys user | grep no_modify_accounts`. Verify that ordinary approved app installation and a wrong parent PIN both keep account changes blocked.
2. Add the parent's Google account during a maintenance unlock, then end maintenance. On a debug build, inspect the Google sign-in baseline in `CatalogAccounts.start`. The Google fingerprint set must be non-empty with the known account present. Record only whether the count is positive.
3. Try catalog Google sign-in with the correct PIN. If Play services rejects restricted sign-in, select **Allow accounts briefly**. Exactly one new Google account must restore `no_modify_accounts` before Play opens, with no dashboard warning. Repeat with cancellation and with sign-in left open for three minutes. Both must restore the restriction. An initial restricted Google sign-in that completes after the catalog window closes must produce a dashboard warning and leave the account on the phone.
4. In separate fallback runs, press Home and use **Settings → Accounts** to remove an account visible to Plainphone or add a non-Google account visible to Plainphone. Verify immediate relock and the unexpected account change warning in the dashboard after sync.
5. During fallback, run `adb shell am kill org.plainphone.app` and verify the process exited. Android may keep the foreground watchdog alive. Once Plainphone restarts, confirm that `no_modify_accounts` is set again. On Android 10, Force stop must be refused during fallback (R3).
6. After relock, verify that **Settings → Accounts → Add**, Play's **Add account**, and Chrome and YouTube sign-in block adding a new account.
7. After a fallback times out with sign-in still open, verify that an account added before the next approved sign-in produces a dashboard warning. In a separate run, start a new approved sign-in after the timeout and verify that its successful addition does not produce a warning. The new request takes over account monitoring from the completed fallback.
8. Leave Google's sign-in screen open well past the catalog deadline plus 15 minutes (the marker has expired), then finish the login with a Google account that was never on the phone. The dashboard must show the unexpected account change warning once (approved accounts, #75).
9. During fallback, the dashboard and parent app must show "Account changes are allowed for an approved sign-in until HH:MM" with no protection alert, and the line must disappear after the relock.

### Residual risks

Accounts that an authenticator hides from the device owner are invisible to every public API. The same authenticator can already add and remove its own accounts programmatically despite DISALLOW_MODIFY_ACCOUNTS, and it can only reach the phone through a parent-approved catalog window. The fallback window (at most 3 minutes, started by the parent) therefore adds no new attack surface compared with main, where the account restriction does not exist.

For future hardening, consider `AccountManager.getAuthenticatorTypes()`, which is independent of account visibility.

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
| N15 | Light mode with the VPN filter: add a VPN while Settings is on a protected screen (split screen, or open the VPN screen right after a protected Settings page) | The Settings screen is sent back and the VPN consent dialog is closed within about a second, not left open. While the Settings screen is being sent back, closing the VPN dialog does not succeed at once; the VPN retries (50/150/300 ms) then close it | Light-mode phone, VPN filter active: open Settings → Apps → Plainphone → Force stop, then tap an app's "VPN" prompt or Settings → Network → VPN → add, and watch both close |

## Calls and messages (phase 2)

Before you start: add one approved contact on the maintenance screen (for example your own phone), and have a second phone whose number is **not** approved. See [contacts.md](contacts.md) for how the rule works.

| # | Attempt | Expected | How to test |
|---|---|---|---|
| C1 | Call the phone from a number that is not approved | The phone does not ring. The caller hears busy or is rejected. Nothing in the call log; the call shows under "Blocked" on the maintenance screen | Call from the second phone **[Emulator](testing.md):** a stranger's call from the emulator console is rejected and logged as blocked. Busy tone, the call log and hidden numbers (C2) remain physical checks. |
| C2 | Call from a hidden number (`#31#` before the number, or "Show my caller ID: off") | Rejected like C1, logged as "hidden number" | Hide caller ID on the second phone and call |
| C3 | Call from an approved number | Rings, can be answered, sound, mute, speaker and keypad work | Call from the approved phone |
| C4 | Call a number that is not approved from Plainphone's keypad | Refused with "Only approved contacts can be called" | Type the second phone's number and press call **[Emulator](testing.md):** the keypad, opened with the number as a `tel:` link opens it, shows this message and hands nothing to Telecom. |
| C5 | Call a number that is not approved from the maker's dialer, a contact card, or a `tel:` link in Chrome or Maps | The call is ended at once; a "Call not allowed" notification appears | The system dialer stays visible on purpose (emergency fallback). Try it, and try a phone number shown on a web page and in Maps **[Emulator](testing.md):** a call another app (the shell) places with `ACTION_CALL` is ended, logged and shows the notification. The maker's dialer, contact cards, Chrome and Maps remain physical checks. |
| C6 | Call 112 (or the local emergency number) | **Do not actually place an emergency call.** Check instead that 112 is not refused by Plainphone's keypad (the call screen opens), then hang up before it connects, or use the emergency number test mode if the carrier has one. Also check the lock screen's emergency button opens the emergency dialer | Ideally in a place where a dropped emergency call is expected and harmless, or skip and note **[Emulator](testing.md):** emergency numbers reach the intercepted Telecom boundary while ordinary calls are blocked, and the SOS emergency keypad opens. The lock-screen button and carrier test remain physical checks. |
| C7 | Emergency call-back | After an emergency call, incoming calls from any number ring for 60 minutes | Only test if C6 was done for real. Otherwise rely on the unit tests and note "not tested" |
| C8 | SMS from a number that is not approved | No notification, not shown in Messages, logged on the maintenance screen | Text from the second phone **[Emulator](testing.md):** a stranger's SMS from the modem gives no notification, is not in the inbox and is in the blocked log the maintenance screen shows. Opening the maintenance screen behind the PIN remains a physical check. |
| C9 | SMS from an approved number | Shown with a notification; reply works | Text from the approved phone and reply **[Emulator](testing.md):** an approved sender’s injected SMS reaches the inbox. Notification and real reply delivery remain physical checks. |
| C10 | SMS with a link from an approved contact | The link opens in Chrome and the DNS filter applies | Send `https://` link to a blocked site |
| C11 | Messenger apps (WhatsApp, Signal, Telegram) | Hidden by default. If a parent allows one, calls and chats in it are **not** covered by the list (documented). Note whether its in-app browser is filtered | Look for them; if allowed, call through them |
| C12 | Google Messages "Messages for web" / RCS | Google Messages is hidden once Plainphone is the SMS app and is not the SMS app, so it cannot send or pair with the web | Look for Messages; go to messages.google.com/web on a PC |
| C13 | Change the default phone app | On Android 14+, Android blocks the change. On Android 10–13, switch to the built-in dialer after granting both extra call roles. Repeat C1, C4, C5 and C6. Calls with hidden or unknown caller ID can bypass screening. Check that the dashboard reports the changed dialer and reopening Plainphone asks for the role | Settings → Apps → Default apps |
| C14 | MMS / group message from an approved contact | Dropped in phase 2 (documented). Note what the sender sees | Send a picture or a group message |
| C15 | Reply with a message from the incoming-call screen | Only sent if the caller is approved | Decline a call from an approved number with a quick reply |
| C16 | Voicemail | The voicemail number is blocked unless added as a contact (documented). Note whether missed calls from unknown numbers still reach voicemail | Call from the second phone, check the carrier's voicemail |
| C17 | Call or text from a contact written in another format (with/without +45, with spaces) | Matched as the same contact | Add `12 34 56 78`, call from `+4512345678` **[Emulator](testing.md):** a contact saved as `+1 202 555 0123` texts from the national `2025550123` (US SIM) and is shown under its name. The dashboard only stores numbers with a country code, so `12 34 56 78` can only be entered on the phone before pairing or in the QR code; that and calls in other formats remain physical checks. |
| C18 | Send an SMS through another app (Google Assistant "send a message to …", a carrier app) | Note whether it goes out without Plainphone. Expected: refused or routed through Plainphone (documented gap if not) | Ask the assistant, if visible, to text the second phone |
| C19 | Dial 114 and hang up at once, then call from the second phone | Still blocked: only a connected emergency call opens the call-back window | Dial 114, hang up before it connects, call from the second phone **[Emulator](testing.md):** 114 placed through Telecom and hung up opens no call-back window, and a stranger's call is still rejected. The emulator's modem answers after about a second, so hanging up before it connects, and urgent numbers, remain unit tests and physical checks. |
| C20 | Outgoing calls when the rules cannot be read (needs a debug build that makes the read throw; the child cannot cause this) | Only the parents and 112 can be called, any other call ends with "Plainphone cannot check this number right now". With the parents' file deleted (`plainphone_parent_numbers`, device-protected storage), calls stay open, which is documented | Sync once, make the rules read fail, call a parent, 112 and a stranger. Then clear the file and call a stranger |
| C21 | SMS from a stranger when handling fails (same debug build) | No notification and nothing in the message list. The text is under "Held for review" on the maintenance screen, behind the PIN. A message from a parent is shown as usual | Make the read fail, text the phone from a stranger and from a parent. Open the maintenance screen, then "Approved contacts and blocked log" |

## Time

| # | Attempt | Expected | How to test |
|---|---|---|---|
| T1 | Change date or time manually | Greyed out, automatic time is forced | Settings → System → Date & time **[Emulator](testing.md):** automatic time is forced and `DISALLOW_CONFIG_DATE_TIME` is set. On Android 11+, Android's time detector (behind Settings → Date & time) refuses to turn it off or take a manual time. A raw `settings put` from a privileged shell is not refused by Android; Plainphone's lock check sets it back. The greyed-out Settings screen remains a physical check. |
| T2 | Change time zone | Greyed out | Same **[Emulator](testing.md):** on Android 11+, automatic time zone is forced and the time zone detector refuses to turn it off or take a manual zone. Android 10 has no forced time zone, only the restriction that greys it out in Settings, which remains a physical check. |
| T3 | Airplane mode + reboot to stop time sync | Time stays roughly right (the clock keeps running). Note the result for phase 3 school time | Turn on airplane mode and restart |

Light mode lets the child set the clock, so the windows run on the server's time instead
([light-mode.md](light-mode.md#the-phones-clock)). Set a bedtime that starts in a few minutes first.

| # | Attempt | Expected | How to test |
|---|---|---|---|
| L-T1 | During bedtime, turn off automatic time and set the clock to 07:05 | Bedtime stays on. Within a minute the parent's page says the phone's clock shows the wrong time (once) | Settings → System → Date & time **[Emulator](testing.md):** the equivalent school-time window keeps blocking the app after a forward wall-clock jump. Bedtime and the parent warning remain separate checks. |
| L-T2 | Before bedtime, set the clock back an hour and wait for the real start | Bedtime starts on time | Same, then wait |
| L-T3 | Use a limited app, then set the date to tomorrow | The used minutes still count; the limit does not start again | Same, then open the app **[Emulator](testing.md):** a one-minute limit used up before a 35-day date jump still blocks the app after it. Real apps and longer limits remain physical checks. |
| L-T4 | Airplane mode, restart, set the clock to just before bedtime ends | Every window that may be on counts as on until the first sync; 112 and the parents can still be called | Restart with airplane mode on, then set the clock |
| L-T5 | After L-T4, turn airplane mode off | The phone syncs and the right windows come back within a minute | Turn airplane mode off |
| L-T6 | Use all emergency openings, then set the date to next month | None left: the month follows the server's time | Self phone with emergency openings on **[Emulator](testing.md):** one opening counted through the phone's opening store with a Self rule of one a month leaves none after a 35-day jump. The Self profile setup and the stop screen's button remain physical checks. |
| L-T7 | Use the 5 Play windows of the day, then set the date to tomorrow | No sixth window: the day follows the server's time | Maintenance PIN → Install an app, then change the date **[Emulator](testing.md):** five windows opened through the call the PIN screen makes, then none after a 35-day jump. Play itself (not on the AOSP image) remains a physical check. |
| L-T8 | Play a video in a blocked app, press Home so it floats in picture-in-picture (also: let its time limit run out while it plays there) | Within a second the stop screen shows and the floating window is dismissed or covered; the audio stops. 112 and the parents can still be called | Also: if the window does not close, the stop screen shows once, not every second, and a call stays usable. Open a video app that supports picture-in-picture, block it or use up its time, press Home. On Android 10 the window cannot be dismissed: the app must come back to full screen behind the stop screen and must not float again (check it with YouTube, which floats on Home). **[Emulator](testing.md):** revoking the test app while it is in PiP takes it out of PiP on Android 10 and 14. Audio, time-limit expiry and the call variants remain physical checks. |
| L-T9 | Same as L-T8 during an emergency opening of that app | It keeps playing until the opening ends (15 min), then it is closed | Self phone with emergency openings on |

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
