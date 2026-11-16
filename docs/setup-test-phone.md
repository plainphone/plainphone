# Set up a test phone

This guide puts Plainphone phase 1 on a spare Android phone. **The phone is factory reset, and everything on it is erased.**

You need:

- an Android 14 or newer phone (Settings → About phone → Android version);
- Wi-Fi without a login page (hotel and school portals do not work during setup), or a SIM card with mobile data;
- the QR code from `scripts/provisioning-qr.py`, shown on another screen or printed;
- the maintenance PIN that belongs to that QR code.

Total time: 10 to 15 minutes.

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

1. Open the **Plainphone** app. It should say "Locked: Plainphone is Device Owner".
2. The list below it shows each policy with `OK` or `FAIL`. Everything should say `OK`. `FAIL private DNS` right after setup usually means the phone was still offline. Open the app again later, and it tries again.
3. The home screen should only show phone, messages, camera, clock, contacts, settings, Chrome, Maps and a few small apps. Play Store, YouTube, Gmail and games are gone.

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

The lock is applied at once, including the adb block. This path does not get the QR settings (PIN, DNS host), so the test PIN `000000` applies.

## Troubleshooting

| Problem | Likely cause | What to do |
|---|---|---|
| Tapping 6 times does nothing | Not the very first screen, or the phone is older than Android 7 | Go back to the first welcome screen and tap one spot in the middle |
| "Can't set up device" right after the scan | Checksum does not match the APK | The QR code was built for a different APK. Build a new one with `--apk` set to exactly the file at `--apk-url` |
| "Couldn't download the app" | No internet, a login portal, or the URL is wrong | Use a normal Wi-Fi or mobile data. Open the URL on a PC to check that it downloads |
| Setup ends but the Plainphone app says "Not locked" | Provisioning fell back to a normal app install | Factory reset and scan again; note the phone model and Android version in the issue |
| `FAIL private DNS` stays | The DNS host does not answer DNS-over-TLS on port 853 on that network | Try another network. Some networks block port 853 |
