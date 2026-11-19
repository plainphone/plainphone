// SPDX-License-Identifier: Apache-2.0
import * as Notifications from "expo-notifications";
import { setSessionToken } from "../src/api/client";
import { syncNativePush, watchNativePush } from "../src/lib/notifications";
import { registerNativeToken, unregisterNativeToken } from "../src/lib/push-registration";
import { fakeApi } from "../test/fakeApi";

afterEach(() => {
  jest.clearAllMocks();
  setSessionToken(null);
});

it("registers a granted native token and replaces it when the SDK rotates it", async () => {
  const api = fakeApi({ "POST /notifications/subscriptions": { status: 201, body: { id: "subscription-id" } } });
  const permissions = Notifications.getPermissionsAsync as jest.Mock;
  permissions.mockResolvedValueOnce({ granted: true }).mockResolvedValueOnce({ granted: true });
  setSessionToken("pp_s_test");
  expect(await syncNativePush("en")).toBe("granted");
  expect(api.calls[0]).toMatchObject({
    auth: "Bearer pp_s_test", body: { platform: "fcm", token: "fcm-token" },
  });
  const stop = watchNativePush("en");
  const callback = (Notifications.addPushTokenListener as jest.Mock).mock.calls[0][0];
  callback({ type: "android", data: "rotated-token" });
  for (let i = 0; i < 20 && api.calls.length < 2; i++) await Promise.resolve();
  expect(api.calls[1]).toMatchObject({ body: { platform: "fcm", token: "rotated-token", subscriptionId: "subscription-id" } });
  stop();
});

it("does not ask for permission or send a token before sign-in", async () => {
  const api = fakeApi({});
  expect(await syncNativePush("en")).toBe("unsupported");
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(api.calls).toEqual([]);
});

it("waits for registration before removing the new subscription on logout", async () => {
  const session = "pp_s_logout";
  setSessionToken(session);
  let respond!: (response: Response) => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const deleted = jest.fn();
  globalThis.fetch = jest.fn(async (input) => {
    const request = input as Request;
    if (request.method === "POST") {
      return new Promise<Response>((resolve) => { respond = resolve; started(); });
    }
    deleted(request.url, request.headers.get("authorization"));
    return new Response(null, { status: 204 });
  });
  const registration = registerNativeToken("fcm", "fcm-token", session);
  await requestStarted;
  const logout = unregisterNativeToken(true);
  await Promise.resolve();
  expect(deleted).not.toHaveBeenCalled();
  respond(new Response(JSON.stringify({ id: "new-id" }), {
    status: 201, headers: { "content-type": "application/json" },
  }));
  await logout;
  expect(deleted).toHaveBeenCalledWith(expect.stringContaining("/subscriptions/new-id"), "Bearer pp_s_logout");
  await registration;
});

it("only recreates a removed subscription after explicit opt-in", async () => {
  setSessionToken("pp_s_revoked");
  const api = fakeApi({
    "POST /notifications/subscriptions": ({ body }) => (body as { subscriptionId?: string }).subscriptionId
      ? { status: 404 } : { status: 201, body: { id: "subscription-id" } },
  });
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  expect(await syncNativePush("en")).toBe("granted");
  expect(await syncNativePush("en")).toBe("undetermined");
  expect(await syncNativePush("en")).toBe("undetermined");
  expect(api.calls).toHaveLength(3);
  expect(await syncNativePush("en", true)).toBe("granted");
  expect(api.calls).toHaveLength(5);
});
