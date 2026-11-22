# Phone and Messages redesign and the family inbox: before and after

Robolectric screenshots of every screen of Plainphone's own Phone and Messages apps on a strong-mode
Child phone, before and after the redesign in brand direction C ([brand guide](../../brand/README.md))
and with the [family inbox](../../family-inbox.md). All data is synthetic (Alex, Robin and Kim, numbers
`+452000000x`).

They come from `PhoneMessagesScreenshotTest` (`android/app/src/test/java/org/plainphone/app/ui/`), which
renders the whole app with synced rules and a fixture SMS and call log, and writes PNGs to
`android/app/build/screenshots/phone-messages/`:

```sh
cd android && ./gradlew --no-daemon testGithubDebugUnitTest --tests 'org.plainphone.app.ui.PhoneMessagesScreenshotTest'
```

Names are `android-<screen>-<variant>-<before|after>.png`.

| Screen | What it shows |
| --- | --- |
| `contacts` | People: a missed-call notice, then parents, 112 and help lines on one sheet, then the other approved contacts |
| `recents` | Calls: missed calls in red with the word "Missed" and a call-back button; a number that is not approved says so |
| `keypad` | The keypad, with "Call a parent" and the 112 hold button above the digits |
| `messages` | Conversations with a preview, an unread dot and the word "New" for TalkBack, and a read-only conversation |
| `messages-family` | The same with the family inbox on: **Family** pinned first (after only) |
| `conversation` | One conversation: received, sent and not sent (with "Write it again") |
| `conversation-unknown` | A sender who is not approved: read only, with the reason |
| `family` | The family inbox: delivered, a parent's reply with their name, sent as SMS, not sent, sending; quick messages and "I'm home" (after only) |
| `family-empty` | The family inbox before anything was sent, with only check-ins on (after only) |
| `incoming` | An incoming call |
| `in-call` | A call in progress, muted |

| Variant | Language | Theme | Text size |
| --- | --- | --- | --- |
| `en-light` | English | light | 100 % |
| `en-dark` | English | dark | 100 % |
| `en-large` | English | light | 200 % |
| `da-light` | Danish | light | 100 % |
| `sv-light` | Swedish | light | 100 % |
| `nb-dark` | Norwegian | dark | 100 % |
| `de-large` | German | dark | 200 % |

The fixtures' messages are in English in every language; the app's own text follows the language.
Times are relative to when the test ran, so the clock times in the shots differ between runs.

What to look for: graphite and white with ink call buttons; signal green only for something that is on
(a muted microphone, the selected tab in dark mode); red only for a missed call, a message that was not
sent, declining and hanging up; Schibsted Grotesk with IBM Plex Mono for numbers and times; parents
with an ink initial and the word "Parent"; at 200 % the buttons move under the names instead of
squeezing them, and the tab labels stay on one line.
