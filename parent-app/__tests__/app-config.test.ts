// SPDX-License-Identifier: Apache-2.0
import appConfig from "../app.config";

const context = {
  projectRoot: process.cwd(),
  staticConfigPath: null,
  packageJsonPath: null,
  config: {},
};

describe("native app identifiers", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PLAINPHONE_BUNDLE_ID;
    delete process.env.PLAINPHONE_ANDROID_PACKAGE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses the App Store bundle ID and the Android parent package", () => {
    const config = appConfig(context);
    expect(config.ios?.bundleIdentifier).toBe("org.plainphone.app");
    expect(config.android?.package).toBe("org.plainphone.parent");
  });

  it("allows each platform identifier to be overridden independently", () => {
    process.env.PLAINPHONE_BUNDLE_ID = "org.example.ios-test";
    expect(appConfig(context).ios?.bundleIdentifier).toBe("org.example.ios-test");
    expect(appConfig(context).android?.package).toBe("org.plainphone.parent");

    delete process.env.PLAINPHONE_BUNDLE_ID;
    process.env.PLAINPHONE_ANDROID_PACKAGE = "org.example.android.test";
    expect(appConfig(context).ios?.bundleIdentifier).toBe("org.plainphone.app");
    expect(appConfig(context).android?.package).toBe("org.example.android.test");
  });
});

describe("iOS privacy manifest", () => {
  // What the app sends to the server and the server keeps linked to the account
  // (docs/privacy.md): the sign-in email address, a number to call back, the approved
  // contacts the parent enters for a phone, and what the parent writes (phone names,
  // rules, messages, requests). Nothing is used for tracking, and every item serves
  // the app's own function.
  const linked = (type: string) => ({
    NSPrivacyCollectedDataType: type,
    NSPrivacyCollectedDataTypeLinked: true,
    NSPrivacyCollectedDataTypeTracking: false,
    NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
  });

  it("declares the data the app collects, without tracking", () => {
    const manifest = appConfig(context).ios?.privacyManifests;
    expect(manifest?.NSPrivacyTracking).toBe(false);
    expect(manifest?.NSPrivacyTrackingDomains).toEqual([]);
    expect(manifest?.NSPrivacyCollectedDataTypes).toEqual([
      linked("NSPrivacyCollectedDataTypeEmailAddress"),
      linked("NSPrivacyCollectedDataTypePhoneNumber"),
      linked("NSPrivacyCollectedDataTypeContacts"),
      linked("NSPrivacyCollectedDataTypeOtherUserContent"),
    ]);
  });
});
