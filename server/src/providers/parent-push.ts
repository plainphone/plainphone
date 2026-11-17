// SPDX-License-Identifier: Apache-2.0
//
// Notifications to parents: Web Push for the PWA, APNs and FCM for the native app
// (providers/native-push.ts). All three share the push_subscriptions table.

import { type PushOutcome, sendWebPush, type VapidKeys } from "../lib/webpush.js";
import type { NativeSender } from "./native-push.js";

export interface PushMessage {
  title: string;
  body: string;
  /** Path in the parent app to open when the notification is tapped. */
  url: string;
  /** Same tag = the newer notification replaces the older one on the device. */
  tag: string;
  /** Android notification channel in the native app. */
  channel: "alerts" | "approval" | "location";
}

export interface PushTarget {
  platform: "web" | "apns" | "fcm";
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
}

export type SendOutcome = PushOutcome | "unsupported";

export interface ParentPushProvider {
  readonly name: string;
  /** Public VAPID key for browsers, or null when Web Push is not configured. */
  readonly webPublicKey: string | null;
  /** Which kinds of subscriptions this server can deliver to. */
  readonly platforms: ReadonlySet<PushTarget["platform"]>;
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
  readonly platforms = new Set<PushTarget["platform"]>();
  async send(): Promise<SendOutcome> {
    return "unsupported";
  }
}

export class WebPushProvider implements ParentPushProvider {
  readonly name = "webpush";
  readonly platforms = new Set<PushTarget["platform"]>(["web"]);
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

/** Sends each subscription through the channel for its platform. */
export class ParentPushRouter implements ParentPushProvider {
  readonly name: string;
  readonly platforms: ReadonlySet<PushTarget["platform"]>;
  private readonly native: Partial<Record<"apns" | "fcm", NativeSender>>;

  constructor(
    private readonly web: WebPushProvider | null,
    native: NativeSender[],
  ) {
    this.native = Object.fromEntries(native.map((n) => [n.name, n]));
    const names = [...(web ? ["webpush"] : []), ...native.map((n) => n.name)];
    this.name = names.join("+") || "none";
    this.platforms = new Set<PushTarget["platform"]>([...(web ? (["web"] as const) : []), ...native.map((n) => n.name)]);
  }

  get webPublicKey() {
    return this.web?.webPublicKey ?? null;
  }

  async send(t: PushTarget, msg: PushMessage, opts: { urgent?: boolean } = {}): Promise<SendOutcome> {
    if (t.platform === "web") return this.web ? this.web.send(t, msg, opts) : "unsupported";
    const sender = this.native[t.platform];
    return sender ? sender.send(t.endpoint, msg, opts) : "unsupported";
  }
}

/** Records messages. Used in tests. */
export class MemoryParentPushProvider implements ParentPushProvider {
  readonly name = "memory";
  readonly webPublicKey = "test-public-key";
  readonly platforms = new Set<PushTarget["platform"]>(["web", "apns", "fcm"]);
  readonly sent: { endpoint: string; platform: PushTarget["platform"]; msg: PushMessage; urgent: boolean }[] = [];
  /** Endpoints that answer 410 Gone. */
  readonly gone = new Set<string>();
  async send(t: PushTarget, msg: PushMessage, opts: { urgent?: boolean } = {}): Promise<SendOutcome> {
    if (this.gone.has(t.endpoint)) return "gone";
    this.sent.push({ endpoint: t.endpoint, platform: t.platform, msg, urgent: Boolean(opts.urgent) });
    return "sent";
  }
}
