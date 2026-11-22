// SPDX-License-Identifier: Apache-2.0
//
// iPhone phase 1 preparation in the parent app (docs/ios/architecture.md): "Add an iPhone" behind
// the server's flag, the role question, the pairing screen for an iPhone code, and the capability
// map on the phone screens.
import * as SecureStore from "expo-secure-store";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { en } from "@plainphone/i18n/en";
import { fakeApi, ME, PHONE } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";
const yes = { apps: "yes", contacts: "yes", webFilter: "yes", moreTime: "yes", bedtimeSilence: "yes", ring: "yes", calmHome: "yes", phoneSettings: "yes", selfKeys: "yes" };
const IPHONE = { ...PHONE, mode: "light", platform: "ios", tier: "family_controls", capabilities: { ...yes, apps: "partial" } };

function api(me: Record<string, unknown>, phone: Record<string, unknown> = PHONE, extra: Record<string, { status?: number; body?: unknown }> = {}) {
  return fakeApi({
    "GET /me": { body: me },
    "GET /phones": { body: { phones: [phone] } },
    [`GET /phones/${PHONE.id}`]: { body: phone },
    [`GET /phones/${PHONE.id}/changes`]: { body: { changes: [] } },
    [`GET /phones/${PHONE.id}/apps`]: { body: { apps: [] } },
    [`GET /phones/${PHONE.id}/sos`]: { body: { events: [], callbackNumber: null } },
    "GET /age-presets": { body: { presets: [] } },
    ...extra,
  });
}

beforeEach(async () => {
  await SecureStore.setItemAsync("pp.session", "pp_s_saved");
});

it("offers 'Add an iPhone' while the server pairs iPhones", async () => {
  api({ ...ME, iosPairing: true });
  await renderRouter(routes, { initialUrl: "/" });
  expect(await screen.findByTestId("add-iphone")).toBeTruthy();
});

it("hides 'Add an iPhone' while the server does not pair iPhones", async () => {
  api(ME);
  await renderRouter(routes, { initialUrl: "/" });
  expect(await screen.findByTestId("add-phone")).toBeTruthy();
  expect(screen.queryByTestId("add-iphone")).toBeNull();
});

it("asks whose iPhone it is, lists Apple's prerequisites and goes on to the code", async () => {
  api({ ...ME, iosPairing: true });
  await renderRouter(routes, { initialUrl: "/add-iphone" });
  expect(await screen.findByText(en["platform.iphone.who"])).toBeTruthy();
  expect(screen.getByText(`• ${en["platform.iphone.needFamily"]}`)).toBeTruthy();
  expect(screen.getByText(`• ${en["platform.iphone.needAccount"]}`)).toBeTruthy();
  expect(screen.getByText(`• ${en["platform.iphone.needScreenTime"]}`)).toBeTruthy();
  // Myself: no child account or Family Sharing.
  await fireEvent.press(screen.getByTestId("add-iphone-self"));
  expect(screen.queryByText(`• ${en["platform.iphone.needAccount"]}`)).toBeNull();
  expect(screen.getByText(`• ${en["platform.iphone.needScreenTime"]}`)).toBeTruthy();
  await fireEvent.press(screen.getByTestId("add-iphone-next"));
  await waitFor(() => expect(screen).toHavePathname("/pair"));
  expect(screen).toHaveSearchParams({ profile: "self" });
});

it("says 'not yet' on a server without iPhone pairing", async () => {
  api(ME);
  await renderRouter(routes, { initialUrl: "/add-iphone" });
  expect(await screen.findByText(en["platform.iphone.notYet"])).toBeTruthy();
  expect(screen.queryByTestId("add-iphone-next")).toBeNull();
});

it("recognises an iPhone code and explains a server that turned iPhone pairing off", async () => {
  const calls = api({ ...ME, iosPairing: true }, PHONE, {
    "POST /phones/pairing-profile": { body: { profile: "self", mode: "light", platform: "ios" } },
    "POST /phones/claim": { status: 403, body: { error: "not yet", code: "ios_pairing_not_yet" } },
  });
  await renderRouter(routes, { initialUrl: "/pair?code=K7MP4QXR" });
  expect(await screen.findByText(en["platform.iphone.pairNote"])).toBeTruthy();
  // Android's Private DNS choice does not apply to an iPhone.
  expect(screen.queryByText(en["filter.otherVpn"])).toBeNull();
  await fireEvent.changeText(screen.getByTestId("pair-name"), "Test iPhone");
  await fireEvent.press(screen.getByTestId("pair-submit"));
  expect(await screen.findByText(en["platform.iphone.notYet"])).toBeTruthy();
  expect(calls.calls.find((c) => c.path === "/phones/claim")?.body).not.toHaveProperty("filterMethod");
});

it("shows a rule an iPhone cannot do as text, not as a button", async () => {
  api(ME, { ...IPHONE, profile: "self", capabilities: { ...yes, selfKeys: "no" } });
  await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
  expect(await screen.findByTestId("section-key-unavailable")).toBeTruthy();
  expect(screen.queryByTestId("section-key")).toBeNull();
  expect(screen.getByText(en["platform.ios.selfKeys"])).toBeTruthy();
  // Light mode's Android note is not shown for an iPhone.
  expect(screen.queryByText(en["mode.lightNote"])).toBeNull();
});

it("keeps the rule a button on Android", async () => {
  api(ME, { ...PHONE, profile: "self", platform: "android", capabilities: { ...yes, selfKeys: "no" } });
  await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
  expect(await screen.findByTestId("section-key")).toBeTruthy();
  expect(screen.queryByTestId("section-key-unavailable")).toBeNull();
});

it("shows where an iPhone's apps are picked instead of an Android app list", async () => {
  api(ME, IPHONE, { [`GET /phones/${PHONE.id}/ios-selection`]: { body: { selection: null, source: null, updatedAt: null } } });
  await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}/apps` });
  expect(await screen.findByText(en["platform.iphone.appsOnPhone"])).toBeTruthy();
  expect(await screen.findByText(en["platform.iphone.appsNone"])).toBeTruthy();
});

it("shows Apple's honest line instead of the Android-only contact switch on an iPhone", async () => {
  const contacts = { body: { contacts: [], suggestDeviceContacts: true, lightContactRestriction: false, selfScheduleContacts: false } };
  api(ME, IPHONE, { [`GET /phones/${PHONE.id}/contacts`]: contacts });
  await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}/contacts` });
  expect(await screen.findByText(en["platform.ios.contacts"])).toBeTruthy();
  expect(screen.queryByTestId("suggest-device-contacts")).toBeNull();
  expect(screen.queryByTestId("light-contact-restriction")).toBeNull();
});

it("keeps the contact suggestion switch on Android", async () => {
  const contacts = { body: { contacts: [], suggestDeviceContacts: false, lightContactRestriction: false } };
  api(ME, { ...PHONE, platform: "android" }, { [`GET /phones/${PHONE.id}/contacts`]: contacts });
  await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}/contacts` });
  expect(await screen.findByTestId("suggest-device-contacts")).toBeTruthy();
  expect(screen.queryByText(en["platform.ios.contacts"])).toBeNull();
});
