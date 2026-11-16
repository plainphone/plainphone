# Policies (phases 1, 2 and 4)

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
| `no_add_clone_profile` | App cloning (Samsung Dual Messenger, Xiaomi Dual apps). Hidden constant `DISALLOW_ADD_CLONE_PROFILE`; if a device ignores it, the bypass checklist will show it. | AOSP `UserManager.java` |
| `DISALLOW_ADD_PRIVATE_PROFILE` (Android 15+) | Private space | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_ADD_PRIVATE_PROFILE) |
| `DISALLOW_DEBUGGING_FEATURES` | Developer options and adb | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_DEBUGGING_FEATURES) |
| `DISALLOW_CONFIG_PRIVATE_DNS` | Changing private DNS | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_CONFIG_PRIVATE_DNS) |
| `DISALLOW_CONFIG_VPN` | Setting up or starting VPNs | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_CONFIG_VPN) |
| `DISALLOW_NETWORK_RESET` | Resetting network settings | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_NETWORK_RESET) |
| `DISALLOW_CONFIG_CREDENTIALS` | Installing user CA certificates (a proxy could otherwise get around filtering) | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_CONFIG_CREDENTIALS) |
| `DISALLOW_USB_FILE_TRANSFER`, `DISALLOW_MOUNT_PHYSICAL_MEDIA` | Copying files in over USB or from an SD card | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_USB_FILE_TRANSFER) |
| `DISALLOW_CONFIG_DEFAULT_APPS` (phase 2) | Changing the default phone and SMS app (Plainphone) in Settings | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_CONFIG_DEFAULT_APPS) |
| `DISALLOW_CONFIG_DATE_TIME` + automatic time and time zone | Date and time tricks (matters for school time in phase 3) | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setAutoTimeEnabled(android.content.ComponentName,%20boolean)) |

## Phone and SMS (phase 2)

| Step | What it does | Android reference |
|---|---|---|
| `setDefaultDialerApplication` (Android 14+) | Makes Plainphone the default phone app, so its call screening and in-call service see every call | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setDefaultDialerApplication(java.lang.String)) |
| `setDefaultSmsApplication` | Makes Plainphone the default SMS app, so only it receives and stores SMS | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setDefaultSmsApplication(android.content.ComponentName,%20java.lang.String)) |
| `setPermissionGrantState` | Grants Plainphone's own phone, call log, SMS and notification permissions | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setPermissionGrantState(android.content.ComponentName,%20java.lang.String,%20java.lang.String,%20int)) |
| Hide the maker's phone and SMS apps | Once Plainphone holds a role, the other apps for that role are hidden, **except the system dialer** (emergency fallback) | [contacts.md](contacts.md) |

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
| `setApplicationHidden` | The parent's app list replaces the fixed allowlist. The maker's phone and SMS apps stay hidden whatever the list says. During school time and bedtime only the launcher, keyboard, system dialer, clock, Settings, Plainphone and the window's allowed apps stay visible. | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setApplicationHidden(android.content.ComponentName,%20java.lang.String,%20boolean)) |
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
- **Pair with a parent** (phase 4, only when the phone is not paired) shows the pairing code. Outside the first 24 hours after setup this is the only way to pair.
- **Sync with the server now** (phase 4, when paired) fetches the rules at once.

The PIN only travels in the QR code as a PBKDF2-SHA256 hash (120,000 rounds, random salt). The QR script requires at least six digits. A six-digit PIN can still be brute-forced by someone who has the QR code, so treat the QR code as secret. If no PIN was given, the app falls back to the test PIN `000000` and says so on the status screen. This screen will be removed or replaced by the server-side key in later phases.
