// SPDX-License-Identifier: Apache-2.0
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { ApiError, getSessionToken, makeClient, unwrap } from "../api/client";
import { getItem, removeItem, setItem } from "./storage";

const SOS_SUBSCRIPTION = "sos-push-subscription";
const PENDING_LOGOUT = "sos-pending-logout";
type PendingLogout = { sid: string; session: string };

let logoutQueue = Promise.resolve();
function serializeLogout(action: () => Promise<void>) {
  const result = logoutQueue.then(action);
  logoutQueue = result.catch(() => undefined);
  return result;
}

async function withPushRequestTimeout<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function revokePendingLogouts() {
  const entries = JSON.parse(await getItem(PENDING_LOGOUT) ?? "[]") as PendingLogout[];
  for (const [index, entry] of entries.entries()) {
    const previous = makeClient(undefined, undefined, entry.session);
    try {
      await withPushRequestTimeout((signal) => unwrap(previous.DELETE("/notifications/subscriptions/{sid}", {
        params: { path: { sid: entry.sid } }, signal,
      })));
      await withPushRequestTimeout((signal) => unwrap(previous.POST("/auth/logout", { signal })));
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) throw err;
    }
    await setItem(PENDING_LOGOUT, JSON.stringify(entries.slice(index + 1)));
  }
}

export function retrySosLogout() {
  return serializeLogout(revokePendingLogouts);
}

export type PushKind = "approval" | "location" | "sos-urgent" | "sos-help";

export const CHANNELS: { id: PushKind; name: { en: string; da: string } }[] = [
  { id: "approval", name: { en: "Changes waiting for approval", da: "Ændringer der venter på godkendelse" } },
  { id: "sos-urgent", name: { en: "Urgent SOS", da: "Akut SOS" } },
  { id: "sos-help", name: { en: "SOS", da: "SOS" } },
  { id: "location", name: { en: "Location ready", da: "Placering klar" } },
];

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: notification.request.content.data?.type === "sos-urgent",
      shouldSetBadge: false,
    }),
  });
}

/** Where a tapped notification leads. Unknown payloads open the start screen. */
export function routeForPush(data: unknown): Href {
  const d = (data ?? {}) as { type?: unknown; phoneId?: unknown };
  const pid = typeof d.phoneId === "string" && /^[0-9a-f-]{36}$/i.test(d.phoneId) ? d.phoneId : null;
  if (d.type === "approval") return pid ? { pathname: "/phones/[pid]", params: { pid } } : "/approvals";
  if ((d.type === "sos-urgent" || d.type === "sos-help") && pid) return { pathname: "/phones/[pid]", params: { pid } };
  if (d.type === "location" && pid) return { pathname: "/phones/[pid]/location", params: { pid } };
  return "/";
}

async function ensureChannels(locale: "en" | "da") {
  if (Platform.OS !== "android") return;
  for (const ch of CHANNELS) {
    await Notifications.setNotificationChannelAsync(ch.id, {
      name: ch.name[locale],
      importance: ch.id === "sos-urgent" ? AndroidImportance.HIGH : AndroidImportance.DEFAULT,
      ...(ch.id === "sos-urgent" ? { sound: "sos-alarm.wav", bypassDnd: true } : {}),
    });
  }
}

export type PushState = "unsupported" | "granted" | "denied" | "undetermined";

export async function pushState(): Promise<PushState> {
  if (Platform.OS === "web") return "unsupported";
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? "granted" : p.canAskAgain ? "undetermined" : "denied";
}

/** Requests permissions and registers this install for SOS. */
export async function enablePush(locale: "en" | "da"): Promise<{ state: PushState; token: string | null }> {
  if (Platform.OS === "web") return { state: "unsupported", token: null };
  const session = getSessionToken();
  if (!session) throw new ApiError(401, "sign in first");
  await ensureChannels(locale);
  const p = await Notifications.requestPermissionsAsync();
  if (!p.granted) return { state: p.canAskAgain ? "undetermined" : "denied", token: null };
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error("Missing Expo push project ID");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await serializeLogout(async () => {
    await revokePendingLogouts();
    if (getSessionToken() !== session) throw new ApiError(401, "sign in again");
    const signedIn = makeClient(undefined, undefined, session);
    const sub = await withPushRequestTimeout((signal) => unwrap<{ id: string }>(signedIn.POST("/notifications/subscriptions", {
      body: { platform: "expo", token, label: Platform.OS === "ios" ? "iOS" : "Android" }, signal,
    })));
    const previous = await getItem(SOS_SUBSCRIPTION);
    await setItem(SOS_SUBSCRIPTION, sub.id);
    if (previous && previous !== sub.id) {
      await withPushRequestTimeout((signal) => unwrap(signedIn.DELETE("/notifications/subscriptions/{sid}", {
        params: { path: { sid: previous } }, signal,
      })));
    }
  });
  return { state: "granted", token };
}

/** Keep the former credential only to finish revoking its subscription and session. */
export function revokeSosOnLogout(session: string) {
  return serializeLogout(async () => {
    const sid = await getItem(SOS_SUBSCRIPTION);
    if (!sid) {
      await withPushRequestTimeout((signal) => unwrap(makeClient(undefined, undefined, session).POST("/auth/logout", { signal })));
      return;
    }
    const entries = JSON.parse(await getItem(PENDING_LOGOUT) ?? "[]") as PendingLogout[];
    await setItem(PENDING_LOGOUT, JSON.stringify([...entries, { sid, session }]));
    await removeItem(SOS_SUBSCRIPTION);
    await revokePendingLogouts();
  });
}

export async function clearLocalNotifications() {
  if (Platform.OS !== "web") {
    await Notifications.dismissAllNotificationsAsync();
    Notifications.clearLastNotificationResponse();
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
