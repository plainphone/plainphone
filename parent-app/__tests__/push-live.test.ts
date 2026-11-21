// SPDX-License-Identifier: Apache-2.0
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { setSessionToken } from "../src/api/client";
import { CHANNELS, sendPushReceipt, syncNativePush, watchNativePush } from "../src/lib/notifications";

const receipt = "r".repeat(22);
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn(async () => new Response(null, { status: 204 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  setSessionToken(null);
});

it("makes the Urgent SOS channel loud, long-vibrating and visible on the lock screen", async () => {
  const sos = CHANNELS.find((c) => c.id === "sos")!;
  expect(sos).toMatchObject({ importance: Notifications.AndroidImportance.HIGH, sound: "default", bypassDnd: true, enableVibrate: true });
  jest.replaceProperty(Platform, "OS", "android");
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false, canAskAgain: true });
  setSessionToken("pp_s_test");
  await syncNativePush("da");
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith("sos", expect.objectContaining({
    name: "Akut SOS", sound: "default", bypassDnd: true, lockscreenVisibility: 1,
  }));
});

it("posts a receipt without the session for a well-formed id only", async () => {
  setSessionToken("pp_s_test");
  sendPushReceipt({ receipt, type: "sos-urgent" }, "opened");
  sendPushReceipt({ receipt: "../x" }, "delivered");
  sendPushReceipt(undefined, "delivered");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toMatch(/\/api\/push-receipt$/);
  expect(init).toMatchObject({ method: "POST", credentials: "omit", body: JSON.stringify({ receipt, event: "opened" }) });
  expect(JSON.stringify(init.headers)).not.toContain("pp_s_test");
});

it("confirms arrival of a notification that reaches the running app", () => {
  const stop = watchNativePush("en");
  const listener = (Notifications.addNotificationReceivedListener as jest.Mock).mock.calls[0][0];
  listener({ request: { content: { data: { receipt } } } });
  expect(fetchMock.mock.calls[0]![1]).toMatchObject({ body: JSON.stringify({ receipt, event: "delivered" }) });
  stop();
});
