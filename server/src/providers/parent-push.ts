// SPDX-License-Identifier: Apache-2.0
//
// Notifications to parents. Web Push for the PWA is built in. Native apps (APNs/FCM) can
// register tokens in the same table, but this provider does not send to them yet.

import { type PushOutcome, sendWebPush, type VapidKeys } from "../lib/webpush.js";

export interface PushMessage {
  title: string;
  body: string;
  /** Path in the parent app to open when the notification is tapped. */
  url: string;
  /** Same tag = the newer notification replaces the older one on the device. */
  tag: string;
  data?: { type: string; phoneId: string };
}

export interface PushTarget {
  platform: "web" | "apns" | "fcm" | "expo";
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
}

export type SendOutcome = PushOutcome | "unsupported";

export interface ParentPushProvider {
  readonly name: string;
  /** Public VAPID key for browsers, or null when Web Push is not configured. */
  readonly webPublicKey: string | null;
  send(target: PushTarget, msg: PushMessage, opts?: { urgent?: boolean }): Promise<SendOutcome>;
}

/** Push services browsers use. Subscriptions elsewhere are refused (the server must not POST anywhere a user says). */
export const DEFAULT_PUSH_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge on Android, Samsung Internet, Opera
  "*.push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari, iOS 16.4+ home screen apps
  "*.notify.windows.com", // Edge on Windows
  "*.push.apple.com",
];

export function pushHostAllowed(endpoint: string, hosts: string[]): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return hosts.some((h) => (h.startsWith("*.") ? host.endsWith(h.slice(1)) && host.length > h.length - 1 : host === h));
}

export class NoParentPushProvider implements ParentPushProvider {
  readonly name = "none";
  readonly webPublicKey = null;
  async send(): Promise<SendOutcome> {
    return "unsupported";
  }
}

export class WebPushProvider implements ParentPushProvider {
  readonly name = "webpush";
  constructor(
    private readonly keys: VapidKeys,
    private readonly subject: string,
  ) {}

  get webPublicKey() {
    return this.keys.publicKey;
  }

  async send(t: PushTarget, msg: PushMessage, opts: { urgent?: boolean } = {}): Promise<SendOutcome> {
    if (t.platform !== "web" || !t.p256dh || !t.auth) return "unsupported";
    const r = await sendWebPush({ endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth }, msg, this.keys, this.subject, {
      urgency: opts.urgent ? "high" : "normal",
      // Push services accept up to 32 URL-safe characters; a newer message replaces an undelivered one.
      topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32),
    });
    if (r.outcome === "failed") console.error(`web push failed with HTTP ${r.status}`);
    return r.outcome;
  }
}

/** Records messages. Used in tests. */
export class MemoryParentPushProvider implements ParentPushProvider {
  readonly name = "memory";
  readonly webPublicKey = "test-public-key";
  readonly sent: { endpoint: string; msg: PushMessage; urgent: boolean }[] = [];
  /** Endpoints that answer 410 Gone. */
  readonly gone = new Set<string>();
  async send(t: PushTarget, msg: PushMessage, opts: { urgent?: boolean } = {}): Promise<SendOutcome> {
    if (t.platform !== "web") return "unsupported";
    if (this.gone.has(t.endpoint)) return "gone";
    this.sent.push({ endpoint: t.endpoint, msg, urgent: Boolean(opts.urgent) });
    return "sent";
  }
}

/** Expo relays native SOS to FCM/APNs. Send only the alert and its dashboard route. */
export class NativeSosPushProvider implements ParentPushProvider {
  constructor(private readonly web: ParentPushProvider, private readonly accessToken?: string) {}
  get name() { return `${this.web.name}+expo`; }
  get webPublicKey() { return this.web.webPublicKey; }

  async send(target: PushTarget, msg: PushMessage, opts?: { urgent?: boolean }): Promise<SendOutcome> {
    if (target.platform !== "expo") return this.web.send(target, msg, opts);
    if (!msg.data?.type.startsWith("sos-")) return "unsupported";
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      signal: AbortSignal.timeout(8_000),
      headers: {
        "content-type": "application/json",
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify({
        to: target.endpoint,
        title: msg.title, body: msg.body, data: msg.data,
        priority: opts?.urgent ? "high" : "normal",
        channelId: msg.data.type,
        sound: opts?.urgent ? "sos-alarm.wav" : "default",
        interruptionLevel: opts?.urgent ? "time-sensitive" : "active",
        ttl: 3600,
      }),
    });
    if (!response.ok) return "failed";
    const { data } = await response.json() as { data?: { status: string; details?: { error?: string } } };
    if (data?.status === "ok") return "sent";
    return data?.details?.error === "DeviceNotRegistered" ? "gone" : "failed";
  }
}
