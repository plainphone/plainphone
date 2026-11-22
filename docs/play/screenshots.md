# Store screenshots and graphics: plan

No store graphics exist yet ([brand guide, asset inventory](../brand/README.md#asset-inventory)).
This is the plan; nothing here is faked. Every screenshot must be a render or capture of the real
app, with invented names (Sam, Alex, Robin) and invented numbers.

## Play's requirements

From [Add preview assets to showcase your app](https://support.google.com/googleplay/android-developer/answer/9866151)
(read 22 November 2026):

| Asset | Requirement |
|---|---|
| App icon | 512 × 512 px, 32-bit PNG, up to 1024 KB |
| Feature graphic | 1024 × 500 px, required to publish |
| Phone screenshots | 2 to 8 per language, PNG or JPEG, up to 8 MB, each side 320 to 3,840 px, **9:16** portrait (or 16:9 landscape) |
| Content | The app's interface only: no device frames, extra text or backgrounds that are not part of the app |

## The existing renders do not fit as they are

The Android renders under [`docs/screenshots/`](../screenshots/) are 1179 × 2556 px (and
786 × 1704), a ratio of about 1 : 2.17. Play wants 9 : 16 (1 : 1.78). Two honest ways:

1. **Render again at 1080 × 1920** (preferred). The renders come from the Robolectric screenshot
   tests (for example `ChildNextActionScreenshotTest`, qualifiers `w393dp-h852dp-xxhdpi`). A run
   with `w360dp-h640dp-xxhdpi` gives 1080 × 1920: the same screens at the right ratio, in all
   five languages, light and dark, without new code in the app.
2. **Crop** a 1179 × 2096 window from the existing files. That cuts the bottom of most screens
   (the Phone and Messages buttons and SOS on the home screen), so it only works for a few.

Padding to 9:16 with a coloured band is not allowed (it adds a background).

F-Droid has no fixed ratio, so the existing files can be used there as they are.

## Phone app (Play edition: light mode, Child profile)

Use direction C (Switch) screens only; the folders `ux-child-next-action/` and `ux-common-tokens/`
show the earlier green palette.

| # | Screen | Existing render to start from | Notes |
|---|---|---|---|
| 1 | Home: the clock, the chosen apps, Phone and Messages, "Do you need someone to talk to?" and SOS | `graphite-default/android-home-light-list-graphite-default.png` | Replace real app names (Spotify, DR LYD, Rejseplanen) with generic ones or Plainphone's own; third-party marks in screenshots invite an intellectual property complaint |
| 2 | Messages with the Family thread | `phone-messages-redesign/android-messages-family-en-light-after.png` | |
| 3 | A conversation | `phone-messages-redesign/android-conversation-en-light-after.png` | |
| 4 | Contacts (approved contacts) | `phone-messages-redesign/android-contacts-en-light-after.png` | |
| 5 | Bedtime on the home screen | `bedtime-pin/home-bedtime-light.png` | Shows that times are visible to the child |
| 6 | The stop screen for an app that is not allowed, with "Call or message a parent" | none in direction C yet | Render it new (the existing ones are the old palette) |
| 7 | Ring the phone ("I'm here") | `brand-rollout-switch/android-ring-en-light-after.png` | |
| 8 | Dark mode or large text, any of the above | `brand-rollout-switch/android-home-dark-school-after.png`, `phone-messages-redesign/*-large-after.png` | Shows readability |

Per language: en-US from the `-en-` renders, da-DK from `-da-`, sv-SE, nb-NO and de-DE from the
matching renders where they exist (`phone-messages-redesign/` has all five for several screens);
the home, bedtime and ring screens need new renders in sv, nb and de.

## Parent app

The only parent-app captures (`brand-rollout-switch/expo-*-after.png`, 780 × 1688) are in Danish
and show a demo phone in strong mode with "App-version 1.0". They are fine as a reference for the
da-DK listing after cropping, but a proper set needs new captures from the Expo app on an Android
emulator, 1080 × 1920, in all five languages, light and dark:

| # | Screen | Existing reference |
|---|---|---|
| 1 | Phones overview with one child phone | `brand-rollout-switch/expo-phones-light-after.png` |
| 2 | A phone's page: Apps, Contacts, Web filter, Screen time, School and bedtime | `brand-rollout-switch/expo-phone-light-after.png` |
| 3 | A request from the child for more time, with Approve and Decline | none |
| 4 | Find: the map with the latest position and the notice "Sam can see that you asked" | none (use an invented position, not a real home) |
| 5 | Sign-in by email link | `brand-rollout-switch/expo-login-light-after.png` |
| 6 | Settings with "Delete my account" | `brand-rollout-switch/expo-settings-light-after.png` |

## Feature graphic and icon

- **Icon (512 × 512):** export from `docs/brand/directions/c/` with the same pipeline that makes
  the launcher icons (`android/scripts/make-icons.mjs`, `parent-app/scripts/make-icons.mjs`).
- **Feature graphic (1024 × 500):** the direction C switch mark and the wordmark on paper
  `#f5f5f3`, nothing else. No claims ("safe", "protected"), no device photos, no child imagery.
  The site's share images (`site/src/og-*.png`, made by `site/tools/make-images.mjs`) are the
  closest existing design and can be the starting point.

## Where files go

Fastlane `supply` reads images from `images/` next to the texts:

```
fastlane/metadata/android/<locale>/images/icon.png
fastlane/metadata/android/<locale>/images/featureGraphic.png
fastlane/metadata/android/<locale>/images/phoneScreenshots/1.png … 8.png
```

and the same under `parent-app/fastlane/metadata/android/<locale>/` for the parent app.
