// SPDX-License-Identifier: Apache-2.0
//
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { ApiError, client, getSessionToken, unwrap } from "../api/client";
import { SERVER_URL } from "./config";

export type PushKind = "approval" | "location";

export const CHANNELS: { id: PushKind; name: { en: string; da: string } }[] = [
  { id: "approval", name: { en: "Changes waiting for approval", da: "Ændringer der venter på godkendelse" } },
  { id: "location", name: { en: "Location ready", da: "Placering klar" } },
];

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** Where a tapped notification leads. Unknown payloads open the start screen. */
export function routeForPush(data: unknown): Href {
  const d = (data ?? {}) as { type?: unknown; phoneId?: unknown };
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
      importance: AndroidImportance.DEFAULT,
    });
  }
}

export type PushState = "unsupported" | "registered" | "granted" | "denied" | "undetermined";

async function nativeSubscription(session: string | null, server: string) {
  const { data: token } = await Notifications.getDevicePushTokenAsync();
  if (typeof token !== "string") throw new Error("Native push token unavailable");
  if (!session || session !== getSessionToken() || server !== SERVER_URL) throw new Error("Session changed");
  return { platform: Platform.OS === "ios" ? "apns" as const : "fcm" as const, token };
}

export async function pushState(): Promise<PushState> {
  if (Platform.OS === "web") return "unsupported";
  const session = getSessionToken();
  const server = SERVER_URL;
  const p = await Notifications.getPermissionsAsync();
  if (!p.granted) return p.canAskAgain ? "undetermined" : "denied";
  try {
    const body = await nativeSubscription(session, server);
    const status = await unwrap<{ registered: boolean }>(client.POST("/notifications/subscriptions/status", { body }));
    return status.registered ? "registered" : "granted";
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return "granted"; // Older self-hosted server.
    throw err;
  }
}

/** Requests permission and registers the native device on the signed-in server. */
export async function enablePush(locale: "en" | "da"): Promise<PushState> {
  const session = getSessionToken();
  const server = SERVER_URL;
  if (Platform.OS === "web") return "unsupported";
  await ensureChannels(locale);
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return permission.canAskAgain ? "undetermined" : "denied";
  const body = await nativeSubscription(session, server);
  await unwrap(client.POST("/notifications/subscriptions", { body }));
  return "registered";
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
