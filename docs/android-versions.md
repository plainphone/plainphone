# Android versions

Plainphone runs on **Android 10 (API 29) and newer**. The idea is to reuse old phones, so the app
uses the newest Device Owner API where it exists and an older call with the same meaning below it.
Every switch is a `Build.VERSION.SDK_INT` check in the code, and lint (`NewApi`) is clean at minSdk 29.

## Why not lower than Android 10

Three things Plainphone cannot do without are missing on Android 9 and older:

- **The DNS filter:** `DevicePolicyManager.setGlobalPrivateDnsModeSpecifiedHost` and `DISALLOW_CONFIG_PRIVATE_DNS` arrived in Android 10.
- **The SMS app:** `DevicePolicyManager.setDefaultSmsApplication` arrived in Android 10. Without it, approved contacts cannot be enforced for SMS.
- **The phone app:** `RoleManager` and the dialer role arrived in Android 10. Before that there is no supported way to become the phone app that sees every call.

A Plainphone on Android 9 would have no filter and no contact rules, so the app does not install there.

## What works on which version

| Feature | Android 14+ (API 34+) | Android 12 and 13 (API 31-33) | Android 11 (API 30) | Android 10 (API 29) |
|---|---|---|---|---|
| QR setup as Device Owner | yes | yes (setup asks Plainphone for the mode, then the lock is applied before the home screen) | yes (lock applied when setup finishes) | yes (lock applied when setup finishes) |
| Hide apps, block installs, reset, safe mode, other users, adb | yes | yes | yes | yes |
| DNS filter (private DNS forced and locked) | yes | yes | yes | yes |
| Default **SMS** app set silently | yes | yes | yes | yes |
| Default **phone** app | set silently by Device Owner | Android's own "set as default phone app" dialog, shown during setup | same dialog, shown when Plainphone opens after setup | same as Android 11 |
| Default apps locked in Settings (`DISALLOW_CONFIG_DEFAULT_APPS`) | yes | no, see below | no | no |
| Approved contacts for calls | yes | yes, once the phone app dialog is accepted | same | same |
| Approved contacts for SMS | yes | yes | yes | yes (sending uses `SmsManager.getDefault()` below Android 12) |
| App cloning blocked (`no_add_clone_profile`) | yes | not blocked by Plainphone: the AOSP clone profile came with Android 14, but maker features such as Samsung Dual Messenger and Xiaomi Dual apps exist on older versions. Test them with the bypass checklist | same | same |
| Private space blocked | Android 15+ | not available (no private space) | same | same |
| Automatic date, time and time zone required | yes | yes | yes | only automatic time (`setAutoTimeRequired`); manual changes are still blocked by `DISALLOW_CONFIG_DATE_TIME` |
| Factory reset protection with chosen Google accounts | yes | yes | yes | no: Android's normal FRP applies |
| Location on for "Find" | `setLocationEnabled` | same | same | `LOCATION_MODE` through `setSecureSetting` |
| One position for "Find" | `getCurrentLocation` with a quality request | same | `getCurrentLocation` without a request | `requestSingleUpdate` |
| Call notification with answer and decline | call style | call style | plain notification with two buttons | same |
| Speaker and mute in a call | call endpoints | `CallAudioState` (`setAudioRoute`) | same | same |
| Notification permission granted | yes | Android 13 only; Android 12 has no such permission | not needed | not needed |
| Sync with the dashboard (WorkManager), token in Keystore (AES-GCM) | yes | yes | yes | yes |
| Schedules (school time, bedtime) | yes | yes | yes | yes |

## The phone app on Android 10 to 13

Android 14 lets a Device Owner set the default phone app without asking. Older versions only let the
user choose, so on Android 10 to 13:

1. Android shows the dialog "Set Plainphone as your default phone app?". On Android 12 and 13 it comes during setup, before the home screen; on Android 10 and 11 it comes when Plainphone opens right after setup. The parent taps **Set as default**.
2. Until that happens, the status screen says "Phone app: not Plainphone. Calls are not filtered.", the line `default phone app` says `FAIL` with "confirm Plainphone as phone app on the phone", and the parent's dashboard shows the lock as not intact. Each time Plainphone is opened, it asks again.
3. If "Don't ask again" was ticked in the dialog, Android no longer shows it. Then set it by hand: Settings → Apps → Default apps → Phone app → Plainphone.
4. The maker's extra phone apps are hidden whether or not Plainphone holds the role. The built-in (system) dialer stays, because Android falls back to it for emergency calls.

**The gap:** without `DISALLOW_CONFIG_DEFAULT_APPS`, someone holding the phone can go to
Settings → Apps → Default apps and pick the built-in dialer as the phone app. **From then on calls are
not filtered at all**, neither incoming nor outgoing, until Plainphone is the phone app again. The
maker's extra dialers and SMS apps stay hidden, so the built-in dialer is the only other choice. The
next lock check (at the latest within 15 minutes, and every time Plainphone is opened) marks
`default phone app` as failed, the dashboard shows the lock as not intact, and Plainphone asks again
when it is opened. SMS is not affected: no other SMS app can be chosen. Bypass checklist row C13
covers this test. For a child who will try this, use a phone with Android 14 or newer.

## Not yet tested on a real phone

The fallbacks are covered by unit tests (Robolectric at API 29, 30 and 35, plus the policy logic at
API 29-34). As of version 0.1.3 they have not been tried on a real Android 10-13 phone, and no emulator
could run on the build machine. Things to watch in the first test:

- the phone app dialog during setup (Android 12 and 13) and right after it (Android 10 and 11),
- sending an SMS on Android 10 and 11,
- location on through `LOCATION_MODE` on Android 10,
- speaker and mute during a call,
- the incoming call notification on Android 10 and 11.
