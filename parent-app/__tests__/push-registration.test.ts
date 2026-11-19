// SPDX-License-Identifier: Apache-2.0
import * as Notifications from "expo-notifications";
import { setSessionToken } from "../src/api/client";
import { syncNativePush, watchNativePush } from "../src/lib/notifications";
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
  expect(api.calls[1]).toMatchObject({ body: { platform: "fcm", token: "rotated-token", replaces: "fcm-token" } });
  stop();
});

it("does not ask for permission or send a token before sign-in", async () => {
  const api = fakeApi({});
  expect(await syncNativePush("en")).toBe("unsupported");
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(api.calls).toEqual([]);
});
