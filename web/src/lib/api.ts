// SPDX-License-Identifier: Apache-2.0
//
// Thin client for the parent API. The session lives in an HttpOnly cookie (path /api),
// so the app never sees or stores a token. Paths are checked against server/openapi.yaml
// (@plainphone/api-client).

import type { AgePreset, AgePresetId, AgeState, Agreement } from "@plainphone/shared/age";
import type { EarlyUnlockOffer } from "@plainphone/shared/billing";
import { createClient } from "@plainphone/api-client";
import type { PhoneLanguage } from "@plainphone/i18n/phone-language";
import type { DnsCategory, FilterMethod, Home, KeyInput, Limit, Op, OpenCategory, PhoneSetting, ScheduleInput, SettingKey } from "@plainphone/shared/models";

export type { DnsCategory, FilterMethod, Home, KeyInput, Limit, Locale, Op, OpenCategory, PhoneSetting, ScheduleInput, ScheduleKind, SettingKey, SettingMode, SettingValue } from "@plainphone/shared/models";

export type Profile = "child" | "self";
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
  /** This server pairs iPhones (IOS_PAIRING_ENABLED): offer "Add an iPhone". Missing on old servers. */
  iosPairing?: boolean;
}
/** What an iPhone reports besides the common fields (docs/ios/architecture.md). */
export interface IosStatus {
  iosVersion: string;
  authorizationStatus: "notDetermined" | "denied" | "approved";
  communicationLimits?: boolean | null;
  dnsEnabled?: boolean | null;
  locationAuth?: "notDetermined" | "denied" | "whenInUse" | "always";
  effectiveStores?: string[];
}
/** An iPhone's app selection: Apple's coded list, opaque to the dashboard. */
export interface IosSelectionState {
  selection: string | null;
  source: "parent" | "phone" | null;
  updatedAt: string | null;
}
/** What the phone last reported about itself (`PUT /device/status`). */
export interface PhoneStatus {
  ios?: IosStatus;
  pushProvider?: "none" | "fcm" | "unifiedpush";
  filterMethod?: FilterMethod;
  filterWorking?: boolean;
  filterIssue?: "off" | "automatic" | "wrongHost" | "waiting" | "unverified" | "alwaysOn" | "strictDns";
  appVersion: string;
  /** Where the Android app came from; missing means github. play has no device admin and is updated by Google Play. */
  distribution?: "github" | "play";
  appVersionCode?: number;
  update?: {
    state: "upToDate" | "available" | "installing" | "prompted" | "refused" | "failed";
    errorCode?: string;
    detail: string | null;
    checkedAt: string | null;
    latestVersion: string | null;
  };
  batteryPct: number | null;
  charging: boolean | null;
  deviceOwner: boolean;
  /** Every lock policy was applied and no maintenance unlock is running. */
  lockIntact: boolean;
  maintenance: boolean;
  /** Names of the lock steps that failed. */
  failedPolicies: string[];
  /** Lock steps lifted on purpose for a parent-approved window; the lock still counts as intact until `until`. */
  liftedPolicies?: { name: string; until: string }[];
  rulesEtag: string | null;
  webFilterActive?: boolean | null;
  rulesAppliedAt: string | null;
  dnsHost: string | null;
  /** Factory reset protection on the phone (#19); missing on apps before 0.1.4. */
  resetProtection?: "on" | "off" | "no-play-services" | "failed" | null;
  /** Account types on the phone ("com.google"), no names (#21). */
  accountTypes?: string[] | null;
  callRoleActionNeeded?: boolean;
  parallelAppsRemoved?: boolean;
  lateGoogleAccount?: boolean;
  /** The phone's clock was set far from the server's time recently; schedules still follow the server. */
  clockMoved?: boolean;
  /** Missing on older phones, which are strong mode. */
  mode?: "strong" | "light";
  /** What is active on the phone right now. */
  protections?: Partial<Record<Protection, boolean>>;
  /** Minutes used today per limited package; "*" is the total. */
  timeUsed?: Record<string, number>;
  /** The last app update window in strong mode (docs/policies.md, "App updates"). */
  appUpdates?: import("@plainphone/shared/app-updates").AppUpdateWindow;
  /** When the server received the report. */
  reportedAt: string;
}
export const PROTECTIONS = [
  "deviceAdmin",
  "accessibility",
  "usageAccess",
  "usageAccessGranted",
  "vpn",
  "alwaysOnVpn",
  "phoneRole",
  "smsRole",
  "notifications",
  "batteryUnrestricted",
  "privateDnsOk",
  "deviceOwner",
] as const;
export type Protection = (typeof PROTECTIONS)[number];
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
  setupQrAvailable?: boolean;
  setupEnrollmentId?: string | null;
  allowServerMove?: boolean;
  awaitingServerMove?: boolean;
  /** Set while the parents have released the phone and it has not switched Plainphone off yet. */
  releaseRequestedAt: string | null;
  supportEnabled?: boolean;
  releaseWarningsEnabled?: boolean;
  /** The phone may ask for more time, and warns shortly before a limit. Missing on old servers: both count as on. */
  askMoreTimeEnabled?: boolean;
  limitWarningEnabled?: boolean;
  releaseSyncCount?: number;
  androidVersion?: string | null;
  lastSeenAt: string | null;
  /** Only on a single phone: whether it has confirmed the rules the server holds now. Null while it has confirmed none. */
  rulesCurrent?: boolean | null;
  /** The phone's own filter host; null until the DNS service confirmed it (`dnsReady`). */
  dnsHost: string | null;
  dnsSynced: boolean;
  dnsConfigured?: boolean;
  /** The DNS service confirmed the ClientID with its current settings: gates showing the address. */
  dnsReady: boolean;
  /** The phone is filtered by its own host. "Being set up" texts follow this, not `dnsReady`. Missing on old servers. */
  rulesDnsReady?: boolean;
  hasLocation: boolean;
  /** Hardware attestation of the boot state (#23); null until the phone attested once. Missing on old servers. */
  attestation?: PhoneAttestation | null;
  /** Null until the phone has reported once. */
  status: PhoneStatus | null;
  /** Open requests from the phone (apps, contacts). */
  openRequests: number;
  /** Open requests for more time. Missing on old servers. */
  openMoreTimeRequests?: number;
  /** Hours of silence before parents are told; null = the server default. */
  offlineAlertHours: number | null;
  offlineAlertHoursDefault: number;
  changeReceiptsEnabled?: boolean;
  healthBoardEnabled?: boolean;
  weeklySummaryEnabled?: boolean;
  /** Age presets, the review reminder and the family agreement (Child phones). Missing on old servers. */
  agePreset?: AgePresetId | null;
  reviewEnabled?: boolean;
  reviewIntervalMonths?: number;
  reviewDueAt?: string | null;
  reviewDue?: boolean;
  agreementEnabled?: boolean;
  agreementOnHome?: boolean;
  agreementHasText?: boolean;
  /** Bedtime is silent except parents, 112 and help lines. Missing on old servers (treated as on). */
  silentBedtime?: boolean;
  /** Modes on one weekly plan (docs/modes.md). Child phones only; missing on old servers: off. */
  modesEnabled?: boolean;
  /** A parent may approve a request on the phone with the parent PIN. Missing on old servers (treated as on). */
  pinApprovalEnabled?: boolean;
  /** Strong mode: the nightly app update window. Missing on old servers (treated as on). */
  appUpdatesEnabled?: boolean;
  appUpdatesRequestedAt?: string | null;
  /** iPhone support (docs/ios/architecture.md). Missing on old servers: an Android phone. */
  platform?: import("@plainphone/shared/platform").Platform;
  tier?: "strong" | "light" | "family_controls" | "supervised";
  capabilities?: Partial<Record<string, import("@plainphone/shared/platform").Support>>;
  ruleReceipt?: import("@plainphone/shared/phone-health").RuleReceipt | null;
}

export interface PushSubscriptionInfo {
  id: string;
  platform: "web" | "apns" | "fcm";
  label: string | null;
  /** SHA-256 (hex) of the endpoint, so this browser can find its own row. */
  endpointHash: string;
  createdAt: string;
  lastSuccessAt: string | null;
}

export interface NotificationSettings {
  webPushEnabled: boolean;
  webPushPublicKey: string | null;
  offlineAlertHours: number;
  subscriptions: PushSubscriptionInfo[];
  mutedPhoneIds: string[];
}

export interface PhoneRequest {
  id: string;
  phoneId: string;
  kind: "app" | "contact";
  packageName: string | null;
  appLabel: string | null;
  name: string | null;
  number: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt?: string | null;
  /** Where the answer came from: a parent in the app, or on the phone itself with the parent PIN. */
  decidedVia?: "parent" | "phone" | null;
}
export interface PhoneAttestation {
  state: "verified" | "unlocked" | "custom-os" | "failed-boot" | "unverifiable" | "revoked";
  deviceLocked: boolean | null;
  osPatchLevel: number | null;
  checkedAt: string | null;
  lastFailedAt?: string;
}
export interface App {
  packageName: string;
  label: string;
  allowed: boolean;
  /** Open mode: on the block list, one by one or with a category. */
  blocked?: boolean;
  /** Set when only a blocked category blocks the app. */
  blockedBy?: OpenCategory;
  core: boolean;
}
export interface OpenModeState {
  enabled: boolean;
  categories: { category: OpenCategory; blocked: boolean; hasApps: boolean }[];
  blockedApps: { packageName: string; label: string }[];
}
export interface Bonus {
  packageName: string;
  date: string;
  minutes: number;
}
export interface TimeLimits {
  total: Limit | null;
  apps: { packageName: string; label: string; limit: Limit }[];
  bonuses: Bonus[];
  used: Record<string, number> | null;
}
export type CatalogState = "installed-allowed" | "installed-hidden" | "requested" | "none";
export interface CatalogApp {
  packageName: string;
  name: string;
  category: string;
  source: string;
  state: CatalogState;
}
export interface PhoneCatalog {
  country: string | null;
  categories: { id: string; name: { en: string; da: string } }[];
  apps: CatalogApp[];
}
export type ContactGroup = "family" | "friends" | "others";
export const CONTACT_GROUPS: ContactGroup[] = ["family", "friends", "others"];
export interface Contact {
  sosParent?: boolean;
  /** Missing on old servers: treated as others. */
  group?: ContactGroup;
  id: string;
  name: string;
  number: string;
}
export interface DnsState {
  filterMethod?: FilterMethod;
  host: string | null;
  /** The phone is filtered already; the address may still be missing. Missing on old servers. */
  rulesReady?: boolean;
  synced: boolean;
  blockedCategories: DnsCategory[];
  allowDomains: string[];
  blockDomains: string[];
}
export interface Schedule extends ScheduleInput {
  id: string;
}
export type ModePreset = "school" | "homework" | "free" | "night" | "custom";
export const MODE_PRESETS: ModePreset[] = ["school", "homework", "free", "night", "custom"];
export interface Mode {
  id: string;
  preset: ModePreset;
  /** Null: the preset's translated name. */
  name: string | null;
  allApps: boolean;
  allowedPackages: string[];
  contactGroups: ContactGroup[];
  quiet: boolean;
  isDefault: boolean;
}
export interface ModeInput {
  preset: ModePreset;
  name?: string | null;
  allApps: boolean;
  allowedPackages: string[];
  contactGroups: ContactGroup[];
  quiet: boolean;
}
export interface ModeSlotInput {
  modeId: string;
  days: number[];
  startMinute: number;
  endMinute: number;
}
export interface ModeSlot extends ModeSlotInput {
  id: string;
}
export interface ModesState {
  enabled: boolean;
  /** False: no contact is marked as a parent, so contact groups do not narrow the list. */
  parentsMarked: boolean;
  timezone: string;
  modes: Mode[];
  slots: ModeSlot[];
  /** Null while modes are off. `until` is HH:MM local time, null for the default mode. */
  current: { modeId: string; until: string | null } | null;
}
/** When the phone sends its position (docs/location.md). */
export type LocationMode = "off" | "find" | "checkin" | "always";
export const LOCATION_MODES: LocationMode[] = ["off", "find", "checkin", "always"];
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
export const ALWAYS_FOR = ["hour", "today", "week"] as const;
export type AlwaysFor = (typeof ALWAYS_FOR)[number];
export interface LocationState {
  enabled: boolean;
  mode: LocationMode;
  /** End of "always" (it falls back to "checkin" by itself); null in other modes. */
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
  /** Paid early unlock (docs/billing.md). Only while billing is on; absent means show nothing. */
  earlyUnlock?: EarlyUnlockOffer;
}
export type ChangeResult = { status: "applied" } | { status: "pending"; change: PendingChange };

export interface Approval {
  id: string;
  phoneId: string;
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
/** `GET /households/{hid}/reset-protection` (#20). Account IDs never reach the browser. */
export interface ResetProtectionState {
  available: boolean;
  accounts: { mine: boolean; userId: string; addedAt: string; activeFrom: string }[];
}
export interface InviteResult {
  id: string;
  email: string;
  expiresAt: string;
  mailed: boolean;
  url?: string;
}

export { ApiError, type Issue } from "@plainphone/api-client";

/** Called when any request comes back 401, so the app can show the login page. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

const client = createClient({ baseUrl: "/api", credentials: "same-origin", onUnauthorized: () => onUnauthorized?.() });

/** Any path. Only for a route server/openapi.yaml does not describe; everything else uses `api`. */
export const request = client.request;

/** Each method takes only the paths server/openapi.yaml describes for it (@plainphone/api-client). */
export const api = client.api;

export const acknowledgeSos = <T>(pid: string, id: string, name: string) =>
  api.post<T>(`/phones/${pid}/sos/${id}/seen`, { name: name.trim() || undefined });

export const getPhoneSettings = (pid: string) =>
  api.get<{ settings: PhoneSettings }>(`/phones/${pid}/settings`).then((r) => r.settings);
/** A loosening change on a Self phone answers `pending`; everything else is `applied` at once. */
export const putPhoneSetting = (pid: string, key: SettingKey, setting: PhoneSetting) =>
  api.put<ChangeResult>(`/phones/${pid}/settings/${key}`, setting);
export const getHome = (pid: string) => api.get<Home & { showFreePromise?: boolean }>(`/phones/${pid}/home`);
export const setHomeFreePromise = (pid: string, showFreePromise: boolean) =>
  api.patch<ChangeResult>(`/phones/${pid}/home`, { showFreePromise });
/** Never waits for the key. Send the whole object. */
export const putHome = (pid: string, home: Home) => api.put<ChangeResult>(`/phones/${pid}/home`, home);

export const getAgePresets = () => api.get<{ presets: AgePreset[] }>("/age-presets").then((r) => r.presets);
export const getAgeState = (pid: string) => api.get<AgeState>(`/phones/${pid}/age`);
export const applyAgePreset = (pid: string, preset: AgePresetId) => api.post<AgeState>(`/phones/${pid}/age-preset`, { preset });
export const putReview = (pid: string, review: { enabled?: boolean; intervalMonths?: number; dueDate?: string }) =>
  api.put<AgeState>(`/phones/${pid}/review`, review);
export const markReviewed = (pid: string) => api.post<AgeState>(`/phones/${pid}/review/done`, {});
export const getAgreement = (pid: string) => api.get<Agreement>(`/phones/${pid}/agreement`);
export const putAgreement = (pid: string, agreement: Partial<Pick<Agreement, "lines" | "adultLines" | "enabled" | "onHome">>) =>
  api.put<Agreement>(`/phones/${pid}/agreement`, agreement);
export const getModes = (pid: string) => api.get<ModesState>(`/phones/${pid}/modes`);
export const setModesEnabled = (pid: string, modesEnabled: boolean) => api.patch<Phone>(`/phones/${pid}`, { modesEnabled });
export const createMode = (pid: string, input: ModeInput) => api.post<Mode>(`/phones/${pid}/modes`, input);
/** The default mode takes only `name` (null clears it back to the preset name). */
export const updateMode = (pid: string, mid: string, input: ModeInput | { name: string | null }) =>
  api.put<Mode>(`/phones/${pid}/modes/${mid}`, input);
export const deleteMode = (pid: string, mid: string) => api.del<void>(`/phones/${pid}/modes/${mid}`);
/** Replaces the whole weekly plan. 400 `overlap` when two slots share a minute. */
export const putModeSchedule = (pid: string, slots: ModeSlotInput[]) =>
  api.put<{ slots: ModeSlot[] }>(`/phones/${pid}/mode-schedule`, { slots });
export const setContactGroup = (pid: string, cid: string, group: ContactGroup) =>
  api.patch<Contact>(`/phones/${pid}/contacts/${cid}`, { group });

/** Mail is configured on this server. Works without a session via /api/health. */
export async function serverHasMail(): Promise<boolean | null> {
  try {
    const res = await fetch("/api/health", { credentials: "same-origin" });
    const j = (await res.json()) as { mail?: string };
    return j.mail ? j.mail !== "none" : null;
  } catch {
    return null;
  }
}
