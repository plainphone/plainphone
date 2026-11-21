// SPDX-License-Identifier: Apache-2.0
//
// The Child role's screens in an iPhone build with PLAINPHONE_IOS_CHILD=1: "Whose phone is this?",
// the setup wizard and the child's own screen. The Swift module is the fake in test/fakeScreenTime.
import * as SecureStore from "expo-secure-store";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { appEn } from "../src/i18n/app-en";
import { fakeApi, ME } from "../test/fakeApi";
import { fakeScreenTime, type FakeScreenTime } from "../test/fakeScreenTime";
import fixture from "../../ios/Tests/Fixtures/ios-rules.json";

jest.mock("expo-constants", () => {
  const actual = jest.requireActual("expo-constants");
  const C = actual.default ?? actual;
  return { __esModule: true, default: { ...C, expoConfig: { ...C.expoConfig, version: "0.2.0", extra: { ...C.expoConfig?.extra, iosChildRole: true } } } };
});
jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

let mockScreenTime: FakeScreenTime;
jest.mock("../modules/plainphone-screentime", () => ({
  ...jest.requireActual("../modules/plainphone-screentime"),
  nativeScreenTime: () => mockScreenTime,
}));

const routes = "./src/app";
const PAIRING = {
  pairingId: "22222222-2222-4222-8222-222222222222",
  pollSecret: "secret",
  code: "K7MP-4QXR",
  qrUrl: "https://app.plainphone.org/pair?code=K7MP-4QXR&profile=child",
  expiresAt: "2026-11-16T12:15:00.000Z",
  platform: "ios",
  confirmOnPhone: false,
};
const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(() => {
  store.clear();
  mockScreenTime = fakeScreenTime();
});

it("asks whose phone it is on a first launch without a signed-in parent", async () => {
  fakeApi({ "GET /me": { status: 401, body: { error: "sign in" } } });
  await renderRouter(routes, { initialUrl: "/" });
  expect(await screen.findByTestId("role")).toBeTruthy();
  expect(screen.getByText(appEn["iphone.role.child"])).toBeTruthy();
  expect(screen.getByText(appEn["iphone.role.parent"])).toBeTruthy();
});

it("keeps a signed-in parent on the dashboard without asking", async () => {
  store.set("pp.session", "pp_s_saved");
  fakeApi({ "GET /me": { body: ME }, "GET /phones": { body: { phones: [] } } });
  await renderRouter(routes, { initialUrl: "/" });
  expect(await screen.findByTestId("phones")).toBeTruthy();
  await waitFor(() => expect(store.get("pp.role")).toBe("parent"));
  expect(screen.queryByTestId("role")).toBeNull();
});

it("sets up a child's iPhone from the role question to the child's own screen", async () => {
  let claimed = false;
  const api = fakeApi({
    "GET /me": { status: 401, body: { error: "sign in" } },
    "POST /device/pairings": { status: 201, body: PAIRING },
    [`GET /device/pairings/${PAIRING.pairingId}`]: () => claimed
      ? { body: { status: "paired", phoneId: fixture.phoneId, deviceToken: "pp_d_new" } }
      : { status: 202, body: { status: "waiting" } },
    "GET /device/rules": { body: fixture, headers: { etag: '"r1"' } },
    "GET /device/ios-selection": { body: { selection: "AAEC", source: "phone", updatedAt: "2026-11-16T12:00:00.000Z" } },
    "PUT /device/status": { status: 204 },
  });
  await renderRouter(routes, { initialUrl: "/" });
  await fireEvent.press(await screen.findByTestId("role-child"));
  await fireEvent.press(screen.getByTestId("role-next"));

  // 1. Welcome: what is needed, and a way out for a parent's phone.
  expect(await screen.findByTestId("setup-welcome")).toBeTruthy();
  expect(screen.getByText(appEn["iphone.welcome.body"])).toBeTruthy();
  expect(screen.getByTestId("setup-not-child")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("setup-start"));

  // 2. Screen Time permission; a refusal says what to check and asks again.
  expect(await screen.findByTestId("setup-permission")).toBeTruthy();
  expect(screen.getByText("Step 1 of 3")).toBeTruthy();
  mockScreenTime.answer = "denied";
  await fireEvent.press(screen.getByTestId("setup-allow"));
  expect(await screen.findByText(appEn["iphone.permission.denied"])).toBeTruthy();
  mockScreenTime.answer = "approved";
  await fireEvent.press(screen.getByTestId("setup-allow"));

  // 3. The code and QR code, until the parent claims it.
  expect(await screen.findByTestId("setup-qr")).toBeTruthy();
  expect(screen.getByText("Or type this code: K7MP-4QXR")).toBeTruthy();
  expect(screen.getByLabelText("QR code for pairing. The code is K7MP-4QXR.")).toBeTruthy();
  expect(api.calls.find((c) => c.path === "/device/pairings")!.body).toMatchObject({ platform: "ios", profile: "child" });
  claimed = true;

  // 4. Apple's own settings, which can wait.
  expect(await screen.findByTestId("setup-appleSettings", {}, { timeout: 5000 })).toBeTruthy();
  expect(JSON.parse(store.get("pp.device")!)).toMatchObject({ phoneId: fixture.phoneId, deviceToken: "pp_d_new" });
  await fireEvent.press(screen.getByTestId("setup-apple-later"));

  // 5. Done, then the child's screen, which syncs at once.
  await fireEvent.press(await screen.findByTestId("setup-finish"));
  expect(await screen.findByTestId("child-home")).toBeTruthy();
  expect(screen.getByText(appEn["iphone.child.shares"])).toBeTruthy();
  await waitFor(() => expect(mockScreenTime.applied).toHaveLength(1));
  expect(mockScreenTime.applied[0]).toMatchObject({ etag: '"r1"', phoneId: fixture.phoneId, selection: "AAEC" });
  await waitFor(() => expect(api.calls.some((c) => c.path === "/device/status" && c.auth === "Bearer pp_d_new")).toBe(true));
}, 15_000);

it("says plainly when the server cannot add iPhones yet", async () => {
  store.set("pp.role", "child");
  store.set("pp.iphone.setupStarted", "1");
  mockScreenTime = fakeScreenTime("approved");
  fakeApi({
    "GET /me": { status: 401, body: { error: "sign in" } },
    "POST /device/pairings": { status: 403, body: { error: "not yet", code: "ios_pairing_not_yet" } },
  });
  await renderRouter(routes, { initialUrl: "/child/setup" });
  expect(await screen.findByText(appEn["iphone.pair.notYet"])).toBeTruthy();
});

it("lets a parent's iPhone leave the child setup before anything happens", async () => {
  store.set("pp.role", "child");
  fakeApi({ "GET /me": { status: 401, body: { error: "sign in" } } });
  await renderRouter(routes, { initialUrl: "/child" });
  await fireEvent.press(await screen.findByTestId("setup-not-child"));
  await waitFor(() => expect(store.get("pp.role")).toBe("parent"));
  expect(await screen.findByTestId("login-email")).toBeTruthy();
});

it("tells the child when the phone was removed, and can set it up again", async () => {
  store.set("pp.role", "child");
  store.set("pp.device", JSON.stringify({ phoneId: fixture.phoneId, deviceToken: "pp_d_old", server: "https://app.plainphone.org" }));
  mockScreenTime = fakeScreenTime("approved");
  fakeApi({ "GET /me": { status: 401, body: { error: "sign in" } }, "GET /device/rules": { status: 401, body: { error: "unknown device" } } });
  await renderRouter(routes, { initialUrl: "/child" });
  expect(await screen.findByText(appEn["iphone.child.removed"])).toBeTruthy();
  await fireEvent.press(screen.getByTestId("child-setup-again"));
  expect(await screen.findByTestId("setup-welcome")).toBeTruthy();
  expect(store.get("pp.device")).toBeUndefined();
});

it("shows a released phone as released, and lets it be set up again", async () => {
  store.set("pp.role", "child");
  store.set("pp.device", JSON.stringify({ phoneId: fixture.phoneId, deviceToken: "pp_d_old", server: "https://app.plainphone.org" }));
  mockScreenTime = fakeScreenTime("approved");
  fakeApi({
    "GET /me": { status: 401, body: { error: "sign in" } },
    "GET /device/rules": { body: { ...fixture, release: true }, headers: { etag: '"rel"' } },
    "POST /device/released": { status: 204 },
  });
  await renderRouter(routes, { initialUrl: "/child" });
  expect(await screen.findByText(appEn["iphone.child.released"])).toBeTruthy();
  expect(store.get("pp.device")).toBeUndefined();
  expect(mockScreenTime.current.released).toBe(true);
});
