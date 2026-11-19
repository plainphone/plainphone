# Common design tokens

One set of colour roles, light and dark, is used on every surface. The proposal and its reasons are in [the UX research](research/ux-premium.md#shared-design-system-proposal). This page says where each surface keeps its copy and what is checked.

The site (plainphone.org) has already moved to brand direction C, "Switch". Its values are the `palette:c` table in the [brand guide](brand/README.md#direction-c--switch), in `site/src/style.css` under the same role names (`--paper`, `--sheet`, `--ink`, `--pencil`, `--divider`, `--outline`, `--action`, `--on-action`, `--tint`, `--attention`, `--danger`, `--brand`, `--on-brand`). The other surfaces keep the table below until the direction C rollout changes them.

| Role | Light | Dark | Web dashboard | Expo parent app | Android |
| --- | --- | --- | --- | --- | --- |
| Paper | `#f2f3ef` | `#121816` | `--bg` | `bg` | `paper` |
| Sheet | `#ffffff` | `#1b2320` | `--surface` | `surface` | `sheet` |
| Ink | `#1c2321` | `#e8ece9` | `--ink` | `ink` | `ink` |
| Pencil | `#4d5753` | `#a9b3ae` | `--muted` | `muted` | `pencil` |
| Divider | `#dfe3df` | `#2c3833` | `--line` | `line` | `divider` |
| Control outline | `#7a8580` | `#6b7873` | `--border-strong` | `borderStrong` | `outline` |
| Action and focus | `#24604a` | `#7fc4a2` | `--accent`, `--focus` | `accent` | `action` |
| On action | `#ffffff` | `#0d1a14` | `--on-accent` | `onAccent` | `onAction` |
| Tint | `#e3efe8` | `#22322b` | `--tint` | `tint` | `tint` |
| Attention fill | `#fbf1d9` | `#33301f` | `--warn-bg` | `warnBg` | `attention` |
| Danger text | `#a3261d` | `#f08a80` | `--danger` | `danger` | `danger` |
| Danger fill | `#fbe9e7` | `#3a2321` | `--danger-bg` | `dangerBg` | `dangerFill` |

- **Files.** `web/src/styles.css`, `parent-app/src/lib/theme.ts`, `android/app/src/main/java/org/plainphone/app/ui/Tokens.kt` (used by `Theme.kt` and `MaintenanceStyle.kt`).
- **Android call buttons.** Round buttons with a white glyph use `dangerSolid` and `answerSolid`: `#a3261d` and `#24604a` in light, `#c9473d` and `#2e7d4f` in dark, so the white glyph stays at 4.5:1 and the button at 3:1 against the paper.
- **Launcher palettes** (sage, sand, grey) are intentional and keep their own values in `home/HomeColors.kt`.
- **Shape.** Grouped surfaces use a 12 unit radius, controls 10 (`--radius`/`--radius-sm` on the web, `radius`/`radiusControl` in Expo, 10 dp in the Maintenance screen).
- **Type.** The web dashboard uses Atkinson Hyperlegible Next (OFL); the site uses direction C's Schibsted Grotesk and IBM Plex Mono (OFL) with a system fallback (`system-ui`, Segoe UI, Roboto, Helvetica Neue, Arial). It covers æ, ø, å and the digits. Expo and Android keep the system font: React Native needs a TTF or OTF and the phone-side screens are small, so the font was not bundled there. Sizes are rem, sp and scalable text units and labels wrap at large text.

## Checks

- `cd site && npm run check` runs `scripts/tokens.test.mjs`. It fails when one surface's value differs from the table, when the site differs from the brand guide's direction C table, or when a text pair drops below WCAG AA (4.5:1 text, 3:1 control outline).
- `android/.../ui/TokensContrastTest.kt` checks the same pairs in Kotlin, including call buttons, and every launcher palette in light and dark.
- `MaintenanceScreenshotTest` renders the Maintenance screen (PIN prompt, actions, release confirmation) in light, dark, large text and Danish to `android/app/build/screenshots/`.

## Maintenance screen

The Maintenance screen is plain Android views (it has to work when nothing else does) styled by `MaintenanceStyle.kt`: 16 sp text that wraps, 48 dp buttons, a 3 dp focus and pressed outline, and a red outline on the release button. A wrong PIN keeps focus in the PIN field and the message is announced. The release dialog names the action ("Release the phone" or "Switch off", Danish "Frigiv telefonen" and "Slå fra"), shows it in red, and starts keyboard/D-pad focus on the safe answer ("Keep it on"/"Behold den"; in touch mode buttons take no focus).
