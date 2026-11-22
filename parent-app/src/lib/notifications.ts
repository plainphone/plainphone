// SPDX-License-Identifier: Apache-2.0
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AndroidImportance, AndroidNotificationVisibility, IosAuthorizationStatus } from "expo-notifications";
import { type Href, useRouter } from "expo-router";
import { useEffect } from "react";
import { AppState, Linking, Platform } from "react-native";
import type { Locale } from "../api/models";
import { getSessionToken } from "../api/client";
import { SERVER_URL } from "./config";
import { makeAppT, type TFn } from "../i18n/I18n";
import { ANSWER_KEY, MORE_TIME_ANSWERS } from "@plainphone/shared/more-time";
import { answerMoreTime, followUp, isMoreTimeAnswer, moreTimeTag, moreTimeTarget } from "./moreTime";
import { registerNativeToken } from "./push-registration";

/** The server sends this category id with a request for more time (`categoryId` in FCM, `aps.category` in APNs). */
export const MORE_TIME_CATEGORY = "more-time";

type Channel = { id: string; name: Record<Locale, string>; importance: AndroidImportance } &
  Omit<Notifications.NotificationChannelInput, "name" | "importance">;

export const CHANNELS: Channel[] = [
  { id: "normal", name: { en: "Notifications", da: "Notifikationer", sv: "Aviseringar", nb: "Varsler", de: "Benachrichtigungen" }, importance: AndroidImportance.DEFAULT },
  { id: "quiet", name: { en: "Updates", da: "Opdateringer", sv: "Uppdateringar", nb: "Oppdateringer", de: "Aktualisierungen" }, importance: AndroidImportance.LOW },
  // Heads-up with sound and a long vibration, readable on the lock screen. Android only lets it through
  // Do Not Disturb after the parent allows that in the channel's settings (the button in Settings).
  {
    id: "sos", name: { en: "Urgent SOS", da: "Akut SOS", sv: "Akut SOS", nb: "Akutt SOS", de: "Dringender SOS" }, importance: AndroidImportance.HIGH,
    sound: "default", enableVibrate: true, vibrationPattern: [0, 600, 300, 600, 300, 600], bypassDnd: true,
    lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
  },
];

/** A notification's random receipt id (docs/latency.md); it says nothing about the message. */
const RECEIPT = /^[A-Za-z0-9_-]{22}$/;

/** Tells the server a notification arrived or was opened, for the delivery times. Best effort, no sign-in. */
export function sendPushReceipt(data: unknown, event: "delivered" | "opened") {
  const receipt = (data as { receipt?: unknown } | null | undefined)?.receipt;
  if (typeof receipt !== "string" || !RECEIPT.test(receipt)) return;
  void globalThis.fetch(`${SERVER_URL}/api/push-receipt`, {
    method: "POST", credentials: "omit", headers: { "content-type": "application/json" },
    body: JSON.stringify({ receipt, event }),
  }).catch(() => undefined);
}

/** Opens Android's settings for the Urgent SOS channel, where the parent can let it through Do Not Disturb. */
export async function openSosChannelSettings() {
  const pkg = Constants.expoConfig?.android?.package;
  if (Platform.OS !== "android" || !pkg) return;
  try {
    await Linking.sendIntent("android.settings.CHANNEL_NOTIFICATION_SETTINGS", [
      { key: "android.provider.extra.APP_PACKAGE", value: pkg },
      { key: "android.provider.extra.CHANNEL_ID", value: "sos" },
    ]);
  } catch {
    await Linking.openSettings().catch(() => undefined);
  }
}

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
  if ((d.type === "quick-message" || d.type === "quick-suggestion" || d.type === "check-in" || d.type === "callback-request") && pid) return { pathname: "/phones/[pid]", params: { pid } };
  if (d.type === MORE_TIME_CATEGORY && pid) return { pathname: "/phones/[pid]", params: { pid } };
  return "/";
}

async function ensureChannels(locale: Locale) {
  if (Platform.OS !== "android") return;
  for (const { id, name, ...settings } of CHANNELS) {
    await Notifications.setNotificationChannelAsync(id, { ...settings, name: name[locale] });
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
  // Only while the app runs: a notification shown by the system in the background confirms when it is opened.
  const received = Notifications.addNotificationReceivedListener((n) => sendPushReceipt(n.request.content.data, "delivered"));
  return () => { token.remove(); foreground.remove(); received.remove(); };
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
export async function handleNotificationResponse(r: Notifications.NotificationResponse, canAnswer: boolean, t: TFn): Promise<Href | null> {
  const data = r.notification.request.content.data;
  const action = r.actionIdentifier;
  if (!isMoreTimeAnswer(action)) return routeForPush(data);
  const target = moreTimeTarget(data);
  if (!target) return null;
  if (!canAnswer) return routeForPush(data);
  const confirms = (data as { receipts?: unknown } | undefined)?.receipts !== "false";
  let outcome: { text: string; failed: boolean };
  try {
    outcome = followUp(await answerMoreTime(target.phoneId, target.requestId, action, true), t, confirms);
  } catch {
    outcome = { text: t("moreTime.pushFailed"), failed: true };
  }
  // The buttons do not close the notification by themselves.
  await Notifications.dismissNotificationAsync(r.notification.request.identifier).catch(() => undefined);
  // The follow-up takes the old one's place (same identifier as the tag the server's receipt uses).
  await Notifications.scheduleNotificationAsync({
    identifier: moreTimeTag(target.requestId),
    content: {
      title: typeof (data as { phoneName?: unknown } | undefined)?.phoneName === "string" ? (data as { phoneName: string }).phoneName : "Plainphone",
      body: outcome.text,
      data: { type: outcome.failed ? "more-time-failed" : "more-time-done", phoneId: target.phoneId, url: `/phones/${target.phoneId}` },
      ...(!outcome.failed && { interruptionLevel: "passive" as const }),
    },
    // Android: a failure is something to act on, the rest goes to the quiet channel.
    trigger: { channelId: outcome.failed ? "normal" : "quiet" },
  }).catch(() => undefined);
  // Something the parent has to do: the phone's screen shows the request.
  return outcome.failed ? routeForPush(data) : null;
}

/**
 * Opens the right screen when the user taps a notification, and sends the answer when a button on a request
 * for more time is pressed. Waits for the saved sign-in to load, so an answer is not sent without it.
 */
export function useNotificationRouting(status: "loading" | "anon" | "in", t: TFn) {
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS === "web" || status === "loading") return;
    const handle = (r: Notifications.NotificationResponse) => {
      void handleNotificationResponse(r, status === "in", t).then((href) => {
        if (href) router.push(href);
      });
    };
    const last = Notifications.getLastNotificationResponse();
    if (last && !handled.has(responseKey(last))) {
      handled.add(responseKey(last));
      sendPushReceipt(last.notification.request.content.data, "opened");
      handle(last);
    }
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      handled.add(responseKey(r));
      sendPushReceipt(r.notification.request.content.data, "opened");
      handle(r);
    });
    return () => sub.remove();
  }, [router, status, t]);
}
