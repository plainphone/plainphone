// SPDX-License-Identifier: Apache-2.0
//
// The honest lines on the phone screen when the phone is an iPhone (docs/ios/architecture.md).
import * as SecureStore from "expo-secure-store";
import { renderRouter, screen } from "expo-router/testing-library";
import { en } from "../src/shared/i18n/en";
import { fakeApi, ME, PHONE } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";
const yes = { apps: "yes", contacts: "yes", webFilter: "yes", bedtimeSilence: "yes", calmHome: "yes", phoneSettings: "yes", selfKeys: "yes" };

function showPhone(phone: Record<string, unknown>) {
  fakeApi({
    "GET /me": { body: ME },
    "GET /phones": { body: { phones: [phone] } },
    [`GET /phones/${PHONE.id}`]: { body: phone },
    [`GET /phones/${PHONE.id}/changes`]: { body: { changes: [] } },
    [`GET /phones/${PHONE.id}/apps`]: { body: { apps: [] } },
    [`GET /phones/${PHONE.id}/sos`]: { body: { events: [], callbackNumber: null } },
  });
}

beforeEach(async () => {
  await SecureStore.setItemAsync("pp.session", "pp_s_saved");
});

it("puts the iPhone line under the rules Apple controls, and not under the others", async () => {
  showPhone({ ...PHONE, platform: "ios", tier: "family_controls", capabilities: { ...yes, contacts: "partial", webFilter: "partial" } });
  await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
  expect(await screen.findByText(en["platform.ios.contacts"])).toBeTruthy();
  expect(screen.getByText(en["platform.ios.webFilter"])).toBeTruthy();
  expect(screen.getByText(en["platform.iosNote"])).toBeTruthy();
  expect(screen.queryByText(en["platform.ios.apps"])).toBeNull();
  // The row reads the line aloud with its title.
  expect(screen.getByRole("button", { name: new RegExp(en["platform.ios.contacts"].replace(/[.]/g, "\\.")) })).toBeTruthy();
});

it("keeps an Android phone free of iPhone lines", async () => {
  showPhone({ ...PHONE, platform: "android", tier: "strong", capabilities: { ...yes, contacts: "partial" } });
  await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
  expect(await screen.findByText(en["phone.contacts"])).toBeTruthy();
  expect(screen.queryByText(en["platform.ios.contacts"])).toBeNull();
  expect(screen.queryByText(en["platform.iosNote"])).toBeNull();
});

it("names the iPhone in the phone list", async () => {
  showPhone({ ...PHONE, platform: "ios", capabilities: yes });
  await renderRouter(routes, { initialUrl: "/" });
  expect(await screen.findByText(new RegExp(`${en["profile.child"]}, ${en["platform.iphone"]}`))).toBeTruthy();
});
