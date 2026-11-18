// SPDX-License-Identifier: Apache-2.0
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
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

// Session changes must wait for an in-flight registration to persist its subscription ID.
let pending: Promise<unknown> = Promise.resolve();

export function withPushRegistration<T>(run: () => Promise<T>): Promise<T> {
  const result = pending.then(run);
  pending = result.catch(() => undefined);
  return result;
}

export function enablePush(locale: "en" | "da", ask = true): Promise<PushState> {
  const session = getSessionToken();
  return withPushRegistration(async () => {
    if (!session || getSessionToken() !== session) return "unavailable";
    return registerPush(locale, ask);
  });
}

async function registerPush(locale: "en" | "da", ask: boolean): Promise<PushState> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return "unsupported";
  const session = getSessionToken();
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

  const previous = await getPushSubscriptionId();
  if (getSessionToken() !== session) return "unavailable";
  const { id } = await unwrap<{ id: string }>(client.POST("/notifications/subscriptions", {
    body: {
      platform: nativeToken.type === "android" ? "fcm" : "apns",
      token: nativeToken.data,
      ...(previous ? { replacesSubscriptionId: previous } : {}),
    },
  }));
  await setItem(SUBSCRIPTION_KEY, id);
  return "granted";
}

export function getPushSubscriptionId() {
  return getItem(SUBSCRIPTION_KEY);
}

export function clearPushSubscription() {
  return removeItem(SUBSCRIPTION_KEY);
}

/** Reconcile the token after sign-in and whenever the app returns to the foreground. */
export function usePushRegistration(session: string | null, locale: "en" | "da") {
  useEffect(() => {
    if (!session || (Platform.OS !== "android" && Platform.OS !== "ios")) return;
    const sync = () => {
      if (getSessionToken() === session) void enablePush(locale, false).catch(() => undefined);
    };
    sync();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => sub.remove();
  }, [session, locale]);
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
