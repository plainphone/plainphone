// SPDX-License-Identifier: Apache-2.0
//
// Expo config for the Plainphone parent app (iOS and Android).
// Self-hosting: build with PLAINPHONE_SERVER_URL=https://your.server and your own
// iOS bundle ID/team (PLAINPHONE_BUNDLE_ID, PLAINPHONE_APPLE_TEAM_ID) and
// Android package (PLAINPHONE_ANDROID_PACKAGE); then set the
// matching APPLE_APP_IDS and ANDROID_APP_* on the server (docs/parent-app.md).
import type { ConfigContext, ExpoConfig } from "expo/config";

const SERVER_URL = (process.env.PLAINPHONE_SERVER_URL ?? "https://app.plainphone.org").replace(/\/+$/, "");
const HOST = new URL(SERVER_URL).host;
const APPLE_TEAM_ID = process.env.PLAINPHONE_APPLE_TEAM_ID ?? "P7698GU4AV";
/** Paths the app opens. Keep in sync with APP_LINK_PATHS in server/src/app.ts. */
const LINK_PATHS = ["/auth/app", "/pair", "/invite"];
const FONTS = "assets/fonts";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Plainphone",
  slug: "plainphone-parent",
  scheme: "plainphone",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  backgroundColor: "#f5f5f3",
  locales: { en: "./locales/en.json", da: "./locales/da.json", sv: "./locales/sv.json", nb: "./locales/nb.json", de: "./locales/de.json" },
  ios: {
    bundleIdentifier: process.env.PLAINPHONE_BUNDLE_ID ?? "org.plainphone.app",
    appleTeamId: APPLE_TEAM_ID,
    buildNumber: "1",
    entitlements: { "com.apple.developer.usernotifications.time-sensitive": true },
    supportsTablet: true,
    associatedDomains: [`applinks:${HOST}`],
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
      CFBundleLocalizations: ["en", "da"],
      CFBundleDevelopmentRegion: "en",
      ITSAppUsesNonExemptEncryption: false,
    },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      // Kept on the server and linked to the account (docs/privacy.md): the sign-in email, a
      // number to call back (check-ins, SOS), the approved contacts the parent enters for a
      // phone, and what the parent writes (phone names, rules, messages, requests).
      NSPrivacyCollectedDataTypes: [
        "NSPrivacyCollectedDataTypeEmailAddress",
        "NSPrivacyCollectedDataTypePhoneNumber",
        "NSPrivacyCollectedDataTypeContacts",
        "NSPrivacyCollectedDataTypeOtherUserContent",
      ].map((type) => ({
        NSPrivacyCollectedDataType: type,
        NSPrivacyCollectedDataTypeLinked: true,
        NSPrivacyCollectedDataTypeTracking: false,
        NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
      })),
    },
  },
  android: {
    package: process.env.PLAINPHONE_ANDROID_PACKAGE ?? "org.plainphone.parent",
    googleServicesFile: process.env.PLAINPHONE_PARENT_GOOGLE_SERVICES_FILE,
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: "#141414",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    // Only what the app uses: the camera for the pairing QR code and notifications.
    permissions: ["android.permission.CAMERA", "android.permission.POST_NOTIFICATIONS"],
    // Pulled in by libraries, not used by the app.
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.USE_BIOMETRIC",
      "android.permission.USE_FINGERPRINT",
    ],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: LINK_PATHS.map((pathPrefix) => ({ scheme: "https", host: HOST, pathPrefix })),
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
    predictiveBackGestureEnabled: true,
  },
  web: {
    favicon: "./assets/favicon.png",
    output: "single",
  },
  plugins: [
    "expo-router",
    "expo-localization",
    "expo-secure-store",
    // Brand type, built into the app (no loading at start-up). OFL, see assets/fonts/OFL-*.txt.
    // In code: fonts in src/lib/theme.ts. iOS takes the family from the file; Android gets the same names.
    [
      "expo-font",
      {
        ios: { fonts: [`./${FONTS}/SchibstedGrotesk-Regular.ttf`, `./${FONTS}/SchibstedGrotesk-Bold.ttf`, `./${FONTS}/IBMPlexMono-Medium.ttf`] },
        android: {
          fonts: [
            {
              fontFamily: "Schibsted Grotesk",
              fontDefinitions: [
                { path: `./${FONTS}/SchibstedGrotesk-Regular.ttf`, weight: 400 },
                { path: `./${FONTS}/SchibstedGrotesk-Bold.ttf`, weight: 700 },
              ],
            },
            { fontFamily: "IBMPlexMono-Medium", fontDefinitions: [{ path: `./${FONTS}/IBMPlexMono-Medium.ttf`, weight: 500 }] },
          ],
        },
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 120,
        backgroundColor: "#f5f5f3",
        dark: { image: "./assets/splash-icon-dark.png", backgroundColor: "#0f0f0f" },
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission: "Plainphone uses the camera to scan the pairing code shown on a phone.",
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    [
      "expo-notifications",
      {
        // White-on-transparent status bar icon; Android tints it with the colour below.
        icon: "./assets/notification-icon.png",
        color: "#141414",
        defaultChannel: "normal",
        mode: process.env.PLAINPHONE_APNS_ENVIRONMENT === "production" ? "production" : "development",
      },
    ],
  ],
  experiments: { typedRoutes: true },
  // iosChildRole: the iPhone build offers "A child's phone" (docs/ios/architecture.md, phase 1).
  // Off unless built with PLAINPHONE_IOS_CHILD=1; then the app needs iOS 26 and Family Controls.
  extra: { serverUrl: SERVER_URL, iosChildRole: process.env.PLAINPHONE_IOS_CHILD === "1" },
});
