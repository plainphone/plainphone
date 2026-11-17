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
| Default **phone** app | set silently by Device Owner | Android's own "set as default phone app" dialog, shown once when Plainphone opens after setup | same dialog | same dialog |
| Default apps locked in Settings (`DISALLOW_CONFIG_DEFAULT_APPS`) | yes | no, see below | no | no |
| Approved contacts for calls | yes | yes, once the phone app dialog is accepted | same | same |
| Approved contacts for SMS | yes | yes | yes | yes |
| App cloning blocked (`no_add_clone_profile`) | yes | not available (cloning profiles came with Android 14) | same | same |
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

1. Right after setup Plainphone opens and shows Android's dialog "Set Plainphone as your default phone app?". The parent taps **Set as default**.
2. Until that happens, the status screen says "Phone app: not Plainphone. Calls are not filtered.", the line `default phone app` says `FAIL` with "confirm Plainphone as phone app on the phone", and the parent's dashboard shows the lock as not intact. Opening Plainphone again shows the dialog again.
3. Once accepted, the maker's extra phone apps are hidden like on Android 14.

The gap: without `DISALLOW_CONFIG_DEFAULT_APPS`, someone holding the phone can go to
Settings → Apps → Default apps and pick the built-in dialer as the phone app again. The maker's SMS
apps and extra dialers are hidden, so they cannot be picked; the built-in dialer stays visible because
Android falls back to it for emergency calls. If the phone app is switched, the next lock check marks
`default phone app` as failed and the dashboard shows it, and Plainphone asks again the next time it is
opened. Bypass checklist row C13 covers this test.

## Not yet tested on a real phone

The fallbacks are covered by unit tests (Robolectric at API 29 and 35, plus the policy logic at API
29-34). As of version 0.1.3 they have not been tried on a real Android 10-13 phone, and no emulator
could run on the build machine. Things to watch in the first test:

- the phone app dialog after setup,
- location on through `LOCATION_MODE` on Android 10,
- speaker and mute during a call,
- the incoming call notification on Android 10 and 11.
