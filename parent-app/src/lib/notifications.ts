// SPDX-License-Identifier: Apache-2.0
import * as Notifications from "expo-notifications";
import { AndroidImportance, IosAuthorizationStatus } from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { getSessionToken } from "../api/client";
import { registerNativeToken, unregisterNativeToken } from "./push-registration";

export const CHANNELS = [
  { id: "normal", name: { en: "Notifications", da: "Notifikationer" }, importance: AndroidImportance.DEFAULT },
  { id: "sos", name: { en: "Urgent SOS", da: "Akut SOS" }, importance: AndroidImportance.HIGH },
];

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: notification.request.content.data?.urgent === "true",
      shouldSetBadge: false,
    }),
  });
}

/** Where a tapped notification leads. Unknown payloads open the start screen. */
export function routeForPush(data: unknown): Href {
  const d = (data ?? {}) as { type?: unknown; phoneId?: unknown; url?: unknown };
  if (d.url === "/settings" || d.url === "/approvals") return d.url;
  const path = typeof d.url === "string" ? /^\/phones\/([0-9a-f-]{36})(\/location)?$/i.exec(d.url) : null;
  if (path) return path[2]
    ? { pathname: "/phones/[pid]/location", params: { pid: path[1]! } }
    : { pathname: "/phones/[pid]", params: { pid: path[1]! } };
  const pid = typeof d.phoneId === "string" && /^[0-9a-f-]{36}$/i.test(d.phoneId) ? d.phoneId : null;
  if (d.type === "approval") return pid ? { pathname: "/phones/[pid]", params: { pid } } : "/approvals";
  if (d.type === "location" && pid) return { pathname: "/phones/[pid]/location", params: { pid } };
  return "/";
}

async function ensureChannels(locale: "en" | "da") {
  if (Platform.OS !== "android") return;
  for (const ch of CHANNELS) {
    await Notifications.setNotificationChannelAsync(ch.id, {
      name: ch.name[locale],
      importance: ch.importance,
    });
  }
}

export type PushState = "unavailable" | "unsupported" | "granted" | "denied" | "undetermined";

function permissionGranted(p: Notifications.NotificationPermissionsStatus) {
  return p.granted || p.ios?.status === IosAuthorizationStatus.PROVISIONAL;
}

async function sendNativeToken(token: Notifications.DevicePushToken, session: string, optIn = false) {
  if (typeof token.data === "string" && (token.type === "ios" || token.type === "android")) {
    return registerNativeToken(token.type === "ios" ? "apns" : "fcm", token.data, session, optIn);
  }
}

export async function syncNativePush(locale: "en" | "da", requestPermission = false): Promise<PushState> {
  const session = getSessionToken();
  if (!session || Platform.OS === "web") return "unsupported";
  try {
    await ensureChannels(locale);
    const p = requestPermission ? await Notifications.requestPermissionsAsync() : await Notifications.getPermissionsAsync();
    if (!permissionGranted(p)) {
      if (getSessionToken() === session) await unregisterNativeToken().catch(() => undefined);
      return p.canAskAgain ? "undetermined" : "denied";
    }
    const registered = await sendNativeToken(await Notifications.getDevicePushTokenAsync(), session, requestPermission);
    return registered === false ? "undetermined" : registered ? "granted" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export function watchNativePush(locale: "en" | "da") {
  if (Platform.OS === "web") return () => {};
  const token = Notifications.addPushTokenListener((value) => {
    const session = getSessionToken();
    if (session) void Notifications.getPermissionsAsync().then((p) => {
      if (permissionGranted(p)) return sendNativeToken(value, session);
    }).catch(() => undefined);
  });
  const foreground = AppState.addEventListener("change", (state) => {
    if (state === "active") void syncNativePush(locale);
  });
  return () => { token.remove(); foreground.remove(); };
}

/** Opens the right screen when the user taps a notification. */
export function useNotificationRouting() {
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS === "web") return;
    const last = Notifications.getLastNotificationResponse();
    if (last) router.push(routeForPush(last.notification.request.content.data));
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      router.push(routeForPush(r.notification.request.content.data));
    });
    return () => sub.remove();
  }, [router]);
}
