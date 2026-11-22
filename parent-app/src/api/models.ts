// SPDX-License-Identifier: Apache-2.0
//
// Domain types, the same shapes as web/src/lib/api.ts; the ones the shared lib files need
// come from @plainphone/shared/models. Request and response types for
// each endpoint come from @plainphone/api-client (generated from server/openapi.yaml); these are
// the narrower shapes the screens work with.

import type { components } from "@plainphone/api-client/schema";

import type { PhoneLanguage } from "@plainphone/i18n/phone-language";
import type { EarlyUnlockOffer } from "@plainphone/shared/billing";
import type { DnsCategory, KeyInput, Op, OpenCategory, PhoneSetting, ScheduleInput, SettingKey } from "@plainphone/shared/models";

export type { EarlyUnlockOffer, EarlyUnlockPurchase, Plan } from "@plainphone/shared/billing";
export type { DnsCategory, FilterMethod, Home, KeyInput, Limit, Locale, Op, OpenCategory, PhoneSetting, ScheduleInput, ScheduleKind, SettingKey, SettingMode, SettingValue } from "@plainphone/shared/models";

export type Profile = "child" | "self";
export const DNS_CATEGORIES: DnsCategory[] = ["social", "adult", "gambling", "games", "dating", "video"];
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
  /** This server pairs iPhones (IOS_PAIRING_ENABLED): offer "Add an iPhone". Missing on old servers. */
  iosPairing?: boolean;
}
export interface Phone {
  /** Modes on one weekly plan (docs/modes.md). Child phones only; missing on old servers: off. */
  modesEnabled?: boolean;
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
  dnsHost: string | null;
  dnsSynced: boolean;
  hasLocation: boolean;
  status?: components["schemas"]["PhoneStatus"] | null;
  attestation?: components["schemas"]["Attestation"] | null;
  dnsConfigured?: boolean;
  dnsReady?: boolean;
  rulesDnsReady?: boolean;
  changeReceiptsEnabled?: boolean;
  healthBoardEnabled?: boolean;
  weeklySummaryEnabled?: boolean;
  /** Age presets, the review reminder and the family agreement (Child phones). Missing on old servers. */
  agePreset?: import("@plainphone/shared/age").AgePresetId | null;
  reviewEnabled?: boolean;
  reviewIntervalMonths?: number;
  reviewDueAt?: string | null;
  reviewDue?: boolean;
  agreementEnabled?: boolean;
  agreementOnHome?: boolean;
  agreementHasText?: boolean;
  silentBedtime?: boolean;
  pinApprovalEnabled?: boolean;
  /** Strong mode: the nightly app update window. Missing on old servers (treated as on). */
  appUpdatesEnabled?: boolean;
  appUpdatesRequestedAt?: string | null;
  /** iPhone support (docs/ios/architecture.md). Missing on old servers: an Android phone. */
  platform?: import("@plainphone/shared/platform").Platform;
  tier?: "strong" | "light" | "family_controls" | "supervised";
  capabilities?: components["schemas"]["Capabilities"];
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
export type ContactGroup = components["schemas"]["ContactGroup"];
export type Mode = components["schemas"]["Mode"];
export type ModeInput = components["schemas"]["ModeInput"];
export type ModeSlot = components["schemas"]["ModeSlot"];
export interface Contact {
  /** Only while the server knows contact groups; a parent is always family. */
  group?: ContactGroup;
  sosParent?: boolean;
  id: string;
  name: string;
  number: string;
}
export interface DnsState {
  filterMethod?: components["schemas"]["FilterMethod"];
  host: string | null;
  rulesReady?: boolean;
  synced: boolean;
  blockedCategories: DnsCategory[];
  allowDomains: string[];
  blockDomains: string[];
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
export type KeyLevel = "mild" | "firm" | "strict" | "custom";
/** Emergency openings of a Self phone: off by default, light mode only. */
export interface EmergencySettings {
  enabled: boolean;
  /** Openings per month, 1 to 10. */
  allowance: number;
  minutes: number;
  /** `month` is YYYY-MM. */
  used: { month: string; count: number };
}
export interface EmergencyOpening {
  id: string;
  packageName: string;
  appLabel: string | null;
  openedAt: string;
  minutes: number;
}
export interface EmergencyOpenings extends EmergencySettings {
  openings: EmergencyOpening[];
}
export interface SelfKey extends KeyInput {
  trustedAccepted: boolean;
  payUnlockCurrency: string;
  /** A name for the key, worked out by the server. Missing on older servers. */
  level?: KeyLevel;
  emergency?: EmergencySettings;
}

/** Every setting, `free` filled in. */
export type PhoneSettings = Record<SettingKey, PhoneSetting>;



export type ApprovalSummary = Record<"en" | "da", string>;

export interface PendingChange {
  summary?: ApprovalSummary;
  id: string;
  op: Op;
  keyType: "delay" | "trusted";
  effectiveAt: string | null;
  createdAt?: string;
  /**
   * Paid early unlock (docs/billing.md), only while billing is on. The app never buys one (store
   * rules); it only shows a bought unlock's state and keeps the withdrawal reachable.
   */
  earlyUnlock?: EarlyUnlockOffer;
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

