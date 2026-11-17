// SPDX-License-Identifier: Apache-2.0
//
// Push notifications from the Plainphone server, sent straight through APNs and FCM
// (no Expo push service):
// - "alerts": protection removed on a phone, or a phone offline for long,
// - "approval": a change or a request waits for you,
// - "location": the position you asked for with Find is ready.
//
// The app asks for permission, creates the Android channels, reads the native device
// token and registers it with POST /notifications/subscriptions. The payload carries
// `url` (a path in the app) and `channel`; older payloads with `type` and `phoneId` are
// still understood. On Android, FCM needs google-services.json at build time; without
// it the token call fails and the app carries on without push.
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { client, unwrap } from "../api/client";
import { getItem, removeItem, setItem } from "./storage";

export type PushKind = "alerts" | "approval" | "location";

export const CHANNELS: { id: PushKind; name: { en: string; da: string }; high: boolean }[] = [
  { id: "alerts", name: { en: "Phone alerts", da: "Advarsler om telefonen" }, high: true },
  { id: "approval", name: { en: "Changes waiting for approval", da: "Ændringer der venter på godkendelse" }, high: false },
  { id: "location", name: { en: "Location ready", da: "Placering klar" }, high: false },
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

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PHONE_PATH = new RegExp(`^/phones/(${UUID})(/location)?$`, "i");

/** Where a tapped notification leads. Only known in-app paths are followed; anything else opens the start screen. */
export function routeForPush(data: unknown): Href {
  const d = (data ?? {}) as { type?: unknown; phoneId?: unknown; url?: unknown };
  if (typeof d.url === "string") {
    const m = PHONE_PATH.exec(d.url);
    if (m) {
      const pid = m[1]!;
      return m[2] ? { pathname: "/phones/[pid]/location", params: { pid } } : { pathname: "/phones/[pid]", params: { pid } };
    }
    if (d.url === "/approvals") return "/approvals";
    if (d.url === "/settings") return "/settings";
    return "/";
  }
  const pid = typeof d.phoneId === "string" && new RegExp(`^${UUID}$`, "i").test(d.phoneId) ? d.phoneId : null;
  if (d.type === "approval") return pid ? { pathname: "/phones/[pid]", params: { pid } } : "/approvals";
  if (d.type === "location" && pid) return { pathname: "/phones/[pid]/location", params: { pid } };
  return "/";
}

async function ensureChannels(locale: "en" | "da") {
  if (Platform.OS !== "android") return;
  for (const ch of CHANNELS) {
    await Notifications.setNotificationChannelAsync(ch.id, {
      name: ch.name[locale],
      importance: ch.high ? AndroidImportance.HIGH : AndroidImportance.DEFAULT,
    });
  }
}

export type PushState = "unsupported" | "granted" | "denied" | "undetermined";

export async function pushState(): Promise<PushState> {
  if (Platform.OS === "web") return "unsupported";
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? "granted" : p.canAskAgain ? "undetermined" : "denied";
}

/** Id of this install's subscription on the server, so logging out can remove it. */
const SUB_KEY = "pp.pushSubscription";

/** Registers the native token for the signed-in user. Returns false when the server could not be reached. */
export async function registerToken(token: string): Promise<boolean> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return false;
  try {
    const sub = await unwrap<{ id: string }>(
      client.POST("/notifications/subscriptions", {
        body: { platform: Platform.OS === "ios" ? "apns" : "fcm", token, label: Platform.OS === "ios" ? "iPhone" : "Android" },
      }),
    );
    await setItem(SUB_KEY, sub.id);
    return true;
  } catch {
    return false;
  }
}

async function deviceToken(): Promise<string | null> {
  try {
    const t = await Notifications.getDevicePushTokenAsync();
    return typeof t.data === "string" && t.data ? t.data : null;
  } catch {
    return null;
  }
}

/**
 * Asks for permission, reads the native push token (APNs or FCM) and registers it with
 * the server. `token` is null when push is not available in this build.
 */
export async function enablePush(
  locale: "en" | "da",
): Promise<{ state: PushState; token: string | null; registered: boolean }> {
  if (Platform.OS === "web") return { state: "unsupported", token: null, registered: false };
  await ensureChannels(locale);
  const p = await Notifications.requestPermissionsAsync();
  if (!p.granted) return { state: p.canAskAgain ? "undetermined" : "denied", token: null, registered: false };
  const token = await deviceToken();
  return { state: "granted", token, registered: token ? await registerToken(token) : false };
}

/** Removes this install's subscription. Called before logging out; errors are ignored. */
export async function unregisterPush(): Promise<void> {
  const id = await getItem(SUB_KEY).catch(() => null);
  if (!id) return;
  await unwrap(client.DELETE("/notifications/subscriptions/{sid}", { params: { path: { sid: id } } })).catch(
    () => undefined,
  );
  await removeItem(SUB_KEY).catch(() => undefined);
}

/**
 * While signed in with permission granted: registers the current token at start-up
 * (tokens change after a restore or reinstall, and the server may have dropped an old
 * one) and again whenever the system hands out a new one.
 */
export function usePushRegistration(signedIn: boolean, locale: "en" | "da") {
  useEffect(() => {
    if (!signedIn || Platform.OS === "web") return;
    let live = true;
    void (async () => {
      if ((await pushState().catch(() => "unsupported")) !== "granted") return;
      await ensureChannels(locale).catch(() => undefined);
      const token = await deviceToken();
      if (live && token) await registerToken(token);
    })();
    const sub = Notifications.addPushTokenListener((t) => {
      if (typeof t.data === "string" && t.data) void registerToken(t.data);
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, [signedIn, locale]);
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
