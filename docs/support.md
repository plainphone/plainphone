# Help, diagnostics and release troubleshooting

The public [help pages](https://plainphone.org/help/) cover recovery reset,
Play Protect, restricted settings and VPN conflicts in English, Danish, Swedish,
Norwegian Bokmål and German. Before a recovery reset, check access to an eligible
Google account and confirm that the latest report under Phone status in the web
dashboard shows reset protection is on. All five help pages link to
support@plainphone.org. See the launch setup below for mail delivery and Play
listing verification.

Support tools are on by default. A parent can turn them off for each phone
in the dashboard or parent app. This controls the diagnostics in the parent
interfaces and the support actions in the phone’s PIN-protected Maintenance
screen. Release warnings are a separate setting, also on by default.
Turning them off hides the detailed warning, pauses the sync counter and
stops extra reports about failed release attempts. Both settings sync to the phone with its rules.
The general help page is public.

Copy diagnostics exports the Plainphone and Android versions, the mode and
allowlisted failed policy names. Unknown policy messages become `other`.
The dashboard uses the latest phone report and the setup Android version as
a fallback for older phones. Missing or unrecognised versions are shown as
null in the export. On the native parent app, Share diagnostics opens the
system share sheet. Nothing is sent automatically.

## Remote release

Version **0.1.8** was the first release that handles remote release in
`SyncRunner` (commit `0b22040`, first included in tag `v0.1.8`). A pending
release for an older last-reported version links to the recovery reset guide
and shows when the phone reported that version. Check the version on the
phone before resetting it. For current or unknown versions, after three
authenticated rule fetches, including conditional fetches, the warning says
that the phone has yet to confirm the release and shows the last status
report time when available. A rules fetch confirms contact with the server.
The phone acknowledges successful release separately. If a pending phone
disappears, the parent app returns to the phone list and shows a notice asking
the parent to check on the phone whether Plainphone is still on.

## Launch setup

Use `https://plainphone.org/help/` as the **Website** in Google Play
Console’s store listing contact details, and `support@plainphone.org` as the
support email. The Danish listing can also link to
`https://plainphone.org/da/help/` in its description. Route the role address
to the maintainer’s inbox in the domain’s mail provider. With approval for
launch, verify that a test message reaches the inbox and that both listings
open the intended help pages. Keep #100 open until those checks pass.
