// SPDX-License-Identifier: Apache-2.0
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { client, getSessionToken, unwrap } from "../api/client";
import { getItem, removeItem, setItem } from "./storage";

const SUBSCRIPTION_KEY = "pp.pushSubscription";

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
  if (d.type === "test") return "/settings";
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

export type PushState = "unsupported" | "granted" | "denied" | "undetermined" | "unavailable";

export async function enablePush(locale: "en" | "da", ask = true): Promise<PushState> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return "unsupported";
  const session = getSessionToken();
  if (!session) return "unavailable";
  const permission = ask
    ? await ensureChannels(locale).then(() => Notifications.requestPermissionsAsync())
    : await Notifications.getPermissionsAsync();
  if (!permission.granted) return permission.canAskAgain ? "undetermined" : "denied";
  if (!ask) await ensureChannels(locale);

  let nativeToken: Awaited<ReturnType<typeof Notifications.getDevicePushTokenAsync>>;
  try {
    nativeToken = await Notifications.getDevicePushTokenAsync();
  } catch {
    return "unavailable";
  }
  if (nativeToken.type !== Platform.OS || typeof nativeToken.data !== "string") return "unavailable";

  const previous = await getItem(SUBSCRIPTION_KEY);
  if (getSessionToken() !== session) return "unavailable";
  const { id } = await unwrap<{ id: string }>(client.POST("/notifications/subscriptions", {
    body: { platform: nativeToken.type === "android" ? "fcm" : "apns", token: nativeToken.data },
  }));
  if (previous && previous !== id && getSessionToken() === session) {
    await deleteSubscription(previous);
  }
  await setItem(SUBSCRIPTION_KEY, id);
  return "granted";
}

function deleteSubscription(id: string) {
  return unwrap(client.DELETE("/notifications/subscriptions/{sid}", { params: { path: { sid: id } } }));
}

export async function unregisterPush(): Promise<void> {
  const id = await getItem(SUBSCRIPTION_KEY);
  if (!id) return;
  await deleteSubscription(id);
  await removeItem(SUBSCRIPTION_KEY);
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
