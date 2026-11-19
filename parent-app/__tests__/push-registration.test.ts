// SPDX-License-Identifier: Apache-2.0
import * as Notifications from "expo-notifications";
import { setSessionToken } from "../src/api/client";
import { syncNativePush, watchNativePush } from "../src/lib/notifications";
import { logoutNativeSession, registerNativeToken } from "../src/lib/push-registration";
import { removeItem } from "../src/lib/storage";
import { fakeApi } from "../test/fakeApi";

afterEach(async () => {
  await removeItem("pp.push-registration");
  await removeItem("pp.push-installation");
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

it.each(["lost", "delayed"])("revokes the session with a %s first POST response", async (outcome) => {
  const session = `pp_s_${outcome}`;
  setSessionToken(session);
  let respond!: (response: Response) => void;
  let reject!: (error: Error) => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const revoke = jest.fn();
  globalThis.fetch = jest.fn(async (input) => {
    const request = input as Request;
    if (request.url.endsWith("/notifications/subscriptions")) {
      return new Promise<Response>((resolve, fail) => { respond = resolve; reject = fail; started(); });
    }
    revoke(request.method, request.url, request.headers.get("authorization"));
    return new Response(null, { status: 204 });
  });
  const registration = registerNativeToken("fcm", "fcm-token", session);
  const settled = registration.catch(() => false);
  await requestStarted;
  if (outcome === "lost") reject(new Error("response lost"));
  await logoutNativeSession();
  expect(revoke).toHaveBeenCalledTimes(1);
  expect(revoke).toHaveBeenCalledWith("POST", expect.stringContaining("/auth/logout"), `Bearer ${session}`);
  if (outcome === "delayed") respond(new Response(JSON.stringify({ id: "new-id" }), {
    status: 201, headers: { "content-type": "application/json" },
  }));
  expect(await settled).toBe(false);
});

it("keeps dashboard removal after logout and re-login until explicit opt-in", async () => {
  let removed = false;
  let installationKey: string | undefined;
  const api = fakeApi({
    "POST /auth/logout": { status: 204 },
    "POST /notifications/subscriptions": ({ body }) => {
      const input = body as { installationKey: string; optIn?: boolean };
      if (removed && (!installationKey || input.installationKey !== installationKey)) {
        throw new Error("registration lost its installation key");
      }
      installationKey = input.installationKey;
      return removed && !input.optIn ? { status: 404 } : { status: 201, body: { id: "subscription-id" } };
    },
  });
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  setSessionToken("pp_s_revoked");
  expect(await syncNativePush("en")).toBe("granted");
  removed = true;
  await logoutNativeSession();
  setSessionToken("pp_s_signed_in_again");
  (Notifications.getDevicePushTokenAsync as jest.Mock).mockResolvedValueOnce({ type: "android", data: "rotated" });
  expect(await syncNativePush("en")).toBe("undetermined");
  expect(api.calls.at(-1)?.body).toMatchObject({ token: "rotated", installationKey: "fcm-token" });
  expect(await syncNativePush("en", true)).toBe("granted");
});

it("refreshes a provider-cleaned subscription when the SDK supplies a fresh token", async () => {
  const session = "pp_s_provider_cleanup";
  setSessionToken(session);
  const api = fakeApi({
    "POST /notifications/subscriptions": ({ body }) => {
      const input = body as { token: string; installationKey?: string; optIn?: boolean };
      return input.token === "fresh-token" && (input.installationKey !== "old-token" || input.optIn)
        ? { status: 404 } : { status: 201, body: { id: "subscription-id" } };
    },
  });
  expect(await registerNativeToken("fcm", "old-token", session)).toBe(true);
  expect(await registerNativeToken("fcm", "fresh-token", session)).toBe(true);
  expect(api.calls.at(-1)?.body).toMatchObject({ token: "fresh-token", installationKey: "old-token" });
});
