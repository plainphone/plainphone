// SPDX-License-Identifier: Apache-2.0
//
// Push notifications, prepared but not yet delivered by the server:
// - "approval": a change waits for your approval (trusted person) or a delay ended,
// - "location": the position you asked for with Find is ready.
//
// The server will send these straight through APNs and FCM (no Expo push service),
// with `data: { type: "approval" | "location", phoneId?: string }`. The app asks for
// permission, creates the Android channels and reads the native device token. Until
// the server has APNs/FCM keys and an endpoint to register the token, nothing is sent.
// On Android, FCM also needs google-services.json at build time; without it the
// token call fails and the app carries on without push.
import * as Notifications from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

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
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

export type PushState = "unsupported" | "granted" | "denied" | "undetermined";

export async function pushState(): Promise<PushState> {
  if (Platform.OS === "web") return "unsupported";
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? "granted" : p.canAskAgain ? "undetermined" : "denied";
}

/**
 * Asks for permission and returns the native push token (APNs or FCM), or null when
 * push is not available in this build. The token is not sent anywhere yet.
 */
export async function enablePush(locale: "en" | "da"): Promise<{ state: PushState; token: string | null }> {
  if (Platform.OS === "web") return { state: "unsupported", token: null };
  await ensureChannels(locale);
  const p = await Notifications.requestPermissionsAsync();
  if (!p.granted) return { state: p.canAskAgain ? "undetermined" : "denied", token: null };
  try {
    const t = await Notifications.getDevicePushTokenAsync();
    return { state: "granted", token: typeof t.data === "string" ? t.data : null };
  } catch {
    return { state: "granted", token: null };
  }
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
