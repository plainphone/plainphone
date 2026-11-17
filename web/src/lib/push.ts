// SPDX-License-Identifier: Apache-2.0
//
// Web Push in the browser: subscribe this device and hand the subscription to the server.

import { api } from "./api";

export type PushSupport =
  /** Works here. */
  | "ok"
  /** iPhone/iPad in Safari: only works after "Add to Home Screen" (iOS 16.4+). */
  | "ios-install"
  /** No Web Push in this browser. */
  | "none";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function standalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  const has = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIos() && !standalone()) return "ios-install";
  return has ? "ok" : "none";
}

/** A short, human label for this device, e.g. "Chrome on Android". Nothing else is sent. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
        ? "iPad"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  return os ? `${browser} · ${os}` : browser;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  return existing ?? navigator.serviceWorker.register("/sw.js");
}

/** This browser's current subscription endpoint, if any. */
export async function currentEndpoint(): Promise<string | null> {
  if (pushSupport() !== "ok") return null;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}

/** Where this browser keeps its subscription's id on the server. */
export const PUSH_ID_KEY = "pp_push_id";

export class PermissionDenied extends Error {}

/** Asks for permission (must run from a tap), subscribes and registers with the server. */
export async function enablePush(publicKey: string): Promise<{ id: string }> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PermissionDenied();
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another server key cannot be used; start over.
  const key = sub?.options.applicationServerKey;
  if (sub && key && btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== publicKey) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const json = sub.toJSON();
  return api.post<{ id: string }>("/notifications/subscriptions", {
    platform: "web",
    endpoint: json.endpoint,
    keys: json.keys,
    label: deviceLabel(),
  });
}

/** Unsubscribes this browser and removes it on the server. */
export async function disablePush(serverId: string | null): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe();
  if (serverId) await api.del(`/notifications/subscriptions/${serverId}`);
}
