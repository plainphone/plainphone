# Help, diagnostics and release troubleshooting

The public [English](https://plainphone.org/help/) and
[Danish](https://plainphone.org/da/help/) help pages explain recovery reset,
Play Protect, restricted settings and VPN conflicts. Families can write to
support@plainphone.org from either page.

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
release for an older known version immediately links to the recovery reset
guide. For current or unknown versions, the warning appears after three
authenticated fetches of pending release rules, including conditional
fetches. The warning shows the timestamp of the last status report when one
exists. A rules fetch confirms contact with the server. Successful release
is established by the phone's acknowledgement.

## Launch setup

Use `https://plainphone.org/help/` as the **Website** in Google Play
Console’s store listing contact details, and `support@plainphone.org` as the
support email. The Danish listing can also link to
`https://plainphone.org/da/help/` in its description. Route the role address
to the maintainer’s inbox in the domain’s mail provider and verify delivery
before publishing the listing.
