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
| `DISALLOW_MODIFY_ACCOUNTS` | Adding or removing accounts (Google, the maker's). An account the child controls could otherwise become the owner of Android's own FRP or of "find and erase" services. A maintenance unlock or an install window authorized with the parent PIN lifts it, so a parent can add the Google account Play needs; account changes are blocked again as soon as a Google account is added during the install window or the window closes. Deadline recovery restores the account restriction independently of the full policy run. If Android refuses to allow account changes, the PIN flow shows an error and keeps Play closed | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_MODIFY_ACCOUNTS) |
| `DISALLOW_CONTENT_CAPTURE`, `DISALLOW_CONTENT_SUGGESTIONS`, `DISALLOW_ASSIST_CONTENT` (Android 15+) | Screen content handed to assistants and suggestion services (Circle to Search, Lens, screen context) | [link](https://developer.android.com/reference/android/os/UserManager#DISALLOW_ASSIST_CONTENT) |
| `DISALLOW_CONFIG_DATE_TIME` + automatic time and time zone | Date and time tricks (matters for school time in phase 3) | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setAutoTimeEnabled(android.content.ComponentName,%20boolean)) |

## Phone and SMS (phase 2)

| Step | What it does | Android reference |
|---|---|---|
| `setDefaultDialerApplication` (Android 14+) | Makes Plainphone the default phone app, so its call screening and in-call service see every call. Android 10 to 13 have no such call: Plainphone shows Android's role dialog instead ([android-versions.md](android-versions.md)) | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setDefaultDialerApplication(java.lang.String)) |
| `setDefaultSmsApplication` | Makes Plainphone the default SMS app, so only it receives and stores SMS | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setDefaultSmsApplication(android.content.ComponentName,%20java.lang.String)) |
| `setPermissionGrantState` | Grants Plainphone's own phone, call log, SMS and notification permissions | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setPermissionGrantState(android.content.ComponentName,%20java.lang.String,%20java.lang.String,%20int)) |
| Hide the maker's phone and SMS apps | Once Plainphone holds a role, the other apps for that role are hidden, **except the system dialer** (emergency fallback). On Android 10 to 13 the extra dialers are hidden even without the role | [contacts.md](contacts.md) |

The roles are taken first, before `DISALLOW_CONFIG_DEFAULT_APPS` and before apps are hidden. If Android refuses a role, no phone or SMS app is hidden. On release, Plainphone restores the SMS app and, on Android 14+, the system dialer. Release disables Plainphone's screening and redirection services. If Android retains either role assignment, clear it in Settings. On Android 10 to 13, choose the system dialer there too. The services also stop filtering if Device Owner is lost outside the release flow. The approved-contacts rule itself is described in [contacts.md](contacts.md).

`DISALLOW_UNINSTALL_APPS` is **not** set. Uninstalling an allowed app does not loosen the lock, and Plainphone itself is protected with `setUninstallBlocked` (a Device Owner cannot be uninstalled anyway).

`DISALLOW_MODIFY_ACCOUNTS` is set in strong mode (#21). A Google account that is already on the phone stays (and cannot be removed by the child). To add one, for example the parent's account for Play, use a maintenance unlock. Which account types are on the phone (types only, no names) is reported to the dashboard.

## Other policies

| Policy | What it does | Reference |
|---|---|---|
| `setGlobalPrivateDnsModeSpecifiedHost` | Forces DNS-over-TLS to `family.adguard-dns.com` (phase 1 placeholder; phase 2 uses Plainphone's own resolver). The call checks that the host answers, so it fails while the phone is offline and is retried later. | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setGlobalPrivateDnsModeSpecifiedHost(android.content.ComponentName,%20java.lang.String)) |
| `setApplicationHidden` | Hides every launchable app that is not allowed. Hidden apps behave as if uninstalled and cannot be opened. | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setApplicationHidden(android.content.ComponentName,%20java.lang.String,%20boolean)) |
| `setApplicationRestrictions` (Chrome) | `DnsOverHttpsMode=off`, `IncognitoModeAvailability=1`, `ForceGoogleSafeSearch`, `ForceYouTubeRestrict=2` | [Chrome policy list](https://chromeenterprise.google/policies/) |
| `setFactoryResetProtectionPolicy` (Android 11+), Play services' `factoryResetProtectionAdmin` managed configuration (Android 10) | The parent's Google account IDs, from "Protect against reset" in the dashboard or from the QR code. Followed by the broadcast `com.google.android.gms.auth.FRP_CONFIG_CHANGED` to Play services. See "Factory reset protection" below | [link](https://developer.android.com/work/dpc/security#enable_enterprise_frp) |
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

## Hardening ([Hardening.kt](../android/app/src/main/java/org/plainphone/app/Hardening.kt))

Each is its own status step, so the parent sees exactly what held.

| Step | What it does | Android | Reference |
|---|---|---|---|
| `factory reset protection` | Sets the parents' Google account IDs (see below). The detail says `on`, `off` (no account set), `no-play-services` or `failed`; the dashboard shows it. Fails when setting or clearing the policy is refused | 10+ | [link](https://developer.android.com/work/dpc/security#enable_enterprise_frp) |
| `accounts on the phone` | Lists account types (`com.google`, a maker's account), no names | all | |
| `no force stop of Plainphone` | `setUserControlDisabledPackages`: Force stop and Clear data are greyed out, and Plainphone is exempt from App Standby, which reduces delays from App Standby for re-lock and sync | 11+ | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setUserControlDisabledPackages(android.content.ComponentName,%20java.util.List%3Cjava.lang.String%3E)) |
| `extra users and profiles` | Finds users and profiles other than the main one (OnePlus Parallel Apps, Xiaomi Dual apps, guests) and removes them with `removeUser`. Reports a failed check when an extra profile was found, including whether removal succeeded. Reports counts only. In headless system-user mode, reports without removing users to protect the main interactive user | 10+ | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#removeUser(android.content.ComponentName,%20android.os.UserHandle)) |
| `call screening role`, `call redirection role`, `contacts permission for call screening` | A second layer for calls on Android 10 to 13, see [android-versions.md](android-versions.md). Fails until the role dialog is accepted on the phone | 10-13 | [link](https://developer.android.com/reference/android/telecom/CallRedirectionService) |
| `no lock screen widgets` | `KEYGUARD_DISABLE_WIDGETS_ALL`; the lock screen camera stays | all | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setKeyguardDisabledFeatures(android.content.ComponentName,%20int)) |
| `only built-in keyboards` | `setPermittedInputMethods(empty)`: only keyboards that came with the phone. Fails if a keyboard from an app is enabled | all | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setPermittedInputMethods(android.content.ComponentName,%20java.util.List%3Cjava.lang.String%3E)) |
| `only built-in accessibility services` | `setPermittedAccessibilityServices(empty)`: TalkBack and other built-in services keep working | all | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setPermittedAccessibilityServices(android.content.ComponentName,%20java.util.List%3Cjava.lang.String%3E)) |

Releasing Device Owner undoes all of them.

## Factory reset protection

A reset from recovery mode cannot be blocked by any app. What protects the phone afterwards is FRP:
Android's setup can ask for an eligible Google account before the phone can be used.
A phone may also offer the previous screen-lock PIN. Check R5 on the exact model and Android build before relying on FRP to keep the phone locked after a reset.

- **The parent's account.** In the dashboard, Household → "Protect against reset", a parent signs in with
  Google. The server keeps only the numeric Google account ID from the People API,
  no email address, and sends it to every phone in the household in the rules (`resetProtection.accountIds`).
  Each parent in the household can add their own account. A parent who leaves the household stops
  protecting the phones at the next sync. The dashboard and parent app ask for confirmation before
  removing an account. The removal takes effect at the next sync.
- **On the phone:** Android 11+ uses `setFactoryResetProtectionPolicy`; Android 10 uses the legacy path Google
  documents, the managed configuration `factoryResetProtectionAdmin` of `com.google.android.gms`. Both are
  followed by the broadcast `FRP_CONFIG_CHANGED`, which Play services needs to pick up the change.
  On Android 10, removing the last account clears Plainphone's managed configuration so normal
  Android FRP can apply. Permanent release explicitly disables the legacy configuration.
- **72 hours:** Google says newly created accounts may not work for FRP for 72 hours. The dashboard and parent app show
  "Ready from" for the time the account was linked plus 72 hours. Wait until that time and check
  the phone has saved the protection settings before resetting it.
- **Without Google Play services** nothing enforces FRP, and the dashboard says the phone cannot be protected.
- **OEM unlocking** switches FRP off. It is greyed out by `DISALLOW_FACTORY_RESET` and developer options are
  blocked, but a phone that arrives with an unlocked bootloader has no FRP.
- **Order of steps with `DISALLOW_MODIFY_ACCOUNTS`:** Plainphone sets FRP and notifies Play services before blocking account changes. The FRP policy does not need the parent's account to be
  on the phone, so the account restriction cannot lock a parent out. Android's own FRP (no policy) uses the
  accounts on the phone; those can no longer be removed by the child, and a parent adds theirs during a
  maintenance unlock or by choosing “Install and add a Play account” and entering their maintenance PIN for an approved app. The test PIN cannot authorize account changes through this install option. If all five daily installation windows have been used, the phone explains the limit and keeps Play closed.

## Hardware attestation of the boot state (#23)

Once a day (and right after pairing) the phone asks the server for a challenge, makes a key in its
TEE or StrongBox with it (`setAttestationChallenge`) and sends the certificate chain to
`PUT /device/attestation`. The **server** validates the certificate path against a pinned Google
attestation root with OpenSSL and checks a revocation list refreshed hourly. An unavailable fresh
list prevents a positive verdict. The server reads `RootOfTrust` (`deviceLocked`, `verifiedBootState`)
and the OS patch level. Play Integrity is not
used, so a self-hosted server needs no Google Cloud project. No serial number or IMEI is requested. Only the verification result and its timestamp are stored.
If the keystore cannot provide a chain, the phone reports an unverifiable check. A positive verdict
expires after 48 hours, and the dashboard shows the time of the last system check separately from
ordinary sync. If a check cannot verify the phone after a negative finding, the dashboard keeps that finding and shows the failed check separately. A change to a boot state that breaks an intact lock triggers the existing protection alert.
On Android 10 and 11, when Android reports an unlocked bootloader, the first strong-mode lock waits
for the warning to be acknowledged on the phone. The dashboard shows the pending warning. Later
policy runs reapply the lock without waiting. Android 12 and newer never wait for this local warning.
After a network failure, the phone retries attestation on the first sync due at least an hour later.

| Result | Dashboard |
|---|---|
| `verified` | "System unchanged" |
| `unlocked` | Lock shown as **not intact**: an unlocked bootloader switches FRP off and lets the system be replaced |
| `failed-boot`, `revoked` | Lock shown as not intact |
| `custom-os` | Lock shown as not intact: the bootloader is locked with a system signed by someone other than the maker |
| `unverifiable` | "Cannot be verified": a software keystore, or a root that is not Google's. Phones that launched before Android 8.0 (the OnePlus 5T launched with 7.1) may land here |

The phone shows a warning on its status screen for the results that are not `verified` or `unverifiable`.

## Home screen and phone settings from the dashboard

The full list of settings, their three modes (the child decides, set, set and locked) and the
Android calls behind them is in [phone-settings.md](phone-settings.md). The code is in
[`SettingsApplier.kt`](../android/app/src/main/java/org/plainphone/app/settings/SettingsApplier.kt).

| Policy | What it does | Reference |
|---|---|---|
| `addPersistentPreferredActivity` (HOME) | Plainphone's calm home screen is the one Android always opens. Lifted during a maintenance unlock and on release (`clearPackagePersistentPreferredActivities`). The maker's launcher stays installed, as a fallback. | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#addPersistentPreferredActivity(android.content.ComponentName,%20android.content.IntentFilter,%20android.content.ComponentName)) |
| `setCameraDisabled`, `setScreenCaptureDisabled` | Camera and screenshots off, when the parent locks them | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setCameraDisabled(android.content.ComponentName,%20boolean)) |
| `setSystemSetting` | Screen timeout and brightness, set once (preset) or on every sync (locked) | [link](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setSystemSetting(android.content.ComponentName,%20java.lang.String,%20java.lang.String)) |
| `DISALLOW_BLUETOOTH` or `DISALLOW_CONFIG_BLUETOOTH` + `DISALLOW_BLUETOOTH_SHARING`, `DISALLOW_CONFIG_WIFI`, `DISALLOW_CONFIG_MOBILE_NETWORKS`, `DISALLOW_DATA_ROAMING`, `DISALLOW_CONFIG_SCREEN_TIMEOUT`, `DISALLOW_CONFIG_BRIGHTNESS`, `DISALLOW_ADJUST_VOLUME`, `DISALLOW_SET_WALLPAPER`, `DISALLOW_CONFIG_LOCALE`, `DISALLOW_CONFIG_TETHERING`, `DISALLOW_NEAR_FIELD_COMMUNICATION_RADIO` / `DISALLOW_OUTGOING_BEAM`, `DISALLOW_AIRPLANE_MODE` | Only while the parent has the matching setting locked; cleared as soon as it is set free again | [UserManager](https://developer.android.com/reference/android/os/UserManager) |

Things to know:

- **Locking the volume mutes the phone.** That is how Android implements `DISALLOW_ADJUST_VOLUME`. The dashboard calls it "silent".
- **Language** can only be locked as it is. A Device Owner cannot choose the system language after setup.
- **Location for "Find" wins.** When the parent has location on, location is on and locked whatever the location setting says.
- **Self profile:** loosening a locked setting goes through the key, like every other loosening.

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
- **Release Device Owner** removes every policy before giving up Device Owner (`clearDeviceOwnerApp`). If cleanup fails, the app keeps Device Owner so it can retry. Plainphone can then be uninstalled and the phone reset normally. A parent can do the same from the dashboard with **Release the phone**: the rules then carry `release: true`, the phone releases itself the next time it syncs and tells the server ([sync-api.md](sync-api.md#releasing-the-phone)).
- **Pair with a parent** (phase 4, only when the phone is not paired) shows the pairing code. Outside the first hour after setup this is the only way to pair.
- **Sync with the server now** (phase 4, when paired) fetches the rules at once.

The PIN only travels in the QR code as a PBKDF2-SHA256 hash (120,000 rounds, random salt). The QR script requires at least six digits. A six-digit PIN can still be brute-forced by someone who has the QR code, so treat the QR code as secret. If no PIN was given, the app falls back to the test PIN `000000` and says so on the status screen. This screen will be removed or replaced by the server-side key in later phases.

## Time limits and catalog installs (strong mode)

- **Time limits** ([time-limits.md](time-limits.md)): an app whose minutes are used up today is suspended with `setPackagesSuspended` (the icon stays; Android says the app is paused) and comes back at local midnight. Core apps (phone, messages, maps, clock, Settings, launcher, keyboard, camera, contacts) are never counted and never suspended, so calls and emergency calls are never affected. Counting needs usage access, which only the user can grant (Plainphone > Today); until then the step "usage access (time limits)" fails and the parent sees it.
- **Installing a catalog app** ([app-catalog.md](app-catalog.md), R2): for an app the parent approved, Plainphone lifts `DISALLOW_INSTALL_APPS`, shows Play and opens the app's page (`market://details?id=`). The restriction and the hidden Play come back as soon as the package is installed, or after 15 minutes. Any other app installed meanwhile is unknown to the parent and therefore hidden. Play needs a Google account on the phone. The ordinary Install button keeps account changes blocked. Adding an account through the parent PIN is limited to the same watchdog-backed catalog window described in [Android updates](android-updates.md).

Light mode, where none of this is available, is described in [light-mode.md](light-mode.md).

## Help lines

On the phone, **Do you need someone to talk to?** is available from the
Plainphone home screen, Phone and Today. It lists verified services for the
phone's country, starting with [Denmark](../server/catalog/helplines/dk.json). The catalogue includes each
service's own source and verification date. BackOp replaced Cyberhus in
October 2026. [BackOp's support page](https://backop.dk/ny-app/) describes
anonymous SMS support but does not publish a direct SMS number children can
use from Plainphone. The Help screen offers direct alternatives, including
BørneTelefonen and headspace.

The approved-contacts rule makes an outgoing exception for listed call and SMS
numbers. Each catalogue channel declares whether it accepts incoming replies.
On phones that enforce approved contacts, a reply-only channel can receive from
the same number and channel for 24 hours after the child makes contact.
Ungekontakten has a five-day window because its published response time is one
to two working days. The phone opens the SMS window after Android reports
that every part of the message was sent successfully. Reply windows close on
reboot. The phone stores the time locally and never syncs it. Other incoming
communications follow ordinary contact rules. SMS sender IDs must be numeric
to qualify, and the reply window does not authenticate the sender.
Ordinary contacts and catalogue replies use separate SMS threads, even when
they share a number. Older incoming messages without sender-type information
can be read in a thread titled with the number if there is a prior sent message
to that reply-only helpline in the retained SMS history.

For 112, Android handles emergency calls and Plainphone keeps the existing
emergency callback window, which also covers callers with a hidden number.
The Phone and Help screens are exempt from time limits and stay available at
school time and bedtime. You still need a working connection and the service
must be open to reply.

The Help screen and links in Plainphone's Messages open catalogue sites inside
Plainphone, including during school time and bedtime. HTTP links are upgraded
to HTTPS. Help checks navigation and initial resource requests against the
catalogue, including iframe requests. It blocks POST and other submission
methods because Android WebView can follow their redirects without checking the
destination. Chats that require those methods need another channel, such as
calling or texting the listed service. Third-party chat entries match exact
hosts. A tapped telephone or SMS link opens the matching Help action when the
number is listed for that channel. Leaving a Help page clears its WebView cookies and
site storage. A new Help page waits for cookie removal before its first request.
Time in Help is exempt from screen-time limits and parent reports.
ppdns also lets the verified help,
health, body, sexuality and LGBT+ sites through the web filter.

Plainphone can accept catalogue links from other apps when Android hands them
over. On Android 12 and later, this requires Android to approve Plainphone for
the domain. If another app keeps the link in its own browser, or a child types
the address directly there, the time still counts towards the browser's own
cap and any total screen-time limit and appears as browser use in reports.
[Android link handling](https://developer.android.com/training/app-links/create-deeplinks).

Plainphone excludes help contacts from its parent-facing blocked log and
sends no call or SMS history to the server. Help SMS notifications are hidden
on the lock screen. Android's own recent calls and SMS conversations can still
be visible locally on the phone. ppdns keeps
query logging off and excludes protected domains from DNS statistics.

The UN Committee on the Rights of the Child recommends confidential access to
psychological counselling in paragraph 94. Paragraph 76 warns that monitoring
can prevent children from reaching a helpline. [General Comment No. 25](https://digitallibrary.un.org/record/3906061).
[Przybylski and Nash (2018)](https://doi.org/10.1089/cyber.2017.0466)
discuss the risk that internet filtering can restrict access to useful sexual
health information.
