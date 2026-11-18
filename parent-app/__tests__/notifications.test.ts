// SPDX-License-Identifier: Apache-2.0
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { client, setSessionToken } from "../src/api/client";
import { enablePush, unregisterPush } from "../src/lib/notifications";

afterEach(() => {
  jest.restoreAllMocks();
  setSessionToken(null);
});

test.each([["android", "fcm"], ["ios", "apns"]] as const)(
  "registers the native %s token as %s and unregisters it on demand",
  async (os, platform) => {
    jest.replaceProperty(Platform, "OS", os);
    setSessionToken("mock-session");
    const token = `${platform}-example-token`;
    jest.mocked(Notifications.getDevicePushTokenAsync).mockResolvedValueOnce({ type: os, data: token });
    const post = jest.spyOn(client, "POST").mockResolvedValue({
      data: { id: "mock-subscription" },
      response: new Response(null, { status: 201 }),
    });
    const remove = jest.spyOn(client, "DELETE").mockResolvedValue({ response: new Response(null, { status: 204 }) });

    expect(await enablePush("en")).toBe("granted");
    expect(post).toHaveBeenCalledWith("/notifications/subscriptions", { body: { platform, token } });
    await unregisterPush();
    expect(remove).toHaveBeenCalledWith("/notifications/subscriptions/{sid}", {
      params: { path: { sid: "mock-subscription" } },
    });
  },
);
