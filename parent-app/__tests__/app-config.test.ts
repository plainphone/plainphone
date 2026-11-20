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
