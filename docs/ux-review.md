# Parent dashboard UX review

## Scope and method

Reviewed the production PWA build in sandboxed Chromium against the local Hono server and an isolated, migrated PostgreSQL database. The fixture followed the magic-link and device pairing flow from `server/test/e2e/phone-sync-server.ts` and `server/test/harness.ts`. It used synthetic child, self and pending-setup phones, installed apps, a contact, screen-time usage and limits, and a last known position. No actual phone was connected.

The screenshot matrix covers 390 and 1280 CSS px, light and dark mode, and 100% and 200% root text size. The browser used Danish and the Copenhagen timezone. External requests were blocked, so the location screen shows the map fallback, the position's timestamp and accuracy, and the route links. Service workers were disabled for repeatable captures. This is a desktop-browser text resize check with narrow and wide viewports. Native browser text settings, service-worker behavior and screen-reader speech require separate device checks.

The review used [WCAG 2.2](https://www.w3.org/TR/WCAG22/) AA for contrast, resize, focus and keyboard criteria, plus a project target of 44 CSS px for controls. The design principles arrived on main during the review. The changes follow the guidance on [visible location sharing and neutral language](design-principles.md). The dashboard still explains child-visible sharing and its time limits. The follow-up removes four unused translation keys.

## Before and after

Before/after captures of the six priority screens and Key (390 and 1280 px, light and dark, 100 and 200 % text) were taken with Playwright during the review. They are not kept in the repository to keep clones small; regenerate them with the same Playwright run against a mock API. The route assessment below describes the wider screenshot set.

| Screen | Before | After |
| --- | --- | --- |
| Phones | The title and add button aligned to different baselines. Unpaired phones also said they had never checked in. | The list starts below a single header row. “Not set up” is the only sync-related status shown for an unpaired phone. |
| Phone overview | Routine device diagnostics pushed links to everyday controls down the page. | Everyday links lead, in one column on mobile and two on desktop. A lone final link spans both desktop columns. Pending changes appear above the rule links and can be cancelled there. A reported lock problem still precedes those links. |
| Apps | The catalog's large entry row competed with search and the installed apps. | The catalog is a compact secondary action near the title. The search status region stays mounted as the results change. |
| Contacts | An information panel displaced the actual contact list. The form looked like a second list card. | A note under the page title explains that the list only covers calls and texts. The form has a simple divider, and contact actions can wrap. |
| Screen time | Today's usage looked like an editable part of the form. The weekday expander looked like a plain link. | Usage comes before the controls. The weekday expander shows its native open or closed marker and works with the keyboard. Each app's bonus button shows that extra time applies today and includes the app name in its accessible name. |
| Key | The payment fields overflowed on a 390 px viewport at 200% text. | The fields can stack within their container. |
| Location | Find, ring and check-in competed for attention. The ring option ran into its action. | Find remains primary when available. Ring and check-in are secondary, the ring option has breathing room, and the selected sharing mode has a visible surface tint. Map zoom buttons have 44 px targets. |

The shared header wraps with large type so navigation remains visible. The skip link moves focus to main content, and route headings retain their existing programmatic focus. The main controls keep the existing green accent, legible text colors and native focus outlines.

## Remaining findings

| Priority | Screen | Finding |
| --- | --- | --- |
| P2 | Login | Clear email-first flow. Verify the sent-link, expired-link and resend states with keyboard and a screen reader. |
| P2 | Browser sign-in callback | The missing-token screen gives a recovery action. Verify a valid and an expired magic link end to end. |
| P2 | App sign-in callback | The missing-token fallback renders, but the valid link handoff and browser alternative need device testing. |
| P2 | Invitation | The missing-link message is clear. Add a way back and check successful acceptance with a second account. |
| P3 | Household | Member details and invitation already have separate headings. Exercise the populated multi-member, duplicate-invitation and permission states. |
| P2 | Approvals | The empty state explains the purpose. Review a populated queue with a second account, including focus after approve or decline. |
| P2 | Settings | Notification controls and account removal are visually distinct. Verify browser permission denial and device-specific push enrollment. |
| P2 | Phone settings | The four groups and expandable help make the page navigable. Three-way controls break long labels into narrow columns at 200% text. Review a stacked control layout and focus after saving a setting. |
| P2 | Home screen | The preview makes the effect of layout and palette choices visible. Check focus when reordering a populated list and clarify that changes reach the phone on sync. |
| P2 | Add phone | The ownership choice is clear. Review the complete multi-step path with a screen reader. The inline code link measures under 44 px at standard text size. |
| P2 | Finish phone setup | PIN inputs have visible labels and help. Verify QR scanning, token expiry and keyboard focus after the step changes. |
| P3 | Pair a phone | Code and profile are labelled. The code's example and error copy need checking with a phone showing a live pairing code. |
| P3 | App catalog | Categories and search give two useful paths. Check long translated app names and focus after expanding or requesting an app. |
| P2 | Web filter | The category list is scannable. The allow and block forms repeat similar prompts. Review error feedback and the technical details disclosure, including its target size. |
| P2 | School and bedtime | The empty state leads to the creation action. Check the populated schedule editor, day selectors and locale-specific time input. |
| P3 | Key | The alternatives are labelled. The payment/unlock explanation dominates the lower half, even when payment is unavailable. |
| P2 | Location | Verify real map controls and fallback transitions on mobile Safari and Android. Countdown announcements during active ring and check-in should be reviewed for verbosity with a screen reader. |
| P3 | Phone overview | “Last seen” is repeated in the title metadata and status. Consolidate it when the technical status wording is next reviewed. |

## Verification

Playwright captured 160 baseline views across 20 routes. Seven routes overflowed at 390 px and 200% text in both themes before the change. The final matrix covers 176 views across 22 routes, including Home screen and Phone settings, which arrived on main during the review. All 176 fit the viewport. Axe reported zero violations for the selected WCAG A and AA rules across the 24 mobile views of the priority screens. A separate pass measured rendered buttons, links, disclosure controls and clickable option labels against the 44 px target. The inline code link on Add phone was the remaining exception.

Browser interaction checks passed for the skip link, keyboard navigation to a phone and its Apps page, app search and switching, contact validation and creation, the weekday expander, an empty app list, and Location loading, error, retry and map fallback. Both zoom controls measured 44 × 44 px and responded to Enter with a local map style fixture. The route matrix included empty approvals and schedules plus the missing-token states for invitations and sign-in callbacks. Real devices, mail delivery, successful app-link handoff, push permission and map tiles remain open.

The automated checks sampled the rendered controls and text. Manual screen-reader testing remains open.

The review follow-up captured 24 views before and 24 after across Apps, Screen time and the phone overview using the same widths, themes and text sizes. All follow-up views fit the viewport. Browser assertions verified that app search kept the same status node when the last match disappeared and cleared it when a match returned. They also verified the app bonus button's accessible name in Danish and English and measured the desktop link corner radii on hover.

The final review round captured the child and Self phone overviews at 390 and 1280 CSS px in both themes. Playwright verified that the odd desktop grid fills its last row, the Self overview can cancel a pending change above the rule links, and both per-app time buttons expose the visible label followed by the app name. It also checked that the contacts note follows the page title and that the skip link focuses main content.

## Dashboard copy follow-up

A web filter update that the server could not deliver leaves the previous filter rules in effect while Plainphone retries. This differs from rules that wait for the phone to come online. The Self profile explains that the next connection applies stricter rules and that loosening rules still waits for the key.

The phone removal and account deletion confirmations distinguish the custom web filter from the lock and other rules that stay on the phone. Account deletion also explains that households with no other caregiver and their stored phone data are permanently deleted. See [Deleting accounts, phones and old data](account-deletion.md).

Before and after captures compared the phone overview, Key and Web filter using the same mock Self phone and a pending web filter update. Playwright covered 390 and 1280 CSS px in both light and dark mode.
