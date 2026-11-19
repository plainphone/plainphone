# Plainphone UX research: clarity under pressure

A parent should see in one glance whether a phone is ready, whether a change reached it, and what they can do next. A child should be able to call a parent or understand a rule without reading a settings screen. Spend the polish budget on those moments first. Keep the paper, ink and pencil palette, the quiet green accent, and the site's Atkinson Hyperlegible Next.

## Evidence and scope

[Design principles](../design-principles.md) govern this review, especially child-visible rules, a clear next action on blocked screens and gradual independence. The [previous dashboard review](../ux-review.md) already addressed common layout and large-text defects. Its automated results apply to its own fixture and revision.

The site and dashboard evidence below comes from the 390 px local-development screenshot set in commit `1e0ddc5`, with Danish fixture names Alex Demo and Sam Demo. The rules screenshot shows a school schedule. The QR is a historical fixture. The findings distinguish visible observations from hypotheses based on source. The Expo recommendations are source-based and point to equivalent web screens for comparison. No Android screenshots are included: the Android project has Robolectric unit tests but no screenshot-test tooling (Roborazzi, Paparazzi) and no Compose previews that render the screens, and adding a dependency is outside a research-only task. The Android findings are therefore source-based. Package 3 should add a screenshot harness with fixture names first, so before/after captures exist. Native Expo rendering, cameras, device settings, screen-reader speech and user outcomes are unverified. Effort is relative for a small PR (S), a couple of coupled flows (M), or device and state coordination (L). Within each surface, findings are ranked by plausible impact under pressure. These rankings are expert judgments, pending task tests with families.

## Benchmarks

The following judgments use first-party public documentation and illustrations. The benchmark pass used 12 search queries. Native interactions and accessibility were not independently tested. Product patterns provide design precedents. They cannot establish outcomes for Plainphone.

| Product | What feels considered, where simplicity breaks, and what Plainphone can use |
| --- | --- |
| Light Phone | A stable menu returns to a short, user-arranged toolbox. Adding a missing tool in a separate dashboard makes recovery less discoverable. Keep essential calls in a fixed place and say where optional tools are managed. [Toolbox](https://support.thelightphone.com/hc/en-us/articles/360039578512-Toolbox-Menu) |
| Punkt MP02 | Physical call and text access makes the core tasks predictable. Long presses and context-dependent keys have a learning cost. Keep stable, labelled Call and Text actions in Plainphone. [Keypad guide](https://support.punkt.ch/en-US/how-to-use-the-keypad-on-the-mp02-1962771) |
| Balance Phone | Retaining familiar utility apps and publishing a URL checker makes the system boundary legible. Whole-category defaults can hide useful exceptions. Explain scope and exceptions in each phone's settings. [FAQ](https://www.thebalancephone.com/pages/faqs) |
| Things 3 | Quiet project headings and a persistent add control make lists scannable. Drag-to-insert has a low discovery rate as a sole control. Make the visible action sufficient and gestures optional. [Features](https://culturedcode.com/things/features/) |
| Linear | Row-local menus display shortcuts and name actions in context. A broad command menu suits frequent expert use and adds choices for families. Use keyboard parity and put secondary actions beside the relevant row. [Interaction details](https://linear.app/now/invisible-details) |
| Apple Screen Time | The request can be answered where the parent sees it, in Messages or Settings. Multiple entry points need a consistent result. Show the same resolved or expired request on both parent surfaces. [Respond to a request](https://support.apple.com/guide/iphone/respond-to-a-screen-time-request-iph74e434e84/ios) |
| Google Family Link | Bonus time is scoped to a device and today, leaving the recurring schedule intact. Child, device, app and schedule levels can be confused. Put “i dag” on the specific phone's action and outcome. [Bonus time](https://support.google.com/families/answer/15938652) |
| Opal | The duration and difficulty settings make the session commitment explicit. Gems and streaks turn self-regulation into collecting. Keep an end time and an exit explanation. [Help centre](https://help.opalapp.com/) · [Streaks](https://help.opalapp.com/article/how-to-gain-streaks-and-focus-hours) |
| one sec | A brief pause at app launch puts the choice at the moment it matters. Math, camera or moving-dot interventions can make leaving harder. Keep the adult pause optional, short and immediately dismissible. [Interventions](https://feedback.one-sec.app/help/articles/7507890-customize-the-intervention-android) · [Field study](https://pubmed.ncbi.nlm.nih.gov/36795756/) |
| Bark | Showing the current routine to both parent and child makes a schedule predictable. Monitoring categories and alerts can create a dashboard the parent feels obliged to check. Mirror the active rule on the phone and save notices for actionable device problems. [Schedules](https://support.bark.us/hc/en-us/articles/360050415931-Manage-your-kid-s-screen-time-schedule) · [Monitoring scope](https://support.bark.us/en/articles/13461018-what-does-bark-s-monitoring-do-vs-screen-time-filtering) |

## Web dashboard

Keep the existing grouped rule list, conservative accent and plain date/time labels. The following findings build on `web/src/pages/{AddPhone,InstallPhone,Phones,Phone,Approvals,Schedules}.tsx`.

| Rank and evidence | Problem and proposed change | Effort and simplicity |
| --- | --- | --- |
| 1. Setup and QR · [Add](img/ux/web-add-light.png), [QR](img/ux/web-setup-qr-light.png) | The sign-in link path needs a separate expired-link test. In the captured flow, the small route to code entry and the QR's first instruction below a large image can cost a parent a return trip. Put the expected Android screen above the code, keep the full quiet zone, and provide a visible step label and high-contrast code-entry route where supported. Model waiting, expired, connected and retry separately. Keep the selected phone and setup path when generating a new code. | M. One action per step and a clear recovery path. |
| 2. Phone list and overview · [List](img/ux/web-phones-light.png), [Overview](img/ux/web-phone-light.png) | The list already distinguishes unpaired phones. The overview can show “Sidst online nu” alongside “Ingen status fra telefonen endnu”, which reads like a contradiction. Reserve one row for the next action and distinguish last connection from verified applied rules. Put low-level diagnostics under a disclosure. Preserve the last known status and timestamp on refresh failure. | S. One meaningful status per row. |
| 3. Approvals · [Queue](img/ux/web-approvals-light.png) | The compact before/after limit is useful. The request and the scan action compete, and the row lacks a visible phase after decision. Put unresolved decisions first, show duration and affected phone, and replace processed rows with a brief outcome in place. Prevent repeated activation, retain context on conflict, move focus to the next request or queue summary. Pair the empty state with the scan action. | M. One decision with an unambiguous result. |
| 4. Rules · [School time](img/ux/web-rules-light.png) | Schedule details are readable but Edit, Delete and Add are all prominent. Keep current scope in plain text, put Edit beside the schedule, confirm removal separately, and show saving, waiting for the phone and applied based on acknowledgments. Keep draft inputs on a network error. | M. One primary task and clear consequences. |

## Android strong mode

Source anchors include `home/HomeScreen.kt`, `ui/PhoneActivity.kt`, `ui/InCallActivity.kt`, `ui/ApprovedContactsActivity.kt`, `light/CalmScreen.kt` and `MaintenanceActivity.kt`. The screenshot register below identifies rendered coverage.

| Rank and evidence | Problem to verify and proposed change | Effort and simplicity |
| --- | --- | --- |
| 1. Launcher and dialer · home fixture plus PhoneActivity | A large-text grid and a numeric entry screen must still make help easy to find. Keep a fixed labelled route to parents and 112 as the launcher scrolls, with one accessible target per action and number-entry announcements that avoid echoing the whole number. Keep the system's dialer haptics where available. | M. A child learns one place to call from. |
| 2. Stop/calm · CalmScreen, no direct screenshot fixture | Keep the existing reason-first layout. Add the next available time when the policy actually provides one. Retain the large title and use at least 18 sp for the child-facing instruction. Lead with the available next action, such as returning home or asking for more time when supported. Keep emergency and parent reachability. Use no repeated pulse, animation or vibration. | M. One rule, one next action. |
| 3. SMS and contacts · PhoneActivity and ApprovedContactsActivity, history fixture is read-only | Distinguish approved contacts and empty inbox from a failed load, and sending from sent or failed. Preserve message drafts on a recoverable error, give Retry beside that message and avoid announcing private content in status messages. Use a full-row labelled action and wrapping names, retaining initials where helpful. | M. A child can tell whether the message went through. |
| 4. Maintenance · Android resources and MaintenanceActivity, direct capture unavailable | PIN, temporary opening and release have very different consequences. Lead with current lock state and the next adult action. When an opening is active, show the end time and “Lås telefonen nu”. Keep release behind confirmation with a plain explanation. Inline PIN errors retain focus. | M. Routine maintenance stays separate from leaving the arrangement. |

## Android light mode and Myself

Source anchors are `light/LightSetupActivity.kt`, `light/LightSetup.kt`, `light/CalmScreen.kt` and `values-da/strings.xml`. Steps after a system handoff are sensitive to Android version and manufacturer.

| Rank and evidence | Problem to verify and proposed change | Effort and simplicity |
| --- | --- | --- |
| 1. Permissions and restricted settings · Android setup source, [site handoff](img/ux/site-setup-light.png) for comparison | The restricted-settings recovery is one long conditional sentence. Break it into short ordered instructions with literal Android labels, one action to open Appinfo, the existing Retry after return, and optional permissions labelled with the effect of skipping. Verify the existing permission check on return before advancing. Keep help visible if the same step fails again. | M. The parent only needs to remember the next action. |
| 2. Guard calm screen · CalmScreen, direct capture unavailable | An adult's deliberate pause and a child's schedule limit need different wording. Keep the current reason-specific copy. Replace the generic “OK” with the destination “Tilbage til start”. Use a neutral fallback when the reason is unknown and explain any available request or override. A brief static switch of state is enough. Avoid blocking feedback for the optional adult pause. | M. A single screen explains the relevant choice. |
| 3. Key, undo and buddy · setup choices in LightSetupActivity, [approval preview](img/ux/web-approvals-light.png) as cross-device reference | The setup combines time to undo, the key for relaxing later rules and invitations. Give each choice one consequence sentence and show a final summary with the actual undo and wait values. Name which rule applies while a buddy invitation is pending, with the actual fallback time. Allow going back before commitment without losing choices. | M. The adult sees what they can undo now and what requires approval later. |
| 4. QR approval · SelfApprovalAction and [web queue](img/ux/web-approvals-dark.png) | Invite and approval codes have different intent. Label what scanning will do and distinguish preparing, ready, expired and answered. Let the helper review the change before deciding and use a short confirmation haptic only after success, where enabled and supported. Never treat a scan as consent. | M. One code, one purpose, one result. |

## Expo parent app

The parent app already borrows translations and palette roles from the web dashboard. Review anchors are `parent-app/src/app/{index,pair,approvals}.tsx`, `src/app/phones/[pid]/index.tsx` and `src/components/ui.tsx` within the app.

| Rank and evidence | Problem to verify and proposed change | Effort and simplicity |
| --- | --- | --- |
| 1. Phone overview and rules · [web comparison](img/ux/web-phone-dark.png) | The Expo overview can place several notices and version details around essential rule links. Keep the highest-priority repair and pending changes near the title, then the same rule groups and status vocabulary as web. Collapse non-urgent diagnostics. Keep the current content visible during refresh. | M. Parents find the same actions in the same order. |
| 2. Approvals · [web comparison](img/ux/web-approvals-light.png) | The entry on the phone list is a generic link. Show a short pending count only when action is needed. Make status consistent across web and Expo when another carer answers or a code expires. Announce the final result once, retaining focus on a stable element. | M. A parent knows whether any decision is still theirs. |
| 3. Pairing · [web comparison](img/ux/web-add-dark.png) | Opening the camera, waiting for lookup and entering a code are distinct states. Keep manual code entry adjacent to Scan, retain entered fields on lookup errors, and give camera denial a usable fallback. Show one primary action for the current step. Check long hints and keyboard overlap on both OSs. | M. Pairing survives a denied permission or interrupted scan. |

## Public site

| Rank and evidence | Problem and proposed change | Effort and simplicity |
| --- | --- | --- |
| 1. Setup · [Light](img/ux/site-setup-light.png), [dark](img/ux/site-setup-dark.png) | Mode choices are underlined boxes and repeat as headings lower on the page. Use the same “new or reset” and “already in use” labels as the dashboard, set one action under each short choice and state whether it preserves existing content. Keep the guide's platform details under the relevant path. | S. One decision before a handoff. |
| 2. Home · [Light](img/ux/site-home-light.png), [dark](img/ux/site-home-dark.png) | The hero is direct and the early-release warning is honest. Multi-line strikethroughs make the optional exclusions hard to read, including at large text. Retain the warning with the site's semantic warning colours and describe available and configurable capabilities under short headings. Keep the same factual qualifier for filtering as in setup. | S. The reader learns what they can choose without decoding a visual effect. |

## Shared design system proposal

The dashboard's `web/src/styles.css` and Expo's `src/lib/theme.ts` already share a palette. Android's `ui/Theme.kt` and launcher palettes have their own values. Align semantic roles first and preserve intentional launcher palette choices. The site uses a related paper and ink pair and already loads Atkinson Hyperlegible Next. Trial the same font in the product surfaces with a system fallback, checking load time, Danish glyphs, digits and native scale before adoption.

| Role | Light | Dark |
| --- | --- | --- |
| Paper / sheet | `#f2f3ef` / `#ffffff` | `#121816` / `#1b2320` |
| Ink / pencil | `#1c2321` / `#4d5753` | `#e8ece9` / `#a9b3ae` |
| Divider / required outline | `#dfe3df` / `#7a8580` | `#2c3833` / `#6b7873` |
| Action and focus / on action / tint | `#24604a` / `#ffffff` / `#e3efe8` | `#7fc4a2` / `#0d1a14` / `#22322b` |
| Attention fill / danger text / danger fill | `#fbf1d9` / `#a3261d` / `#fbe9e7` | `#33301f` / `#f08a80` / `#3a2321` |

Use ink for attention copy and the dedicated on-danger role when an action is filled. Separate paper and sheet with spacing or a divider. Use the stronger outline for controls, and measure it against the actual adjacent colour. Everyday surfaces sit at elevation zero. Use one small shadow for overlays on light and a distinct outline and tonal sheet on dark. Keep QR modules black on a dedicated white surface with a clear quiet zone in both themes.

- **Type.** Start at 14/20 for secondary metadata, 16/24 for body and control labels, 18/26 for child-facing reading and critical instructions, 24/30 for screen titles and 32/38 for large titles. Use 400 body and 600–700 headings or actions. Express web sizes in rem, Android in sp and Expo in scalable text units. Let line height grow and allow names and long Danish labels to wrap. Use tabular digits where stable widths matter for times and codes.
- **Space and shape.** Use 4, 8, 12, 16, 24 and 32 logical units. Start with 16 for screen insets, 12 within a control group and 24 between sections. Use a 10-unit control radius and a 12-unit grouped surface radius. Reserve pill shapes for short states or actual switches. Give child-facing actions room beyond platform minima.
- **Components.** Specify shared states for Screen title + next action, Rule row, Setting switch + explanation, Status with timestamp, Permission step, Approval decision, QR panel, and Inline error/retry. Use native semantics in each stack rather than sharing rendering code. Loading retains heading and layout, refresh retains known data and timestamp, empty states say why and offer one action, and failures retain inputs with Retry where safe. Stale snapshots use explicit times. Keep destructive confirmation separate and return focus after dismissal.
- **Icons.** Use a 24-unit grid with rounded 2-unit strokes and a stable set for phone, SMS, contact, clock, shield, check and QR. Use native familiar system symbols for Back, Close and camera where platform conventions matter. Label important actions, hide decorative icons from assistive tech and preserve the brand mark.
- **Motion and touch feedback.** Use immediate pressed styling and roughly 120–180 ms for a single opacity or colour transition. Avoid motion on the guard screen and ticking countdown announcements. Respect web reduced motion, Android animator/accessibility settings and React Native `AccessibilityInfo`. Use an optional single Android confirmation haptic on actual success and retain OS-standard dial-pad or system feedback. Honour device settings, provide equivalent visual and spoken feedback and avoid haptics on errors that the child cannot fix.

A presentation adjustment needs no separate switch. For each feature introduced or touched by an implementation PR, use its named per-phone on/off control in both parent surfaces, include a sensible documented default and one sentence explaining what changes, sync through `/rules` and have the phone respect it. Expose the control wherever it is missing. Preserve existing choices on migration. Keep optional motion and confirmation haptics off or system-governed by default and independently configurable if added. The only exceptions to feature opt-out are 112/emergency calling and parents' reachability. Show requested and applied states separately. The phone is authoritative about actions it has already taken. The server records and notifies on those reports even when the desired rule changed meanwhile.

## Accessibility and child readability

- Measure WCAG 2.2 AA on the web, and use the same contrast and equivalent behaviour targets in native clients. Check foreground/background pairs in default, focused, selected, pressed, warning and error states in both themes. Minimums are 4.5:1 for normal text, 3:1 for large text and 3:1 for meaningful graphics and control boundaries. Text and shape carry state alongside colour. Test the site warning and each optional Android launcher palette separately. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- WCAG 2.5.8 sets a 24 CSS px minimum with defined exceptions. Use the existing 44 × 44 CSS px project baseline and native 48 dp Android and at least 44 pt iOS. These are hit areas, including code entry, QR fallback, disclosures, dialer keys and inline retry. Check adjacent hit regions for overlap. [Android accessibility](https://developer.android.com/guide/topics/ui/accessibility/apps) · [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- Verify 200% browser text resize, 320 CSS px reflow and native large accessibility text on a small phone. Include long Danish strings, open keyboard, landscape where supported and focus hidden behind sticky actions. Use visible keyboard focus and heading order. Provide native names, roles, checked states and selected states. Exercise TalkBack and VoiceOver from list to rule to confirmation, and from launcher to parent call. Check QR fallback, expiry, permission denial and offline retry. Announce transitions once and avoid reading a PIN, SMS body or QR token through a status region.
- Ask a child to tell you what happened and what they can do next, and a parent to explain whether the rule has reached the phone. Use synthetic scenarios for both. Prefer one concrete instruction per sentence, short labels that wrap, literal times and consistent navigation. Include tasks without colour, gestures, audio or motion, and without requiring a child to disclose anything personal. These checks are proposed acceptance tests.

## Danish voice

Say what happened, who can act and when. Use familiar verbs, a short sentence per action and literal Android labels only when the person needs to find them. Use “din telefon” with children. Name the phone in a parent approval when it prevents confusion. Use “dashboard” consistently in parent setup if that is the label on the destination. Give an honest uncertainty or end time. Avoid blaming the child, diagnosing habits or promising total protection.

| Current text | Proposed Danish copy |
| --- | --- |
| “Venter på telefonen…” ([QR](img/ux/web-setup-qr-light.png)) | “Scan koden på Sam Demo. Her kan du se, når telefonen er forbundet.” |
| “Ingen status fra telefonen endnu” ([overview](img/ux/web-phone-light.png)) | “Telefonen har været online. Vi har endnu ikke fået svar på, hvilke regler der gælder.” Use this only when a check-in is known. |
| “Indtast koden” ([add](img/ux/web-add-light.png)) | “Jeg har en kode fra telefonen” |
| “Android gav ikke adgang. Hvis Android blokerede en begrænset indstilling, så åbn Appinfo, og vælg ⋮ (øverst til højre) → Tillad begrænsede indstillinger. Gå tilbage hertil, og prøv igen.” (`setup_restricted_body`) | “Android gav ikke adgang. Åbn Appinfo. Tryk på menuen øverst til højre, og vælg ‘Tillad begrænsede indstillinger’, hvis punktet vises. Gå tilbage til Plainphone, og tryk ‘Prøv igen’.” |
| “OK” (`blocked_ok`) | “Tilbage til start” when the action opens Home. |
| “Forkert PIN.” (`maintenance_wrong_pin`) | “PIN-koden passer ikke. Prøv igen.” |
| “Ventetid” (`setup_key_wait`) | “Vent, før du kan lempe reglerne” |
| “Din ven kan godkende ændringer efter login. Indtil da tager ændringer 24 timer.” (`setup_key_trusted_preview`) | “Din hjælper kan godkende, når invitationen er accepteret. Indtil da går der 24 timer, før du kan lempe reglerne.” Verify that acceptance, rather than just sign-in, is the actual transition before shipping. |

## Patterns to avoid

Avoid preselected consent for sensitive permissions, asymmetric opt-outs, unlabeled long-press actions, a success toast before the phone acknowledges, and setup that hides the exit or makes the parent re-enter a completed step. A data-sharing control needs visible scope and duration, and the child needs an age-appropriate account of what is shared. Use a count for actionable approvals only and clear it on resolution. Skip streaks, scoreboards, gems, confetti and shame copy. Keep hierarchy through space, type and dividers. Avoid the cream, serif and terracotta template, small-caps eyebrows, identical cards for unrelated actions and glowing gradients. Use the site's existing restrained colours, illustrations and typography where they convey something.

## Implementation queue

Order reflects estimated impact divided by effort, with dependency order breaking ties. High, medium and low impact are estimates. Validate the hypotheses in the acceptance checks. Each PR gets before/after light and dark screenshots for every affected surface, with identical synthetic fixtures, viewport and state. Attach native evidence where a device-specific state cannot be reproduced in the renderer. Each PR should include an Evidence line in its description (source or “no direct evidence, reason: …”) and document any feature toggles, defaults and sync behaviour.

| PR | Impact / effort | Acceptance criteria |
| --- | --- | --- |
| 1. Align setup labels and handoff | High / S–M | Site, web and Expo use matching labels wherever they present the same setup choice. The first instruction precedes the QR, manual entry is reachable where supported, and expired setup can be restarted without losing identity. Capture the normal and recovery states and check narrow layout, keyboard focus and scanner fallback. |
| 2. Make phone and approval states readable | High / M | Web and Expo use shared status copy. Fixture covers never connected, stale, waiting for phone, applied, declined, expired and conflicting decisions. Approval is idempotent and the processed state is visible and announced once. Android displays the matching outcome on the relevant QR flow. |
| 3. Make the child's next action clear | High / M | Android launcher, dialer and guard show the reason or next available action. Parent and emergency calling remain easy to reach at large text. SMS failure retains a draft. Web and Expo show the same rule scope and availability settings. Verify TalkBack on the critical path, plus reduced motion and haptics off. |
| 4. Make permissions and commitments recoverable | High / L | Light mode recovers after permission denial and app restart on representative Android versions. Myself setup explains undo, pending buddy and wait time without losing decisions on Back. Web and Expo reflect actual options and state. Test QR invite versus approval, expiry, repeated scans and optional features off. |
| 5. Bring secondary screens onto common tokens | Medium / M | Apply the proposed tokens to site and parent surfaces plus Android Maintenance and its shared UI. Verify font fallback and large text, focus and switch contrast in both themes, target sizes and an accessible release confirmation. Check that custom launcher palettes still meet contrast requirements. |

Track comprehension and completion of the fixture tasks and the errors a participant can recover from. The benchmark research provides limited direct evidence for these exact changes. In particular, the adult pause study gives a rationale for an immediate dismissal affordance, with transfer to Plainphone children unverified.
