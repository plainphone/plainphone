// SPDX-License-Identifier: Apache-2.0
//
// An iPhone build with PLAINPHONE_IOS_CHILD=1 on an iPhone older than iOS 26 (CHILD_MIN_IOS_MAJOR):
// the parent keeps the app as before, and the Child role is never offered, not even by a link.
import * as SecureStore from "expo-secure-store";
import { renderRouter, screen, waitFor } from "expo-router/testing-library";
import { fakeApi, ME } from "../test/fakeApi";

jest.mock("expo-constants", () => {
  const actual = jest.requireActual("expo-constants");
  const C = actual.default ?? actual;
  return { __esModule: true, default: { ...C, expoConfig: { ...C.expoConfig, version: "0.2.0", extra: { ...C.expoConfig?.extra, iosChildRole: true } } } };
});
jest.mock("react-native", () => {
  const RN = jest.requireActual("react-native");
  Object.defineProperty(RN.Platform, "Version", { get: () => "18.6.2", configurable: true });
  return RN;
});
jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";
const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(() => store.clear());

it("does not ask whose phone it is before iOS 26", async () => {
  fakeApi({ "GET /me": { status: 401, body: { error: "sign in" } } });
  await renderRouter(routes, { initialUrl: "/" });
  expect(await screen.findByTestId("login")).toBeTruthy();
  expect(screen.queryByTestId("role")).toBeNull();
});

it("keeps a parent on the dashboard, even with a saved Child role or a link to the child setup", async () => {
  store.set("pp.session", "pp_s_saved");
  store.set("pp.role", "child");
  fakeApi({ "GET /me": { body: ME }, "GET /phones": { body: { phones: [] } } });
  await renderRouter(routes, { initialUrl: "/child/setup" });
  expect(await screen.findByTestId("phones")).toBeTruthy();
  await waitFor(() => expect(screen.queryAllByTestId(/^setup-/)).toEqual([]));
});

it("does not show the role question from a link either", async () => {
  fakeApi({ "GET /me": { status: 401, body: { error: "sign in" } } });
  await renderRouter(routes, { initialUrl: "/role" });
  expect(await screen.findByTestId("login")).toBeTruthy();
  expect(screen.queryByTestId("role")).toBeNull();
});
