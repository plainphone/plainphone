// SPDX-License-Identifier: Apache-2.0
//
// Domain types, the same shapes as web/src/lib/api.ts. Request and response types for
// each endpoint come from the generated src/api/schema.d.ts (pnpm gen:api); these are
// the narrower shapes the screens work with.

export type Locale = "en" | "da";
export type Profile = "child" | "self";
export type DnsCategory = "social" | "adult" | "gambling" | "games" | "dating" | "video";
export const DNS_CATEGORIES: DnsCategory[] = ["social", "adult", "gambling", "games", "dating", "video"];

export interface User {
  id: string;
  email: string;
  locale: string;
}
export interface Me {
  user: User;
  households: { id: string; name: string; role: "owner" | "parent" }[];
  mailEnabled: boolean;
}
export interface Phone {
  id: string;
  name: string;
  profile: Profile;
  mode: "strong" | "light";
  timezone: string;
  locationEnabled: boolean;
  pairedAt: string | null;
  lastSeenAt: string | null;
  dnsHost: string;
  dnsSynced: boolean;
  hasLocation: boolean;
}
export interface App {
  packageName: string;
  label: string;
  allowed: boolean;
  core: boolean;
}
export interface Contact {
  id: string;
  name: string;
  number: string;
}
export interface DnsState {
  host: string;
  synced: boolean;
  blockedCategories: DnsCategory[];
  allowDomains: string[];
  blockDomains: string[];
}
export type ScheduleKind = "school" | "bedtime";
export interface ScheduleInput {
  kind: ScheduleKind;
  days: number[];
  startMinute: number;
  endMinute: number;
  allowedPackages: string[];
}
export interface Schedule extends ScheduleInput {
  id: string;
}
export interface LocationState {
  enabled: boolean;
  requestedAt: string | null;
  location: { lat: number; lon: number; accuracyM: number | null; recordedAt: string } | null;
}
export interface KeyInput {
  keyType: "delay" | "trusted";
  delayHours: number;
  trustedEmail: string | null;
  payUnlockEnabled: boolean;
  payUnlockAmount: number;
  payUnlockRecipient: "plainphone";
}
export interface SelfKey extends KeyInput {
  trustedAccepted: boolean;
  payUnlockCurrency: string;
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
/** Every setting, `free` filled in. */
export type PhoneSettings = Record<SettingKey, PhoneSetting>;
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
  | { type: "dns.category"; category: DnsCategory; blocked: boolean }
  | { type: "dns.allowDomain"; domain: string; present: boolean }
  | { type: "dns.blockDomain"; domain: string; present: boolean }
  | { type: "schedule.create"; schedule: ScheduleInput }
  | { type: "schedule.update"; scheduleId: string; schedule: ScheduleInput }
  | { type: "schedule.delete"; scheduleId: string }
  | { type: "setting.set"; key: SettingKey; setting: PhoneSetting }
  | { type: "home.set"; home: Home }
  | { type: "key.set"; key: KeyInput }
  | { type: "phone.remove"; dnsClientId: string };

export interface PendingChange {
  id: string;
  op: Op;
  keyType: "delay" | "trusted";
  effectiveAt: string | null;
  createdAt?: string;
}
export type ChangeResult = { status: "applied" } | { status: "pending"; change: PendingChange };

export interface Approval {
  id: string;
  phoneName: string;
  requestedBy: string | null;
  op: Op;
  /** The app's name for app.set ops, when the phone has reported it. */
  appLabel: string | null;
  createdAt: string;
}
export interface Members {
  members: { id: string; email: string; role: "owner" | "parent" }[];
  invites: { id: string; email: string; expiresAt: string }[];
}
export interface InviteResult {
  id: string;
  email: string;
  expiresAt: string;
  mailed: boolean;
  url?: string;
}

