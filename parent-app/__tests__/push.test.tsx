// SPDX-License-Identifier: Apache-2.0
//
// Native push: the token is registered with the server, again at start-up, and removed
// at log out. Taps open only known paths.
import * as Notifications from "expo-notifications";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Platform } from "react-native";
import { routeForPush } from "../src/lib/notifications";
import { fakeApi, ME } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";
const store = (jest.requireMock("expo-secure-store") as { __store: Map<string, string> }).__store;
const platform = Platform.OS === "ios" ? "apns" : "fcm";
const SUB = { id: "22222222-2222-4222-8222-222222222222", platform, label: null, createdAt: "2026-11-17T20:00:00Z", lastSuccessAt: null };

beforeEach(() => {
  store.set("pp.session", "pp_s_saved");
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: true } as never);
  jest.mocked(Notifications.getDevicePushTokenAsync).mockResolvedValue({ type: "android", data: "device-token-1" } as never);
});

describe("native push", () => {
  it("registers the device token when notifications are turned on", async () => {
    const api = fakeApi({
      "GET /me": { body: ME },
      "POST /notifications/subscriptions": { status: 201, body: SUB },
    });
    await renderRouter(routes, { initialUrl: "/settings" });
    await fireEvent.press(await screen.findByText("Turn on notifications"));
    expect(await screen.findByText("Notifications are on.")).toBeTruthy();
    const reg = api.calls.find((c) => c.path === "/notifications/subscriptions")!;
    expect(reg.body).toEqual({ platform, token: "device-token-1", label: Platform.OS === "ios" ? "iPhone" : "Android" });
    expect(reg.auth).toBe("Bearer pp_s_saved");
    expect(store.get("pp.pushSubscription")).toBe(SUB.id);
  });

  it("registers again at start-up when permission was given before", async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true, canAskAgain: true } as never);
    const api = fakeApi({
      "GET /me": { body: ME },
      "GET /phones": { body: { phones: [] } },
      "POST /notifications/subscriptions": { status: 201, body: SUB },
    });
    await renderRouter(routes, { initialUrl: "/settings" });
    await waitFor(() => expect(api.calls.some((c) => c.path === "/notifications/subscriptions")).toBe(true));
    expect(Notifications.addPushTokenListener).toHaveBeenCalled();
  });

  it("does not register while signed out", async () => {
    store.delete("pp.session");
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true, canAskAgain: true } as never);
    const api = fakeApi({
      "GET /health": { body: { ok: true, mail: "smtp" } },
      "POST /notifications/subscriptions": { status: 201, body: SUB },
    });
    await renderRouter(routes, { initialUrl: "/" });
    await waitFor(() => expect(screen).toHavePathname("/login"));
    expect(api.calls.some((c) => c.path === "/notifications/subscriptions")).toBe(false);
  });

  it("removes this install's subscription before logging out", async () => {
    store.set("pp.pushSubscription", SUB.id);
    const api = fakeApi({
      "GET /me": { body: ME },
      "GET /health": { body: { ok: true, mail: "smtp" } },
      [`DELETE /notifications/subscriptions/${SUB.id}`]: { status: 204 },
      "POST /auth/logout": { status: 204 },
    });
    await renderRouter(routes, { initialUrl: "/settings" });
    await fireEvent.press(await screen.findByTestId("logout"));
    await waitFor(() => expect(screen).toHavePathname("/login"));
    const paths = api.calls.map((c) => `${c.method} ${c.path}`);
    const del = paths.indexOf(`DELETE /notifications/subscriptions/${SUB.id}`);
    expect(del).toBeGreaterThanOrEqual(0);
    expect(del).toBeLessThan(paths.indexOf("POST /auth/logout"));
    expect(api.calls[del]!.auth).toBe("Bearer pp_s_saved");
    expect(store.has("pp.pushSubscription")).toBe(false);
  });
});

describe("tapping a notification", () => {
  const pid = "11111111-1111-4111-8111-111111111111";
  it("opens the path the server sent", () => {
    expect(routeForPush({ url: `/phones/${pid}` })).toEqual({ pathname: "/phones/[pid]", params: { pid } });
    expect(routeForPush({ url: `/phones/${pid}/location` })).toEqual({ pathname: "/phones/[pid]/location", params: { pid } });
    expect(routeForPush({ url: "/approvals" })).toBe("/approvals");
    expect(routeForPush({ url: "/settings" })).toBe("/settings");
  });
  it("ignores any other path", () => {
    expect(routeForPush({ url: "https://evil.example/phones" })).toBe("/");
    expect(routeForPush({ url: `/phones/${pid}/../../login` })).toBe("/");
    expect(routeForPush({ url: "/household", type: "approval" })).toBe("/");
  });
});
