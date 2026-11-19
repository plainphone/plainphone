# Before and after: the child's next action

Synthetic fixtures only (UX package 3, #134). Rendered by the Robolectric screenshot tests on JDK 17+:

```
cd android && ./gradlew --no-daemon testDebugUnitTest \
  --tests '*ChildNextActionScreenshotTest' --tests '*HomeScreenshotTest' \
  --tests '*SafetyScreenshotTest' --tests '*LightSetupAudienceUiTest' --tests '*PhoneHistoryScreenshotTest'
# PNGs: android/app/build/screenshots/
```

`before/` is `origin/main`, `after/` is this branch: same fixtures, 393 x 852 dp, light and dark.
Changed surfaces: `guard-*` (the calm screen for a used-up or unlisted app, also at 1.6x text),
`dialer-*` (keypad, also at 1.6x text), `maintenance-*` (locked and lifted). The `home-*`,
`history-*`, `ring-*`, `sharing-*`, `checkin-*`, `badge-*` and `setup-*` files come from the
existing harness and are unchanged on purpose: the launcher dock already keeps the phone,
messages, help and the emergency call outside the scrolling area.

Maintenance is drawn without the system status bar, so its title is partly clipped in both sets.

## TalkBack, reduced motion, haptics (to check on a real phone)

1. Launcher: swipe to Phone, Messages, Help and Emergency call; each is one stop.
2. Open a time-limited app after its time is used up: the title is announced as a heading, then the
   sentence, then Call or message a parent, then Back to start.
3. Keypad: Call a parent and Emergency call come first. Each digit is announced as it is pressed,
   the number display is not read, the call button says only "Call", delete says "Delete last digit".
4. Messages: a failed message shows "Not sent" with "Write it again"; the error line is announced
   once and never repeats the message text.
5. Maintenance: after a wrong PIN, focus stays in the PIN field and the message is announced.
6. Animation scale 0 and touch feedback off: nothing in these screens depends on either.
