# Policies (phases 1, 2 and 4)

Which policies exist on which Android version (Plainphone runs on Android 10 and newer) is in [android-versions.md](android-versions.md).

Plainphone sets these policies as Device Owner. The code is in [`LockPolicy.kt`](../android/app/src/main/java/org/plainphone/app/LockPolicy.kt) and [`PolicyApplier.kt`](../android/app/src/main/java/org/plainphone/app/PolicyApplier.kt). Each step runs on its own, so if one fails (for example private DNS while the phone is offline), the others still apply. The status screen shows `OK` or `FAIL` for every step.

The lock is applied:

- during setup (`ADMIN_POLICY_COMPLIANCE`, before the user reaches the home screen),
- after every reboot and app update,
- every time Plainphone is opened (except during a maintenance unlock),
- when a maintenance unlock runs out.

## User restrictions

| Restriction | Blocks | Android reference |
|---|---|---|
| `DISALLOW_INSTALL_APPS` | Installing apps from Play Store and other stores. It also stops the Device Owner itself from installing apps until the restriction is lifted. | [UserManager](https://developer.android.com/reference/android/os/UserManager#DISALLOW_INSTALL_APPS) |
| `DISALLOW_INSTALL_UNKNOWN_SOURCES`, `..._GLOBALLY` | Installing APK files | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_INSTALL_UNKNOWN_SOURCES_GLOBALLY) |
| `DISALLOW_FACTORY_RESET` | Factory reset from Settings | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_FACTORY_RESET) |
| `DISALLOW_SAFE_BOOT` | Booting into safe mode | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_SAFE_BOOT) |
| `DISALLOW_ADD_USER`, `DISALLOW_USER_SWITCH` | New users, guest mode, switching users | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_ADD_USER) |
| `DISALLOW_ADD_MANAGED_PROFILE` | Work profiles (deprecated constant in API 37, still set) | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_ADD_MANAGED_PROFILE) |
| `no_add_clone_profile` (Android 14+) | App cloning (Samsung Dual Messenger, Xiaomi Dual apps). Hidden constant `DISALLOW_ADD_CLONE_PROFILE`; if a device ignores it, the bypass checklist will show it. | AOSP `UserManager.java` |
| `DISALLOW_ADD_PRIVATE_PROFILE` (Android 15+) | Private space | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_ADD_PRIVATE_PROFILE) |
| `DISALLOW_DEBUGGING_FEATURES` | Developer options and adb | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_DEBUGGING_FEATURES) |
| `DISALLOW_CONFIG_PRIVATE_DNS` | Changing private DNS | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_CONFIG_PRIVATE_DNS) |
| `DISALLOW_CONFIG_VPN` | Setting up or starting VPNs | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_CONFIG_VPN) |
| `DISALLOW_NETWORK_RESET` | Resetting network settings | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_NETWORK_RESET) |
| `DISALLOW_CONFIG_CREDENTIALS` | Installing user CA certificates (a proxy could otherwise get around filtering) | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_CONFIG_CREDENTIALS) |
| `DISALLOW_USB_FILE_TRANSFER`, `DISALLOW_MOUNT_PHYSICAL_MEDIA` | Copying files in over USB or from an SD card | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_USB_FILE_TRANSFER) |
| `DISALLOW_CONFIG_DEFAULT_APPS` (phase 2, Android 14+) | Changing the default phone and SMS app (Plainphone) in Settings. Not available on Android 10 to 13, see [android-versions.md](android-versions.md) | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_CONFIG_DEFAULT_APPS) |
| `DISALLOW_CONFIG_DATE_TIME` + automatic time and time zone | Date and time tricks (matters for school time in phase 3) | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setAutoTimeEnabled(android.content.ComponentName,%20boolean)) |

## Phone and SMS (phase 2)

| Step | What it does | Android reference |
|---|---|---|
| `setDefaultDialerApplication` (Android 14+) | Makes Plainphone the default phone app, so its call screening and in-call service see every call. Android 10 to 13 have no such call: Plainphone shows Android's role dialog instead ([android-versions.md](android-versions.md)) | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setDefaultDialerApplication(java.lang.String)) |
| `setDefaultSmsApplication` | Makes Plainphone the default SMS app, so only it receives and stores SMS | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setDefaultSmsApplication(android.content.ComponentName,%20java.lang.String)) |
| `setPermissionGrantState` | Grants Plainphone's own phone, call log, SMS and notification permissions | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setPermissionGrantState(android.content.ComponentName,%20java.lang.String,%20java.lang.String,%20int)) |
| Hide the maker's phone and SMS apps | Once Plainphone holds a role, the other apps for that role are hidden, **except the system dialer** (emergency fallback). On Android 10 to 13 the extra dialers are hidden even without the role | [contacts.md](contacts.md) |

The roles are taken first, before `DISALLOW_CONFIG_DEFAULT_APPS` and before apps are hidden. If Android refuses a role, no phone or SMS app is hidden. Releasing Device Owner gives the roles back to the system dialer and the maker's SMS app. The approved-contacts rule itself is described in [contacts.md](contacts.md).

`DISALLOW_UNINSTALL_APPS` is **not** set. Uninstalling an allowed app does not loosen the lock, and Plainphone itself is protected with `setUninstallBlocked` (a Device Owner cannot be uninstalled anyway).

`DISALLOW_MODIFY_ACCOUNTS` is **not** set in phase 1, because a Google account may be needed for Play Store installs (see R2 in the phase 1 report). It is a candidate for later.

## Other policies

| Policy | What it does | Reference |
|---|---|---|
| `setGlobalPrivateDnsModeSpecifiedHost` | Forces DNS-over-TLS to `family.adguard-dns.com` (phase 1 placeholder; phase 2 uses Plainphone's own resolver). The call checks that the host answers, so it fails while the phone is offline and is retried later. | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setGlobalPrivateDnsModeSpecifiedHost(android.content.ComponentName,%20java.lang.String)) |
| `setApplicationHidden` | Hides every launchable app that is not allowed. Hidden apps behave as if uninstalled and cannot be opened. | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setApplicationHidden(android.content.ComponentName,%20java.lang.String,%20boolean)) |
| `setApplicationRestrictions` (Chrome) | `DnsOverHttpsMode=off`, `IncognitoModeAvailability=1`, `ForceGoogleSafeSearch`, `ForceYouTubeRestrict=2` | [Chrome policy list](https://chromeenterprise.google/policies/) |
| `setFactoryResetProtectionPolicy` | Only set when Google account IDs are given in the QR code (see below) | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setFactoryResetProtectionPolicy(android.content.ComponentName,%20android.app.admin.FactoryResetProtectionPolicy)) |
| `setUninstallBlocked` | Plainphone cannot be uninstalled | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setUninstallBlocked(android.content.ComponentName,%20java.lang.String,%20boolean)) |

### Which apps stay visible

Found on the phone itself, so each maker keeps its own apps: the default dialer (`ACTION_DIAL`), the default SMS app, camera, clock (`ACTION_SHOW_ALARMS`), contacts, Settings, the launcher and the enabled keyboards. On top of that comes a fixed list (Chrome, Google Maps, the Google, Samsung and Xiaomi calculator, calendar, gallery and clock apps) and any extra packages from the QR code (`--allow`). Everything else that has a launcher icon is hidden, including Play Store, YouTube, Gmail and the maker's own store.

## Rules from the parent's dashboard (phase 4)

Once the phone is paired, the parent's rules from the server are merged into the lock. How the
phone syncs is in [phone-sync.md](phone-sync.md).

| Policy | When | Reference |
|---|---|---|
| `setApplicationHidden` | The parent's app list replaces the fixed allowlist. The maker's phone and SMS apps stay hidden whatever the list says. During school time and bedtime only the core apps and the window's allowed apps stay visible. | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setApplicationHidden(android.content.ComponentName,%20java.lang.String,%20boolean)) |
| `setGlobalPrivateDnsModeSpecifiedHost` | Switches to the phone's own `<id>.dns.plainphone.org` only when the server says the DNS service has accepted the ID (`dns.ready`). | see above |
| `setPermissionGrantState` (location) | Fine, coarse and background location for Plainphone, only while the parent has location on | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setPermissionGrantState(android.content.ComponentName,%20java.lang.String,%20java.lang.String,%20int)) |
| `setLocationEnabled` + `DISALLOW_CONFIG_LOCATION` | Location on and locked on while the parent has location on; the restriction is lifted when it is turned off | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setLocationEnabled(android.content.ComponentName,%20boolean)) |

## What Android does not let us block

- **Factory reset from recovery mode** (button combination at boot), and on Samsung also flashing in Download mode. No app can stop this. What protects the phone afterwards is Factory Reset Protection (FRP): the phone asks for a Google account that was on it before the reset. See below.
- **FRP without a Google account.** `setFactoryResetProtectionPolicy` takes Google *account IDs* (the numeric ID from the People API, not an email address). If no account IDs are set, Android's normal FRP applies: it only protects the phone if a Google account was signed in on it. A phone without any Google account can be reset in recovery and is then free. This is risk R4 in the spec; the fallback must be documented for parents. The policy also throws `UnsupportedOperationException` on devices without FRP support, which the status screen shows.
- **Apps with their own encrypted DNS.** Private DNS only covers apps that use the system resolver. An app that has its own DNS-over-HTTPS (Chrome is handled through managed configuration; Firefox and some others are not) can get around the filter. The Plainphone resolver blocks public DoH hosts; an always-on VPN is the later layer. See [dns-bypass.md](dns-bypass.md).
- **Calls and chats inside messenger apps** (WhatsApp, Signal and similar) cannot be limited to approved contacts. Those apps are hidden unless a parent allows them. See [contacts.md](contacts.md).
- **Apps the system will not hide.** Some system packages refuse `setApplicationHidden`. The status screen lists them under "hide apps ... failed".
- **Emergency calls** can never be blocked, and that is on purpose.
- **Clone profiles** use a hidden constant. If a maker ignores it, Dual Messenger and similar may still work. This must be tested.

## Maintenance screen

Tap "Version" seven times on the Plainphone status screen and enter the parent PIN. From the fifth wrong PIN in a row, each wrong PIN locks the screen for 1, 2, 4 ... minutes (at most an hour). The count survives app restarts and reboots.

- **Lift the lock for N minutes** (default 30) clears every restriction, shows hidden apps and sets private DNS back to automatic. The lock returns by alarm after N minutes or at the next reboot, whichever comes first. Opening Plainphone does not end the unlock; use "Apply the lock now" for that.
- **Apply the lock now** re-applies everything.
- **Release Device Owner** removes every policy and gives up Device Owner (`clearDeviceOwnerApp`). Plainphone can then be uninstalled and the phone reset normally.
- **Pair with a parent** (phase 4, only when the phone is not paired) shows the pairing code. Outside the first hour after setup this is the only way to pair.
- **Sync with the server now** (phase 4, when paired) fetches the rules at once.

The PIN only travels in the QR code as a PBKDF2-SHA256 hash (120,000 rounds, random salt). The QR script requires at least six digits. A six-digit PIN can still be brute-forced by someone who has the QR code, so treat the QR code as secret. If no PIN was given, the app falls back to the test PIN `000000` and says so on the status screen. This screen will be removed or replaced by the server-side key in later phases.

## Time limits and catalog installs (strong mode)

- **Time limits** ([time-limits.md](time-limits.md)): an app whose minutes are used up today is suspended with `setPackagesSuspended` (the icon stays; Android says the app is paused) and comes back at local midnight. Core apps (phone, messages, maps, clock, Settings, launcher, keyboard, camera, contacts) are never counted and never suspended, so calls and emergency calls are never affected. Counting needs usage access, which only the user can grant (Plainphone > Today); until then the step "usage access (time limits)" fails and the parent sees it.
- **Installing a catalog app** ([app-catalog.md](app-catalog.md), R2): for an app the parent approved, Plainphone lifts `DISALLOW_INSTALL_APPS`, shows Play and opens the app's page (`market://details?id=`). The restriction and the hidden Play come back as soon as the package is installed, or after 15 minutes. Any other app installed meanwhile is unknown to the parent and therefore hidden. Play needs a Google account on the phone.

Light mode, where none of this is available, is described in [light-mode.md](light-mode.md).

## Help lines

On the phone, **Do you need someone to talk to?** is available from Phone
and Today. It lists verified services for the phone's country, starting with
[Denmark](../server/catalog/helplines/dk.json). The catalogue includes each
service's own source and verification date. BackOp replaced Cyberhus in
October 2026. Its public website explains how to access its app-based support.

The approved-contacts rule makes an exception for each listed call and SMS
number, in both directions and both modes. For 112, Android handles emergency
calls and Plainphone keeps the existing emergency callback window, which also
covers callers with a hidden number. The Phone and Help screens are exempt
from time limits and stay available at school time and bedtime. You still
need a working connection and the service must be open to reply.

The Help screen opens listed HTTPS sites inside Plainphone, so a browser cap
does not cut off access. ppdns lets the verified help, health, body, sexuality
and LGBT+ sites through even when a filter category or a parent's rule would
block them. Opening the same site in a separate browser is subject to that
browser's app limit and package-level screen-time reporting.

Plainphone excludes help contacts from its parent-facing blocked log and
sends no call or SMS history to the server. Android's own recent calls and
SMS conversations can still be visible locally on the phone. ppdns keeps
query logging off and excludes protected domains from DNS statistics.

[UN Committee on the Rights of the Child, General Comment No. 25, paragraph 67](https://digitallibrary.un.org/record/3906061?ln=en)
describes how monitoring can prevent children from seeking help.
[Przybylski and Nash (2018)](https://doi.org/10.1089/cyber.2017.0466)
discuss the risk that internet filtering can restrict access to useful sexual
health information.
