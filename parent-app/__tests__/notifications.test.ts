// SPDX-License-Identifier: Apache-2.0
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { client, setSessionToken } from "../src/api/client";
import { enablePush, getPushSubscriptionId } from "../src/lib/notifications";

afterEach(() => {
  jest.restoreAllMocks();
  setSessionToken(null);
});

test.each([["android", "fcm"], ["ios", "apns"]] as const)(
  "registers the native %s token as %s and stores its subscription ID",
  async (os, platform) => {
    jest.replaceProperty(Platform, "OS", os);
    setSessionToken("mock-session");
    const token = `${platform}-example-token`;
    jest.mocked(Notifications.getDevicePushTokenAsync).mockResolvedValueOnce({ type: os, data: token });
    const post = jest.spyOn(client, "POST").mockResolvedValue({
      data: { id: "mock-subscription" },
      response: new Response(null, { status: 201 }),
    });
    expect(await enablePush("en")).toBe("granted");
    expect(post).toHaveBeenCalledWith("/notifications/subscriptions", { body: { platform, token } });
    expect(await getPushSubscriptionId()).toBe("mock-subscription");
  },
);
