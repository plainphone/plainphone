// SPDX-License-Identifier: Apache-2.0
//
// How fast and how loud each push goes out, per message kind and provider (docs/latency.md).
// One table so FCM, APNs and Web Push never disagree about what is urgent.

import type { WakeReason } from "../providers/push.js";

/**
 * - `alarm`: urgent SOS, code words and lost protection. Breaks through where the parent allowed it.
 * - `prompt`: something a parent should see now (help SOS, quick messages, "Are you okay?" answers, requests with buttons).
 * - `normal`: everything else; it may wait for the device's next wake-up.
 */
export type PushClass = "alarm" | "prompt" | "normal";

export interface Delivery {
  /** Seconds a provider keeps an undelivered message. */
  ttlSeconds: number;
  fcmPriority: "HIGH" | "NORMAL";
  webUrgency: "high" | "normal";
  apnsPriority: "10" | "5";
  /** iOS 15+ interruption level; "time-sensitive" needs the entitlement the app carries. */
  interruption: "time-sensitive" | "active" | "passive";
}

const HOUR = 3600;

export const DELIVERY: Record<PushClass, Delivery> = {
  // An SOS is still worth showing when a parent's phone comes back after hours without signal.
  alarm: { ttlSeconds: 24 * HOUR, fcmPriority: "HIGH", webUrgency: "high", apnsPriority: "10", interruption: "time-sensitive" },
  prompt: { ttlSeconds: 4 * HOUR, fcmPriority: "HIGH", webUrgency: "high", apnsPriority: "10", interruption: "active" },
  normal: { ttlSeconds: 24 * HOUR, fcmPriority: "NORMAL", webUrgency: "normal", apnsPriority: "5", interruption: "active" },
};

/** The class of a parent notification, from its event type (services/notifications.ts). `urgent` always wins. */
export function pushClass(eventType: string, urgent: boolean): PushClass {
  if (urgent) return "alarm";
  switch (eventType) {
    case "sos": // a help SOS; an urgent SOS or a code word arrives with `urgent`
    case "quickMessage":
    case "checkIn":
    case "safety":
    case "moreTime":
    case "request":
    case "request-on-phone":
    case "approval":
    case "test":
      return "prompt";
    default:
      return "normal";
  }
}

/**
 * Child phone wake-ups are content-free data messages (docs/sync-api.md#push-wakeups). A ring or an
 * "Are you okay?" is pointless minutes later (polling has caught up by then), a rule change and an
 * acknowledged SOS stay useful a little longer, and an app update for an hour.
 */
export const WAKE_TTL_SECONDS: Record<WakeReason, number> = {
  locate: 120,
  "sos-ack": 600,
  rules: 900,
  update: HOUR,
};
