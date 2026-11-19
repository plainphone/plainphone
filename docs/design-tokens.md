# Common design tokens

One set of colour roles, light and dark, is used on every surface: brand direction C, "Switch", from the [brand guide](brand/README.md#direction-c--switch) (graphite and white with one signal green). The proposal behind the roles is in [the UX research](research/ux-premium.md#shared-design-system-proposal). This page says where each surface keeps its copy and what is checked. The values are the guide's `palette:c` table.

| Role | Light | Dark | Site | Web dashboard | Expo parent app | Android |
| --- | --- | --- | --- | --- | --- | --- |
| Paper | `#f5f5f3` | `#0f0f0f` | `--paper` | `--bg` | `bg` | `paper` |
| Sheet | `#ffffff` | `#1b1b1b` | `--sheet` | `--surface` | `surface` | `sheet` |
| Ink | `#141414` | `#f2f2ef` | `--ink` | `--ink` | `ink` | `ink` |
| Pencil | `#525252` | `#b3b3ae` | `--pencil` | `--muted` | `muted` | `pencil` |
| Divider | `#e3e3e0` | `#2d2d2b` | `--divider` | `--line` | `line` | `divider` |
| Control outline | `#767676` | `#7c7c78` | `--outline` | `--border-strong` | `borderStrong` | `outline` |
| Action and focus | `#141414` | `#c5f04a` | `--action` | `--accent`, `--focus` | `accent` | `action` |
| On action | `#ffffff` | `#141414` | `--on-action` | `--on-accent` | `onAccent` | `onAction` |
| Tint | `#eef8cf` | `#27301a` | `--tint` | `--tint` | `tint` | `tint` |
| Attention fill | `#fff2c2` | `#393217` | `--attention` | `--warn-bg` | `warnBg` | `attention` |
| Danger text | `#b3261e` | `#ff8a80` | `--danger` | `--danger` | `danger` | `danger` |
| Danger fill | `#fde8e6` | `#3e1f1d` |  | `--danger-bg` | `dangerBg` | `dangerFill` |
| Brand (signal green) | `#c5f04a` | `#c5f04a` | `--brand` | `--brand` | `brand` | `brand` |
| On brand | `#141414` | `#141414` | `--on-brand` | `--on-brand` | `onBrand` | `onBrand` |

- **Files.** `site/src/style.css`, `web/src/styles.css`, `parent-app/src/lib/theme.ts`, `android/app/src/main/java/org/plainphone/app/ui/Tokens.kt` (used by `Theme.kt` and `MaintenanceStyle.kt`). The server's mails (`server/src/lib/mail-templates.ts`) use the same values inline.
- **Signal green means "on".** `brand` is only a fill for switches that are on, the mark and active states, always with `onBrand` on it. On light it gets an ink edge (`--brand-edge` on the web, `brandEdge` in Expo), because it is 1.2:1 against the paper. It is never decoration, a warning or a call button. In dark mode it is also the action colour (links, focus ring, primary buttons), as in the guide, except on SOS: the dashboard's SOS alert has an ink or red edge and the SOS mail an ink button.
- **Android call buttons.** Decline and end call are red with a white glyph (`dangerSolid`: `#b3261e` light, `#c9473d` dark). Answer and the keypad's call button are ink, not green (`answerSolid` with `onAnswerSolid`: `#141414` with white in light, `#f2f2ef` with `#141414` in dark). Every glyph is at least 4.5:1 and every button 3:1 against the paper. SOS and 112 stay red.
- **Launcher palettes** (graphite, sage, sand) keep their own values in `home/HomeColors.kt`. Graphite is direction C's graphite and the default for new phones (stored as `grey`); sage and sand are softer choices for the child's home screen. Phones that existed before graphite became the default were set to sage by migration 0039, so nothing changes for them.
- **Shape.** Surfaces and controls use a 6 unit radius and buttons are pills (`--radius`/`--radius-sm` on the web, `radius`/`radiusControl`/`radiusPill` in Expo, 6 dp and pill buttons in the Maintenance screen). No shadows.
- **Type.** Schibsted Grotesk 400/700 for text and headings and IBM Plex Mono 500 for times and codes, both OFL, on every surface. The site and the web dashboard ship them as woff2 build assets (`web/src/fonts/`, a variable Schibsted Grotesk), Expo as static TTFs linked by the `expo-font` plugin (`parent-app/assets/fonts/`, family `Schibsted Grotesk` and `IBMPlexMono-Medium`), Android as font resources (`res/font/`, used by `PlainphoneTheme` and `MaintenanceStyle`). The licences are next to the files (Android: `assets/licenses/`). They are subset to Latin and cover æ, ø, å, ä, ö, ü, ß, the digits and Danish and German quotes. Where a font cannot load, the system font is used. `docs/brand/tools/product-fonts.py` rebuilds every file from the pinned google/fonts commit. Sizes are rem, sp and scalable text units and labels wrap at large text.
- **Icons.** Rendered from `docs/brand/directions/c/*.svg` by `web/scripts/make-icons.mjs`, `parent-app/scripts/make-icons.mjs` and `android/scripts/make-icons.mjs`; see the [inventory](brand/README.md#asset-inventory).

## Checks

- `cd site && npm run check` runs `scripts/tokens.test.mjs`. It fails when the site, the web dashboard, the Expo app or Android differs from the brand guide's `palette:c` table, or when a text pair drops below WCAG AA (4.5:1 text, 3:1 control outline, ink on signal green).
- `android/.../ui/TokensContrastTest.kt` checks the same pairs in Kotlin, including call buttons (and that answer is never signal green), and every launcher palette in light and dark.
- `MaintenanceScreenshotTest` renders the Maintenance screen (PIN prompt, actions, release confirmation) in light, dark, large text and Danish to `android/app/build/screenshots/`. `BrandIconsScreenshotTest` renders the launcher icon (adaptive and themed) and the notification icon in light and dark, and fails if the notification icon has colour in it.

## Maintenance screen

The Maintenance screen is plain Android views (it has to work when nothing else does) styled by `MaintenanceStyle.kt`: 16 sp text that wraps, 48 dp pill buttons, a 3 dp ink focus and pressed outline on the sheet colour (so it shows on the ink and signal-green primary button too), and a red outline on the release button. A wrong PIN keeps focus in the PIN field and the message is announced. The release dialog names the action ("Release the phone" or "Switch off", Danish "Frigiv telefonen" and "Slå fra"), shows it in red, and starts keyboard/D-pad focus on the safe answer ("Keep it on"/"Behold den"; in touch mode buttons take no focus).
