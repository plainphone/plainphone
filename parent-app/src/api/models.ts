// SPDX-License-Identifier: Apache-2.0
//
// Domain types, the same shapes as web/src/lib/api.ts. Request and response types for
// each endpoint come from the generated src/api/schema.d.ts (pnpm gen:api); these are
// the narrower shapes the screens work with.

import type { components } from "./schema";

import type { Language, PhoneLanguage } from "../shared/lib/phone-language";

export type Locale = Language;
export type Profile = "child" | "self";
export type DnsCategory = "social" | "adult" | "gambling" | "games" | "dating" | "video";
export const DNS_CATEGORIES: DnsCategory[] = ["social", "adult", "gambling", "games", "dating", "video"];
/** Open mode: every app is allowed except the block list (docs/open-mode.md). */
export type OpenCategory = "social" | "gambling" | "adult";
export interface OpenModeState {
  enabled: boolean;
  categories: { category: OpenCategory; blocked: boolean; hasApps: boolean }[];
  blockedApps: { packageName: string; label: string }[];
}

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
  pushWakeups?: boolean;
  preferUnifiedPush?: boolean;
  id: string;
  name: string;
  profile: Profile;
  mode: "strong" | "light";
  /** Every app is allowed except the block list. Missing on old servers. */
  openMode?: boolean;
  timezone: string;
  language?: PhoneLanguage;
  lockSystemLanguage?: boolean;
  locationEnabled: boolean;
  locationMode?: LocationMode;
  pairedAt: string | null;
  supportEnabled?: boolean;
  releaseWarningsEnabled?: boolean;
  /** The stop screen offers "Ask for more time", and the phone warns shortly before a limit. Missing on old servers: treat as on. */
  askMoreTimeEnabled?: boolean;
  limitWarningEnabled?: boolean;
  /** Requests for more time nobody has answered yet. */
  openMoreTimeRequests?: number;
  releaseSyncCount?: number;
  androidVersion?: string | null;
  releaseRequestedAt?: string | null;
  setupQrAvailable?: boolean;
  allowServerMove?: boolean;
  awaitingServerMove?: boolean;
  lastSeenAt: string | null;
  /** Only on a single phone: whether it has confirmed the rules the server holds now. */
  rulesCurrent?: boolean | null;
  offlineAlertHours?: number | null;
  offlineAlertHoursDefault?: number;
  dnsHost: string;
  dnsSynced: boolean;
  hasLocation: boolean;
  status?: components["schemas"]["PhoneStatus"] | null;
  attestation?: components["schemas"]["Attestation"] | null;
  dnsConfigured?: boolean;
  dnsReady?: boolean;
  changeReceiptsEnabled?: boolean;
  healthBoardEnabled?: boolean;
  weeklySummaryEnabled?: boolean;
  silentBedtime?: boolean;
  pinApprovalEnabled?: boolean;
  ruleReceipt?: components["schemas"]["PhoneSummary"]["ruleReceipt"];
}
export interface App {
  packageName: string;
  label: string;
  allowed: boolean;
  /** Open mode: on the block list, one by one or with a category. */
  blocked?: boolean;
  /** Set when a blocked category blocks the app. */
  blockedBy?: OpenCategory;
  core: boolean;
}
export interface Contact {
  sosParent?: boolean;
  id: string;
  name: string;
  number: string;
}
export interface DnsState {
  filterMethod?: components["schemas"]["FilterMethod"];
  host: string | null;
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
/** When the phone sends its position: never, on Find, on Find and an unanswered check-in, or every 5 minutes for a chosen time. */
export type LocationMode = "off" | "find" | "checkin" | "always";
export const LOCATION_MODES: LocationMode[] = ["off", "find", "checkin", "always"];
/** How long "always" lasts: one hour, until the phone's local midnight, or 7 days. Then it falls back to "checkin". */
export type AlwaysFor = "hour" | "today" | "week";
export const ALWAYS_FOR: AlwaysFor[] = ["hour", "today", "week"];
export interface Ring {
  id: string;
  /** The phone should be ringing now. */
  active: boolean;
  stopOnAnswer: boolean;
  createdAt: string;
  endsAt: string;
  shownAt: string | null;
  answeredAt: string | null;
  stoppedAt: string | null;
}
export interface Checkin {
  id: string;
  status: "waiting" | "answered" | "cancelled" | "noReply";
  createdAt: string;
  deadline: string;
  callNumber: string | null;
  sendsLocation: boolean;
  shownAt: string | null;
  answeredAt: string | null;
  answer: "ok" | "call" | null;
  stoppedAt: string | null;
  /** The one position sent because nobody answered. */
  locatedAt: string | null;
}
export interface Position {
  lat: number;
  lon: number;
  accuracyM: number | null;
  recordedAt: string;
}
export interface LocationState {
  enabled: boolean;
  mode: LocationMode;
  /** When "always" falls back to "checkin" by itself; null in the other modes. */
  alwaysUntil: string | null;
  requestedAt: string | null;
  location: Position | null;
  ring: Ring | null;
  checkin: Checkin | null;
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
  | { type: "contact.schedule"; restricted: boolean }
  | { type: "dns.method"; method: components["schemas"]["FilterMethod"] }
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
  | { type: "phone.remove"; dnsClientId: string }
  | { type: "phone.release" }
  | { type: "move.allow"; allowed: boolean }
  | { type: "move.start"; exportId: string; serverUrl: string }
  | { type: "timeLimit.set"; packageName: string; limit: Limit | null }
  | { type: "timeLimit.bonus"; packageName: string; date: string; minutes: number }
  | { type: "catalog.add"; packageName: string; label: string }
  | { type: "catalog.remove"; packageName: string };

/** Minutes a day, with optional overrides per ISO weekday ("1" = Monday). See docs/time-limits.md. */
export interface Limit {
  minutes: number;
  days: Partial<Record<string, number>>;
}

export type ApprovalSummary = Record<"en" | "da", string>;

export interface PendingChange {
  summary?: ApprovalSummary;
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
  summary: ApprovalSummary;
  revision: string;
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

