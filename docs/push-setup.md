# Set up push for Plainphone

The web dashboard uses VAPID. The Android parent app uses Firebase Cloud Messaging (FCM), and the iOS parent app uses Apple Push Notification service (APNs). You can set up each independently. The child phone can sync via FCM, UnifiedPush or polling.

## Firebase for both Android apps

1. In the [Firebase console](https://console.firebase.google.com/), create a project for Plainphone. You can leave Google Analytics off.
2. Under **Project settings → General → Your apps**, add an Android app with package name `org.plainphone.app`. Download its `google-services.json` and put it at `android/app/google-services.json`. Alternatively, set `PLAINPHONE_GOOGLE_SERVICES_FILE` to its absolute path on the build machine.
3. Add another Android app in the same project with package name `org.plainphone.parent`. A custom parent build uses the package specified by `PLAINPHONE_BUNDLE_ID`. Download this second `google-services.json` and set `PLAINPHONE_PARENT_GOOGLE_SERVICES_FILE` to its absolute path on the parent build machine. Expo reads it via `android.googleServicesFile`.
4. Confirm the Firebase Cloud Messaging API is enabled for the project. Open **Project settings → Service accounts**, choose **Generate new private key**, and store the downloaded JSON in your server's secret store. Use an account permitted to send FCM HTTP v1 messages for this project. See [Firebase's HTTP v1 instructions](https://firebase.google.com/docs/cloud-messaging/send/v1-api).
5. Set `FCM_SERVICE_ACCOUNT_JSON` to the complete JSON on one line, or mount the file read-only and set `FCM_SERVICE_ACCOUNT_FILE` to its path inside the server container. The value may be the raw JSON or that JSON base64-encoded (handy for secret stores that dislike quotes and line breaks). Inline JSON takes precedence over the file, and a file may hold either form too. Keep the service-account JSON off both build machines and out of Git.
6. Build the child app with `cd android && ./gradlew -PplainphoneFcm=true assembleDebug` for local testing. Production APK builds use that same flag with their existing signing setup. Without the flag, the build needs no Firebase config and can use UnifiedPush or polling.
7. To allow FCM for child phones, set `PUSH_PROVIDER=fcm` on the server. For each test phone, switch on **Faster rule updates** from its overview in either parent interface. The child phone registers its transport after fetching the changed rules. To test UnifiedPush on just one phone, configure the distributor and switch on **Wakeups without Google** for that phone.

## APNs for the iOS parent app

1. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list), open the explicit App ID for `org.plainphone.parent` (or the custom bundle identifier). Enable **Push Notifications** and **Time Sensitive Notifications** for the App ID and regenerate the provisioning profile as needed.
2. Open **Keys**, create a key with Apple Push Notifications service enabled for your app/environment, and download its `.p8` file when Apple offers it. Record the **Key ID** and the Apple Developer **Team ID**. See [Apple's APNs token authentication instructions](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns).
3. Put the contents of the `.p8` file in the server secret `APNS_KEY_P8`. The server accepts PEM text with line breaks, PEM with literal `\n` sequences, or the base64 encoding of the PEM. Set `APNS_KEY_ID`, `APNS_TEAM_ID` and `APNS_BUNDLE_ID` to match.
4. Use `APNS_SANDBOX=true` with a development-signed app. For TestFlight and store builds, use `APNS_SANDBOX=false` on the server and `PLAINPHONE_APNS_ENVIRONMENT=production` on the build machine. Use a separate environment to test both signing configurations at once.
5. Urgent alerts use time-sensitive delivery. Users can disable that behavior in iOS Settings. Critical alerts that can override device settings require a separate Apple entitlement and are future work.

## Manage native subscriptions

Removing a native app in the dashboard stops alerts for that installation. To restore delivery, enable notifications in the app's settings. Signing in again or rotating the token leaves a dashboard removal in place. Signing out revokes that session's active subscriptions on the server. When a push provider retires a token, a fresh token can restore delivery automatically unless the installation was removed in the dashboard. A removal belongs to the installation, not the account: another parent who signs in on the same phone also has to enable notifications first. Turning notifications off in the OS only stops registering; it never counts as a removal, so turning them on again restores delivery. Signing out needs a connection: if the request fails offline, the server keeps the session's subscriptions until the session expires.

## Verify with real devices

1. Check `GET /api/health`. The `push` object reports whether each provider is configured using booleans only.
2. In each native parent app, sign in and grant permission in **Settings → Notifications**. In the dashboard notifications screen, find the registered device and use **Send test**. Tap the alert and check that it opens the app's Settings.
3. Test urgent alerts with the parent app open and in the background. Verify the Android **Urgent SOS** channel and iOS time-sensitive display.
4. For child wakeups, leave the screen off, then change a rule or request an update. Check that sync happens promptly and that the dashboard reports the selected provider. Verify separately with Google-free Android and an ntfy distributor. Disable faster rule updates and confirm that polling still applies rules.

See [self-hosting](self-hosting.md#unifiedpush-with-ntfy) for ntfy and [the sync contract](sync-api.md#push-wakeups) for the wire format.

## Invalid settings switch a provider off, they do not stop the server

FCM, APNs, Web Push (VAPID) and SMTP are optional. If one of them is misconfigured, the server still starts, logs one line with the provider and the reason (never the secret), and leaves that provider off. Everything else keeps working. `GET /api/health` shows it:

```json
{ "ok": true, "push": { "web": true, "fcm": false, "apns": true, "unifiedpush": false, "errors": ["fcm: invalid service account"] }, "errors": [] }
```

`push.errors` lists push problems (`fcm: invalid service account`, `fcm: service account file unreadable`, `apns: invalid key`, `apns: incomplete configuration`, `web: needs both VAPID keys`, `web: invalid VAPID key pair`, `push: invalid PUSH_PROVIDER`, `apns: invalid APNS_SANDBOX`). Top-level `errors` lists other optional integrations (`smtp: invalid or missing SMTP_URL`, `mail: invalid MAIL_PROVIDER`). Both are empty when all is well. Check them after every deploy.
