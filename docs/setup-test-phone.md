# Set up a test phone

This guide puts Plainphone (phases 1 and 2) on a spare Android phone. **The phone is factory reset, and everything on it is erased.**

You need:

- an Android 10 or newer phone (Settings → About phone → Android version). Android 14 or newer gives the full lock; on Android 10 to 13 a few things work differently, see the table below and [android-versions.md](android-versions.md);
- Wi-Fi without a login page (hotel and school portals do not work during setup), or a SIM card with mobile data;
- the QR code: in the dashboard (app.plainphone.org or your own server) choose *Add phone*, choose a language, pick a maintenance PIN, and keep the page with the QR code open on another screen. Or make one with `scripts/provisioning-qr.py` and show it on another screen or printed;
- the maintenance PIN that belongs to that QR code;
- for phase 2: a SIM card, and a second phone to call and text from.

For phase 2, build the QR code with your own number as an approved contact, for example `--country-code 45 --contact 'Me=+45 12 34 56 78'`. More contacts can be added on the phone later.

Total time: 10 to 15 minutes.

### What works on which Android version

| | Android 14+ | Android 10 to 13 |
|---|---|---|
| Lock, hidden apps, DNS filter, SMS contacts, sync, schedules, Find | yes | yes |
| Plainphone becomes the phone app | by itself | tap **Set as default** in Android's dialog (during setup on 12 and 13, right after it on 10 and 11) |
| Phone app locked in Settings | yes | no: someone can switch back to the built-in dialer, and calls are then unfiltered until Plainphone is chosen again. The dashboard shows it as a failure |
| App cloning blocked | yes | not blocked by Plainphone (maker features like Dual Messenger exist): test with the bypass checklist |
| Factory reset protection with chosen accounts | yes | Android 11 to 13; not on Android 10 |

Android 9 and older cannot be used: the phone says "Can't set up device" after the scan.

## 1. Before the reset

1. Take out anything you want to keep.
2. Remove the Google account from the phone (Settings → Accounts → Google → Remove account). Otherwise Factory Reset Protection asks for that account after the reset, and setup gets slower.
3. Samsung: also sign out of the Samsung account, because Samsung's own reactivation lock asks for it.
4. Charge the phone to at least 50 %.

## 2. Factory reset

Settings → System → Reset options → Erase all data (factory reset). On Samsung: Settings → General management → Reset → Factory data reset.

## 3. Scan the QR code

1. When the phone starts on the first welcome screen ("Hi there" / "Welcome", with a language button), **tap the same empty spot on the screen 6 times** quickly. Do not press "Start".
2. A QR reader opens. If the phone says it needs to connect to the internet first, pick your Wi-Fi.
3. Scan the QR code.
4. The phone downloads Plainphone, checks its signature and says that the phone belongs to an organisation and is managed. Accept.
5. The phone may show more setup screens (Wi-Fi, Google services, PIN code). Set a screen lock if you like. **Do not sign in with a Google account** for this test.
6. Setup finishes on the home screen.

If the phone says "Can't set up device" or "The app couldn't be downloaded", see the troubleshooting section below.

## 4. Check that the lock is on

For a strong-mode Child phone, start Android setup in one language and make a QR
code with a different language and the household time zone. Check that Android
uses the QR language and time zone after setup, and that changing the system
language in Settings is blocked. In the dashboard, switch **Plainphone language**
and wait for sync. Check the launcher, calls, messages, contacts and Maintenance.
Android Settings should still use the setup language. Select **Use phone language**
and verify Plainphone returns to the system language. Check on Android 10–12 and
Android 13 or newer. Repeat for Light and Myself and check that Android Settings
still lets the user change the system language. After releasing the strong-mode
Child phone, check that the system language can be changed again.

1. Open the **Plainphone** app. It should say "Locked: Plainphone is Device Owner".
2. The list below it shows each policy with `OK` or `FAIL`. Everything should say `OK`. `FAIL private DNS` right after setup usually means the phone was still offline. Open the app again later, and it tries again.
3. The home screen should only show phone, messages, camera, clock, contacts, settings, Chrome, Maps and a few small apps. Play Store, YouTube, Gmail and games are gone.
4. Android 10 to 13: Android asks "Set Plainphone as your default phone app?" (during setup on Android 12 and 13, when Plainphone opens after setup on 10 and 11). Tap **Set as default**. If you miss it, open Plainphone again and it asks again. If "Don't ask again" was ticked: Settings → Apps → Default apps → Phone app → Plainphone.
5. Phase 2: the status screen also says "Phone app: Plainphone." and "SMS app: Plainphone.", and the lines `default phone app`, `default SMS app` and `phone and SMS permissions` say `OK`. The home screen has Plainphone's **Phone** and **Messages** icons. The maker's messages app is gone; the maker's own phone app stays (it is the emergency fallback, see [contacts.md](contacts.md)).
6. To add or remove approved contacts: tap "Version" 7 times, enter the PIN, choose "Approved contacts and blocked log". Once the phone is paired (step 7), the list comes from the dashboard and is read-only here.
7. Pairing. **QR code from the dashboard:** the phone pairs by itself and shows the masked account and household when connected. The dashboard page with the QR code switches to "connected" within a few seconds. **QR code from the script:** the phone shows **Pair with a parent** with a code and a QR code. On your own phone, sign in at app.plainphone.org (or your own server), scan the code with the camera, or choose *Add phone*, *Type the code*. Either way the status screen then shows "Paired. Last sync: …". Change something in the dashboard (hide an app, add a contact) and check that it reaches the phone within a minute while its screen is on. If pairing did not happen, use the button on the status screen (first hour) or the maintenance screen.

Then work through [bypass-checklist.md](bypass-checklist.md).

## 5. Getting out again

There are three ways out, from gentle to drastic.

**Lift the lock for a while.** In the Plainphone app, tap "Version" at the bottom 7 times, enter the PIN and choose "Lift the lock for 30 minutes". Every restriction is removed and all apps come back. The lock returns after 30 minutes or at the next reboot. To lock at once, choose "Apply the lock now" on the same screen.

**Release the phone completely.** Same screen, choose "Release Device Owner (test phones)" and confirm. Plainphone stops being Device Owner and removes every restriction. Afterwards you can uninstall Plainphone and factory reset the phone from Settings as usual.

**Recovery reset (emergency).** If you have forgotten the PIN or the app does not open: turn the phone off, then start it with the key combination for recovery mode. On most phones that is Power + Volume up. Samsung phones from 2020 onwards need a USB cable connected to a computer while you hold Power + Volume up. Choose "Wipe data/factory reset". This always works, because no app can block recovery. If a Google account was on the phone, or FRP accounts were set in the QR code, the phone asks for that account afterwards.

## Using adb on the test phone

Plainphone blocks developer options and adb. To use adb, lift the lock first (see above), then turn on developer options and USB debugging. When the lock returns, adb is cut off again.

Without a QR code, a freshly reset phone with no accounts can also be made Device Owner over adb, which is handy for development:

```sh
adb install plainphone.apk
adb shell dpm set-device-owner org.plainphone.app/.PlainphoneAdminReceiver
```

Open Plainphone and check that the lock, including the adb block, is on. This path does not get the QR settings (PIN, DNS host), so the test PIN `000000` applies.

## Troubleshooting

| Problem | Likely cause | What to do |
|---|---|---|
| Tapping 6 times does nothing | Not the very first screen, or the phone is older than Android 7 | Go back to the first welcome screen and tap one spot in the middle |
| "Can't set up device. Can't use the admin app. It's missing components or corrupted." | The phone runs Android 9 or older (Plainphone 0.1.2 and earlier needed Android 14), or the checksum does not match the APK | Check the Android version. Then build a new QR code with `--apk` set to exactly the file at `--apk-url` |
| "Can't set up device" right after the scan | Checksum does not match the APK | The QR code was built for a different APK. Build a new one with `--apk` set to exactly the file at `--apk-url` |
| "Couldn't download the app" | No internet, a login portal, or the URL is wrong | Use a normal Wi-Fi or mobile data. Open the URL on a PC to check that it downloads |
| Setup ends but the Plainphone app says "Not locked" | Provisioning fell back to a normal app install | Factory reset and scan again; note the phone model and Android version in the issue |
| `FAIL private DNS` stays | The DNS host does not answer DNS-over-TLS on port 853 on that network | Try another network. Some networks block port 853 |
