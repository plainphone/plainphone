# Light mode: Plainphone as an ordinary app

Light mode puts Plainphone on a phone that is already in use: no factory reset or Device Owner. The dashboard offers a QR code or setup link. It is weaker than strong mode, and the parent's dashboard says exactly how (spec
D2 and scope 3). This page is the reference for how it works, how to install it, what can be
got around, and which Google Play policies each part touches.

## One APK, two modes

The same APK does both. Provisioned by QR as Device Owner it runs in strong mode; installed
normally it runs in light mode. The mode follows from what Android granted
(`light/Mode.kt`), so nothing needs configuring and a strong-mode phone can never drop into
light mode by mistake.

Why not a build flavor: a second APK doubles the releases, the signing and the testing, and the
two modes share almost all code (rules, contacts, time limits, sync). A Play build later will
be a flavor that leaves out what Play does not accept in a consumer app (see the table below);
the code is already split so that is a build setting, not a rewrite.

## What protects the phone

| Protection | How | Without it |
|---|---|---|
| Web filter | A local `VpnService` that only carries DNS. Lookups go to the phone's own ClientID at `<id>.dns.plainphone.org` over DNS-over-TLS. Packets to well-known public resolvers (Google, Cloudflare, Quad9, AdGuard, NextDNS…) are routed into the tunnel and dropped, so apps fall back to the filter. No other traffic touches the VPN ([light-mode-vpn.md](light-mode-vpn.md)) | No filter. The parent is told |
| App list | An accessibility service (Plainphone guard) sees which app comes to the front. An app the parent has not allowed, or whose time is used up, is sent home and a calm Plainphone screen is shown instead | Apps open freely. The parent is told |
| Guarding Plainphone itself | The same service closes Plainphone's own Settings screens: its accessibility, VPN, device admin, usage access and default-app pages, its app info page (uninstall, force stop, clear data), the uninstall dialog (not the update dialog, so new Plainphone APKs install), and the VPN disconnect dialog. It matches actions (uninstall, deactivate, always-on…) next to Plainphone's name, not page titles, so Network & internet and the Apps list stay usable. The maintenance PIN opens a 30-minute window; repairing a protection (Today > Fix it) asks for it first | Plainphone can be switched off from Settings |
| Uninstall | A device admin receiver (`LightAdminReceiver`). Android will not uninstall an active device admin, so it has to be switched off first, and that screen is guarded | Plainphone can be uninstalled from the launcher |
| Approved contacts | The phone and SMS roles via Android's own `RoleManager` dialogs, like strong mode on Android 10-13. Calls and SMS from other numbers are blocked; emergency numbers always work | Calls and SMS are unfiltered. The parent is told |
| Time limits | Usage access (`UsageStatsManager`), counted on the phone and evaluated offline ([time-limits.md](time-limits.md)) | Time limits do not count. The parent is told when limits are set |
| Find | Runtime location permission, "allow all the time" | No position |

The guard always subscribes to window state and window list changes. In light mode it also listens for content changes while any interactive window belongs to Settings, an installer or the VPN dialog, or when the window list is empty or a window's package is unknown. This includes maintenance and split screen. Settings and installer window state changes get an immediate check and, if it does not send Back successfully, a fallback within 150 ms. Returning focus to a protected window queues a check, even if its package is temporarily unknown. The guard verifies that the active root matches a queued package or a queued window whose package is now known to be protected. Further events leave the first check's deadline in place. A successful Settings or installer Back clears the queued check so the next window can be checked immediately.

The guard closes the VPN disconnect dialog only when the active window belongs to its package. If the active window lags or Android rejects Back, retries run at 50, 150, 300, 600 and 1,000 ms from the first attempt. The active VPN dialog is checked before any Settings or installer text is read. A successful VPN Back cancels the remaining retries. Android's event notification timeout is zero. On Android 13 and later, VPN-only checks and window package lookups skip descendant prefetch. Settings and installer tree checks use Android's default accessibility cache and prefetch behavior. The 30-second time-limit tick runs only while the screen is interactive.

Every protection is a step in the lock. A missing one is a failed policy, so `lockIntact` is
false and the parent sees which one. The phone also reports `mode: "light"` and a
`protections` object in `PUT /device/status` ([sync-api.md](sync-api.md)).

## Releasing from the dashboard

A parent can switch light mode off from the dashboard with **Release the phone**. The next sync
reads `release: true`, switches Plainphone off the same way the maintenance screen does, and
tells the server, which then removes the phone from the dashboard. The phone reports nothing
about the protections going, since the parent asked for it. See
[sync-api.md](sync-api.md#releasing-the-phone).

## The parent is told when protection is removed

- **VPN switched off:** `onRevoke` fires in the running app, which syncs at once and reports the
  missing filter.
- **Guard switched off:** the service's `onUnbind` starts a sync with the new status.
- **Device admin switched off:** `onDisabled` starts a sync.
- **Plainphone uninstalled, force stopped or the phone in safe mode:** the phone stops reporting.
  The server marks it offline; the push to the parent is part of the push work (pp-data).
- The 15-minute background sync reports the full protections list either way.

## What can be got around

Light mode adds friction. It is not a lock, and the dashboard says so:

1. **Apps are closed after they open, not hidden.** The icon is there, and a quick child sees the
   first frame before the guard closes it.
2. **Factory reset** from Settings is allowed by Android (the guard does not block the reset
   screen, because a parent may need it). Plainphone is gone afterwards; the parent sees the phone
   go offline.
3. **Safe mode** starts the phone without third-party apps, so without Plainphone. Restarting
   normally brings it back.
4. **Uninstalling** needs device admin switched off first. The guard closes those screens, but it
   relies on reading screen text; an unusual Settings layout or a language the guard does not know
   may slip through. The parent is told.
5. **New apps can be installed.** The guard blocks a new app the moment Android announces it, until the parent allows it.
6. **Default phone and SMS app** can be changed in Settings > Default apps (the guard closes that
   screen when it shows Plainphone). Then calls and SMS are unfiltered until Plainphone is chosen
   again; the parent sees it.
7. **Private DNS** set to another resolver in strict mode sends lookups past the VPN. Plainphone
   detects it (`LinkProperties.getPrivateDnsServerName`) and reports it as a missing protection.
8. **Incognito and other browsers.** Chrome's managed configuration (no incognito, no secure-DNS
   bypass) needs Device Owner. In light mode only the DNS filter applies; other browsers are blocked
   like any app the parent has not allowed.
9. **adb and a computer** get around everything, as in strong mode before the lock.

## Installing it (no reset)

1. In the dashboard, choose **Add phone → It is already in use**. Choose the profile, give the
   phone a name and create a setup link. Open it in Chrome on the phone being set up.
2. Download and open the APK. If Android blocks installation, open **Settings**, enable **Allow
   from this source**, go back and tap **Install**. Return to the same Chrome tab and tap
   **Open Plainphone**.
3. On **Whose phone is this?**, choose **Child** or **Myself**, then review what will be managed
   before agreeing to continue. **Parent** opens the dashboard with no Android permissions. It
   also offers setup for your own phone. **Myself** uses the existing Self profile: stricter
   rules take effect when the phone next connects, and looser rules wait for the key.
4. Check the masked account and household on the phone before confirming. **Not you? Cancel**
   removes the unfinished phone entry. For a setup link, enter the maintenance PIN twice on the
   phone to confirm. If you opened Plainphone directly from the installer, choose your local PIN
   and show a pairing code. Open the dashboard, confirm the preselected profile, and then confirm
   the masked account on the phone.
5. Follow the default phone and SMS app, web filter, usage access, uninstall protection and guard
   steps. On Android 13 or later, if Android blocks the phone app, SMS app or guard as a restricted
   setting, open **App info** from Plainphone, tap **⋮ (top right) → Allow restricted settings**,
   return to Plainphone and retry the step. The menu depends on the Android version and manufacturer.
   See [Android's restricted settings help](https://support.google.com/android/answer/12623953).
6. Background operation, location and always-on VPN are optional. For always-on VPN, leave
   **Block connections without VPN** off. The filter only carries DNS lookups
   ([light-mode-vpn.md](light-mode-vpn.md)). After installation, you can turn off Chrome's
   **Allow from this source** in Android settings.

**Undo setup** is available without a PIN on the finish and Today screens for ten minutes after
light-mode setup completes. The phone saves the window length, the boot count and the elapsed
time since boot at completion. Changing the clock has no effect. Rebooting closes the window.
The maintenance PIN and dashboard release remain available.

Tapping **Undo setup** switches off the app guard and DNS filter on the phone, even offline.
The phone saves the accepted undo and retries the report after reconnecting. Once the server
acknowledges it, Plainphone removes its device administrator so Android allows normal
uninstallation. Android still lets someone manually deactivate a light-mode device administrator.
If you remove it yourself and uninstall before the phone reconnects, the report cannot be sent.

The server removes the phone from the dashboard and queues the standard protection-removed
notice in the same database transaction. Delivery runs in the background and is retried if a
configured mail or push provider is unavailable. Before sending, the server checks that the
recipient still belongs to the household. Android keeps its default Phone and SMS apps
selected until you change them in Settings or uninstall Plainphone.

In light mode, the phone already enforces protection locally. A time-boxed window measured by
the phone's monotonic clock is as trustworthy as the rest of light mode. The server uses the
report to remove the phone and tell the parent.

Device Owner mode starts through the Android welcome screen on a new or reset phone. Android
grants Device Owner during provisioning. Plainphone waits for the Child or Myself confirmation
and, for dashboard provisioning, confirmation of the masked account before applying its
policies or asking for call roles. If you cancel, Plainphone removes the pending dashboard
phone and stays unlocked. Device Owner remains installed. Use the existing maintenance PIN
or dashboard release on a protected phone. A PIN-free undo would permit removing Device
Owner and its reset protection, which cannot be reinstated by the app.

See [dashboard setup](dashboard-setup.md) for the handoff and hardware checks.

## Google Play policies per part

Not submitted (needs the organisation verification and Mads' go). What each part would need:

| Part | Play policy | Needed |
|---|---|---|
| `VpnService` DNS filter | VpnService policy: only for apps whose core purpose needs it; parental control is an accepted use | VPN declaration in Play Console, privacy policy describing the DNS-only tunnel |
| Accessibility service (guard) | Accessibility API policy: non-accessibility uses must be disclosed and consented in the app, and declared | Prominent in-app disclosure (the guard step does this), Play Console declaration, review |
| Device admin (`LightAdminReceiver`) | Device Admin policy: allowed for parental control apps; deprecated policies are refused for ordinary apps on Android 10+ (hence only `force-lock`) | Declaration; explain why |
| Phone and SMS roles | SMS and Call Log permissions policy: only the default phone or SMS app, or a listed exception | Permissions declaration form; default handler is the qualifying use |
| Background location | Location permissions policy: a clear in-app disclosure and a feature the user expects | Declaration form, a short video of "Find" |
| `QUERY_ALL_PACKAGES` | Package visibility policy: parental control is a permitted use | Declaration |
| `PACKAGE_USAGE_STATS` | Usage access is a special permission granted by the user | Disclosure in the time-limits step |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Allowed only when the app's core function breaks otherwise | Justification (filtering calls and rules in the background) |
| Family | Families policy and the "parental control" app category | Teacher Approved is not needed; ads are none anyway |

R3 in the spec stays: a review can take weeks and may be refused, which is why the APK path ships
first.
