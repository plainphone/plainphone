# Brand direction C rollout: before and after

Screenshots of every surface outside the site, before and after moving to brand direction C, "Switch" ([brand guide](../../brand/README.md), [tokens](../../design-tokens.md)). All data is synthetic (Sam Demo, example.org).

| Prefix | Surface | How |
| --- | --- | --- |
| `web-` | Web dashboard: phone list, a phone, its settings, account settings, sign-in | `capture-web.mjs`: Vite dev server, API answered by fixtures |
| `expo-` | Parent app: sign-in, phone list, a phone, settings | `capture-expo.mjs` on `expo export --platform web`. The web build uses the system font; the native apps get Schibsted Grotesk |
| `mail-` | Every server mail: sign-in, invite, approval request, protection removed, offline, SOS | `capture-mail.mjs`, the logo served from disk |
| `android-` | Home screen, Maintenance, ring screen, keypad, icons and notification | Robolectric screenshot tests (`HomeScreenshotTest`, `MaintenanceScreenshotTest`, `SafetyScreenshotTest`, `BrandIconsScreenshotTest`) copied from `android/app/build/screenshots/` |

Each name ends in `-before` or `-after`. Some Android shots only have an `-after`: the grey launcher palette, the keypad (its call button is now ink, not green) and the icon sheet (adaptive launcher icon, themed icon, status bar and notification icon) come from tests added in this change.

What to look for: one mark (the switch) everywhere, graphite actions in light and signal green in dark, signal green only on switches that are on and on the mark, red only for danger and SOS, Schibsted Grotesk and IBM Plex Mono, and the white notification icon instead of a square.
