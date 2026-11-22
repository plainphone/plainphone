// SPDX-License-Identifier: Apache-2.0
//
// Domain types the shared lib files work with, used by the web dashboard (web/src/lib/api.ts)
// and the parent app (parent-app/src/api/models.ts), which re-export them. Requests and
// responses are described in server/openapi.yaml (@plainphone/api-client).

import type { Language } from "@plainphone/i18n/phone-language";

export type Locale = Language;
export type DnsCategory = "social" | "adult" | "gambling" | "games" | "dating" | "video";
export type FilterMethod = "vpn" | "privateDns";
/** Open mode: every app is allowed except the block list (docs/open-mode.md). */
export type OpenCategory = "social" | "gambling" | "adult";
/** Minutes a day, with optional overrides per ISO weekday ("1" = Monday). See docs/time-limits.md. */
export interface Limit {
  minutes: number;
  days: Partial<Record<string, number>>;
}
export type ScheduleKind = "school" | "bedtime";
export interface ScheduleInput {
  kind: ScheduleKind;
  days: number[];
  startMinute: number;
  endMinute: number;
  allowedPackages: string[];
}
export interface KeyInput {
  /** Invite the trusted person with a QR code instead of an email address (web dashboard). */
  qrInvite?: boolean;
  keyType: "delay" | "trusted";
  delayHours: number;
  trustedEmail: string | null;
  /** "Offer early unlock" (docs/billing.md). Amount and recipient are legacy and only echoed back. */
  payUnlockEnabled: boolean;
  payUnlockAmount: number;
  payUnlockRecipient: "plainphone";
}
export type SettingKey =
  | "bluetooth"
  | "wifi"
  | "mobileNetworks"
  | "roaming"
  | "tethering"
  | "nfc"
  | "airplaneMode"
  | "screenTimeout"
  | "brightness"
  | "volume"
  | "wallpaper"
  | "location"
  | "camera"
  | "screenCapture"
  | "language";
/** `free`: the child (or the Self user) decides. `preset`: set once. `locked`: set and kept. */
export type SettingMode = "free" | "preset" | "locked";
export type SettingValue = string | number;
export interface PhoneSetting {
  mode: SettingMode;
  /** Only for `preset` and `locked`, and only for settings that have a value. */
  value?: SettingValue;
}
export interface Home {
  layout: "list" | "grid";
  theme: "system" | "light" | "dark";
  palette: "grey" | "sage" | "sand";
  /** Package names on the front page, in order. At most 8. */
  apps: string[];
}
export type Op =
  | { type: "app.set"; packageName: string; allowed: boolean }
  | { type: "contact.add"; name: string; number: string }
  | { type: "contact.remove"; contactId: string }
  | { type: "contact.schedule"; restricted: boolean }
  | { type: "dns.method"; method: FilterMethod }
  | { type: "dns.category"; category: DnsCategory; blocked: boolean }
  | { type: "openMode.set"; enabled: boolean }
  | { type: "openMode.category"; category: OpenCategory; blocked: boolean }
  | { type: "dns.allowDomain"; domain: string; present: boolean }
  | { type: "dns.blockDomain"; domain: string; present: boolean }
  | { type: "schedule.create"; schedule: ScheduleInput }
  | { type: "schedule.update"; scheduleId: string; schedule: ScheduleInput }
  | { type: "schedule.delete"; scheduleId: string }
  | { type: "setting.set"; key: SettingKey; setting: PhoneSetting }
  | { type: "home.set"; home: Home }
  | { type: "key.set"; key: KeyInput }
  | { type: "emergency.set"; enabled: boolean; allowance: number }
  | { type: "phone.remove"; dnsClientId: string }
  | { type: "phone.release" }
  | { type: "move.allow"; allowed: boolean }
  | { type: "move.start"; exportId: string; serverUrl: string }
  | { type: "timeLimit.set"; packageName: string; limit: Limit | null }
  | { type: "timeLimit.bonus"; packageName: string; date: string; minutes: number }
  | { type: "catalog.add"; packageName: string; label: string }
  | { type: "catalog.remove"; packageName: string };
