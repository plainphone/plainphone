// SPDX-License-Identifier: Apache-2.0
import * as Notifications from "expo-notifications";
import { AndroidImportance, IosAuthorizationStatus } from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import type { Locale } from "../api/models";
import { getSessionToken } from "../api/client";
import { makeAppT } from "../i18n/I18n";
import { ANSWER_KEY, MORE_TIME_ANSWERS } from "../shared/lib/more-time";
import { answerMoreTime, isMoreTimeAnswer, moreTimeTarget } from "./moreTime";
import { registerNativeToken } from "./push-registration";

/** The server sends this category id with a request for more time (`categoryId` in FCM, `aps.category` in APNs). */
export const MORE_TIME_CATEGORY = "more-time";

export const CHANNELS: { id: string; name: Record<Locale, string>; importance: AndroidImportance }[] = [
  { id: "normal", name: { en: "Notifications", da: "Notifikationer", sv: "Aviseringar", nb: "Varsler", de: "Benachrichtigungen" }, importance: AndroidImportance.DEFAULT },
  { id: "sos", name: { en: "Urgent SOS", da: "Akut SOS", sv: "Akut SOS", nb: "Akutt SOS", de: "Dringender SOS" }, importance: AndroidImportance.HIGH },
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
  if (d.type === "summary" || (typeof d.url === "string" && /^\/summary(\?|$)/.test(d.url))) {
    const week = typeof d.url === "string" ? /^\/summary\?week=([0-9a-f-]{36})$/i.exec(d.url)?.[1] : undefined;
    return week ? { pathname: "/summary", params: { week } } : "/summary";
  }
  const path = typeof d.url === "string" ? /^\/phones\/([0-9a-f-]{36})(\/location)?$/i.exec(d.url) : null;
  if (path) return path[2]
    ? { pathname: "/phones/[pid]/location", params: { pid: path[1]! } }
    : { pathname: "/phones/[pid]", params: { pid: path[1]! } };
  const pid = typeof d.phoneId === "string" && /^[0-9a-f-]{36}$/i.test(d.phoneId) ? d.phoneId : null;
  if (d.type === "approval") return pid ? { pathname: "/phones/[pid]", params: { pid } } : "/approvals";
  if ((d.type === "sos-urgent" || d.type === "sos-help") && pid) return { pathname: "/phones/[pid]", params: { pid } };
  if (d.type === "location" && pid) return { pathname: "/phones/[pid]/location", params: { pid } };
  if (d.type === MORE_TIME_CATEGORY && pid) return { pathname: "/phones/[pid]", params: { pid } };
  return "/";
}

async function ensureChannels(locale: Locale) {
  if (Platform.OS !== "android") return;
  for (const ch of CHANNELS) {
    await Notifications.setNotificationChannelAsync(ch.id, {
      name: ch.name[locale],
      importance: ch.importance,
    });
  }
}

/**
 * The four answer buttons under a request for more time. The action identifiers are the answers
 * the API takes. The titles come from the app's language. The buttons open the app on both platforms: the answer is sent from the React tree, and without a background task a closed iOS app would drop it.
 */
export async function ensureCategories(locale: Locale) {
  if (Platform.OS === "web") return;
  const t = makeAppT(locale);
  try {
    await Notifications.setNotificationCategoryAsync(
      MORE_TIME_CATEGORY,
      MORE_TIME_ANSWERS.map((answer) => ({
        identifier: answer,
        buttonTitle: t(ANSWER_KEY[answer]),
        options: { opensAppToForeground: true },
      })),
    );
  } catch {
    // Without the buttons the notification still opens the phone's screen.
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

export async function syncNativePush(locale: Locale, requestPermission = false): Promise<PushState> {
  const session = getSessionToken();
  if (!session || Platform.OS === "web") return "unsupported";
  try {
    await ensureChannels(locale);
    await ensureCategories(locale);
    const p = requestPermission ? await Notifications.requestPermissionsAsync() : await Notifications.getPermissionsAsync();
    if (!permissionGranted(p)) {
      // A missing OS permission is not a dashboard removal: only skip registering, never tombstone.
      return p.canAskAgain ? "undetermined" : "denied";
    }
    const registered = await sendNativeToken(await Notifications.getDevicePushTokenAsync(), session, requestPermission);
    return registered === false ? "undetermined" : registered ? "granted" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export function watchNativePush(locale: Locale) {
  if (Platform.OS === "web") return () => {};
  void ensureCategories(locale);
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

/** Removes delivered alerts (SOS included) from the shelf when the parent signs out. */
export async function clearLocalNotifications() {
  if (Platform.OS === "web") return;
  await Notifications.dismissAllNotificationsAsync();
  Notifications.clearLastNotificationResponse();
}

/** Responses already handled, so the one kept for the app's start is not handled twice. */
const handled = new Set<string>();
const responseKey = (r: Notifications.NotificationResponse) => `${r.notification.request.identifier}|${r.actionIdentifier}|${r.notification.date}`;

/**
 * What a notification tap or button asks for. An answer button on a request for more time sends the answer
 * and returns null (nothing to open). The default tap, a failed answer, and everything else return the screen to open.
 * A button press whose payload is not a request is dropped.
 */
export async function handleNotificationResponse(r: Notifications.NotificationResponse, canAnswer: boolean): Promise<Href | null> {
  const data = r.notification.request.content.data;
  const action = r.actionIdentifier;
  if (!isMoreTimeAnswer(action)) return routeForPush(data);
  const target = moreTimeTarget(data);
  if (!target) return null;
  if (!canAnswer) return routeForPush(data);
  try {
    await answerMoreTime(target.phoneId, target.requestId, action);
  } catch {
    return routeForPush(data);
  }
  // The buttons do not close the notification by themselves, and the phone's screen shows the result.
  await Notifications.dismissNotificationAsync(r.notification.request.identifier).catch(() => undefined);
  return null;
}

/**
 * Opens the right screen when the user taps a notification, and sends the answer when a button on a request
 * for more time is pressed. Waits for the saved sign-in to load, so an answer is not sent without it.
 */
export function useNotificationRouting(status: "loading" | "anon" | "in") {
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS === "web" || status === "loading") return;
    const handle = (r: Notifications.NotificationResponse) => {
      void handleNotificationResponse(r, status === "in").then((href) => {
        if (href) router.push(href);
      });
    };
    const last = Notifications.getLastNotificationResponse();
    if (last && !handled.has(responseKey(last))) {
      handled.add(responseKey(last));
      handle(last);
    }
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      handled.add(responseKey(r));
      handle(r);
    });
    return () => sub.remove();
  }, [router, status]);
}
