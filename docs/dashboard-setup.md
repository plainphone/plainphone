# Dashboard setup for Android

The public guide and **Add phone** in the dashboard start with the same choice. For a new or
reset phone, choose strong mode so Android lets Plainphone protect more settings. For a phone
already in use, choose light mode to keep its data. Both start with a name and a parent PIN in
the dashboard.

## Where parents can get stuck

| Point in the flow | What the setup now says or does |
| --- | --- |
| Choosing a mode | Ask about the phone's current state. The strong-mode guide explains backup and reset before any data is erased. The light-mode guide goes straight to its own dashboard flow. |
| Choosing a PIN | Explain what the PIN is for. Enter it twice on the parent device. Only the salted hash travels to the phone. |
| Strong mode and the first Android screen | Ask parents to stop at the first welcome screen and tap the same spot six times. The guide shows the spot and explains Android's organisation-management prompt. |
| Strong mode and Wi-Fi | Offer Wi-Fi in the code or use Android's network picker. Networks with sign-in pages need a separate connection. The QR code includes any entered password, so keep it private. |
| Strong mode on Android 10–13 | Explain when to choose Plainphone as the default phone app and how to open the app again if the dialog was dismissed. |
| Light mode and APK installation | The QR and link go to a page with the latest APK and Android's **Allow from this source** instructions. After installing, return to Chrome and use **Open Plainphone** on that page to bring across the PIN hash and token. Check the dashboard address and confirm with the parent PIN on the phone. The phone can continue if that same PIN was entered locally first. |
| Light mode and Android prompts | Phone, messages and the web filter explain why Android asks. Each required permission has one primary action. Plainphone rechecks after the system screen closes. |
| Light mode and restricted settings | The guard has a route to Plainphone's App info for the Android 13+ restriction. Return to the guard step after allowing it. |
| Background operation, location and always-on filter | Put these after the required permissions, with a single action to continue without extras. Battery exemption uses the Android prompt. OnePlus and Xiaomi point to their battery controls in App info. Samsung opens Never sleeping apps when its settings app supports that link. |
| Handoff, weak Wi-Fi and an expired link | The dashboard waits for the phone. In light mode the phone offers a retry if enrollment or the first rules fetch fails, or asks for a new link when the server rejects an unused token. It shows the finish screen after storing the first rules. The dashboard can regenerate an expired unpaired setup. |
| After connecting | Offer three direct links for contacts, catalog apps and school hours. |

## Before and after

Counts come from the screens and their actions. The Android tap counts are walkthrough estimates.
For the strong-mode comparison, start with a new phone on Android 14 or newer and an already
signed-in parent on the public guide. In light mode, the prior public site had no route for phones
already in use, so the prior count starts at the APK download and uses the manual pairing path.
Tap counts include focusing fields and going back from Settings. They exclude typing, sign-in,
scrolling, selecting the default Child profile and vendor-specific extra dialogs.

| Measure | Before | After |
| --- | --- | --- |
| Strong mode, parent screens from dashboard | 3 before connection | 4 from dashboard. From the site the choice is carried through and the dashboard still shows 3. |
| Strong mode, taps from site with Android Wi-Fi selection | About 17 | About 17. The Wi-Fi QR moves the network selection to the parent device. Opening the optional form, focusing two fields and applying it takes 4 taps in place of about 3 on the phone. |
| Light mode, taps to skip all optional steps | 3 | 1 |
| Strong mode, Android confirmation | 6 welcome taps, then Wi-Fi and Android's setup confirmation. On Android 10–13 the default phone app adds another dialog. | Same Android requirements. If the QR supplies compatible Wi-Fi credentials, Android can skip its network picker. |
| Light mode, Android setup screens | 11 steps including 3 optional, plus finish | Dashboard confirmation, 6 required permission steps, up to 3 optional steps, an automatic connection screen and finish. One tap skips the three optional steps. |
| Light mode, required permission taps on Android | About 22 | About 21–22, depending on whether Android accepts the app-specific usage access link. Android still owns both default-app dialogs and the web-filter confirmation. |
| Light mode, download, PIN and pairing actions outside those permissions | About 16, including 7 to install/open, 3 for the PIN and 6 to show, enter and claim the pairing code. | About 18, including 7 on the site/dashboard, 1 to open the scanned link, 6 to install, 2 to return to Chrome and open Plainphone, and 2 to focus and confirm the PIN. No pairing code to enter. |
| Light mode, total taps through connection with optional settings skipped | About 41 | About 40–41. The parent confirms the dashboard PIN once on the phone and skips the pairing code and dashboard claim. |
| Dashboard wait after the server marks the phone paired | Strong setup polled every 4 s. The seeded strong-mode transition appeared after 4.31–4.32 s. Manual pairing sent the parent to the phone page after claiming, while the phone polled separately. | Both flows poll every 4 s while visible. Seeded Playwright transitions appeared after 3.80–3.81 s in strong mode and 3.33–3.83 s in light mode. These timings depend on when the fixture changes relative to a poll. |
| Full elapsed time from the public guide | Physical phone timing needed | Physical phone timing needed. The targets of 5 minutes for light mode and 10 for strong mode are acceptance criteria. |

Always include APK download, install and returns from Settings when timing a real phone. For a reset
phone, log the reset separately as well as the total. For light mode, record whether Chrome already
has installation permission and whether Android asks for restricted settings, since these can add
several taps. Repeat with TalkBack and large text on real Android hardware.

## Screenshots and release checks

[Web screenshots](img/setup/) use a local frontend with synthetic responses. The examples cover the
mode choice, name, PIN, each QR handoff, Wi-Fi, install help, the connected page, and the guides in
light and dark mode, including the previous strong-mode QR screen for comparison. On Android each permission screen uses the app's light or dark theme, a short
instruction, a small settings illustration and a button to open the system prompt or Settings.
The connection screen has a check-mark illustration and shows either progress, retry or renewal.
On Android 11 and newer, background location is granted from App info, as described in the
[Android background location documentation](https://developer.android.com/develop/sensors-and-location/location/permissions/background).
Android system dialogs and the app screens were described from the code. Capture them during
physical-device testing.

Strong mode starts inside Android's provisioning screens. Plainphone cannot report download or
installation progress before it runs. The dashboard waits for an actual enrollment and then shows
the connection. On Android 10–13, also confirm the default phone-app dialog and check the phone's
reported lock status.

There is no migration, environment change or new dependency. Release an APK containing the
browser-to-app handoff before publishing the light-mode guide and dashboard flow. Test Chrome to
APK to Chrome to Plainphone on Android 10 and Android 13 or newer, including OnePlus, Xiaomi and
Samsung battery settings where available. Use the scripts and manual steps in
[setup-test-phone.md](setup-test-phone.md) for strong-mode hardware checks, and try both a regular
Wi-Fi network from the picker and Wi-Fi in the QR code.
