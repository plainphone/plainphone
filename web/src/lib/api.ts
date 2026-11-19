// SPDX-License-Identifier: Apache-2.0
//
// Thin client for the parent API. The session lives in an HttpOnly cookie (path /api),
// so the app never sees or stores a token.

import type { Language, PhoneLanguage } from "./phone-language";

export type Locale = Language;
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
/** What the phone last reported about itself (`PUT /device/status`). */
export interface PhoneStatus {
  appVersion: string;
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
  rulesEtag: string | null;
  rulesAppliedAt: string | null;
  dnsHost: string | null;
  /** Factory reset protection on the phone (#19); missing on apps before 0.1.4. */
  resetProtection?: "on" | "off" | "no-play-services" | "failed" | null;
  /** Account types on the phone ("com.google"), no names (#21). */
  accountTypes?: string[] | null;
  callRoleActionNeeded?: boolean;
  parallelAppsRemoved?: boolean;
  lateGoogleAccount?: boolean;
  /** Missing on older phones, which are strong mode. */
  mode?: "strong" | "light";
  /** What is active on the phone right now. */
  protections?: Partial<Record<Protection, boolean>>;
  /** Minutes used today per limited package; "*" is the total. */
  timeUsed?: Record<string, number>;
  /** When the server received the report. */
  reportedAt: string;
}
export const PROTECTIONS = [
  "deviceAdmin",
  "accessibility",
  "usageAccess",
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
  id: string;
  name: string;
  profile: Profile;
  mode: "strong" | "light";
  timezone: string;
  language?: PhoneLanguage;
  lockSystemLanguage?: boolean;
  locationEnabled: boolean;
  locationMode?: LocationMode;
  pairedAt: string | null;
  setupQrAvailable?: boolean;
  setupEnrollmentId?: string | null;
  /** Set while the parents have released the phone and it has not switched Plainphone off yet. */
  releaseRequestedAt: string | null;
  lastSeenAt: string | null;
  dnsHost: string;
  dnsSynced: boolean;
  /** The DNS service has accepted the phone's ClientID; until then the web filter is not active. */
  dnsConfigured?: boolean;
  dnsReady: boolean;
  hasLocation: boolean;
  /** Hardware attestation of the boot state (#23); null until the phone attested once. Missing on old servers. */
  attestation?: PhoneAttestation | null;
  /** Null until the phone has reported once. */
  status: PhoneStatus | null;
  /** Open requests from the phone (apps, contacts). */
  openRequests: number;
  /** Hours of silence before parents are told; null = the server default. */
  offlineAlertHours: number | null;
  offlineAlertHoursDefault: number;
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
  core: boolean;
}
/** Minutes a day, with optional overrides per ISO weekday ("1" = Monday). */
export interface Limit {
  minutes: number;
  days: Partial<Record<string, number>>;
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
export interface Contact {
  id: string;
  name: string;
  number: string;
}
export interface DnsState {
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
export interface KeyInput {
  qrInvite?: boolean;
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
  | { type: "dns.category"; category: DnsCategory; blocked: boolean }
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
  | { type: "timeLimit.set"; packageName: string; limit: Limit | null }
  | { type: "timeLimit.bonus"; packageName: string; date: string; minutes: number }
  | { type: "catalog.add"; packageName: string; label: string }
  | { type: "catalog.remove"; packageName: string };

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

export interface Issue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: Issue[] = [],
    /** The whole error body, for endpoints that explain more (e.g. selfPhoneIds). */
    readonly data: { selfPhoneIds?: string[] } = {},
  ) {
    super(message);
  }
  /** Field errors keyed by path, e.g. { number: "use international format..." }. */
  fields(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const i of this.issues) out[i.path] ??= i.message;
    return out;
  }
}

/** Called when any request comes back 401, so the app can show the login page. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        // The server refuses writes without this (415), even with an empty body.
        ...(method !== "GET" ? { "content-type": "application/json" } : {}),
      },
      body: method !== "GET" ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const j = (json ?? {}) as { error?: string; issues?: Issue[]; selfPhoneIds?: string[] };
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized?.();
    throw new ApiError(res.status, j.error ?? res.statusText, j.issues ?? [], j);
  }
  if (res.status === 202 || res.status === 200 || res.status === 201) {
    // Change endpoints answer 200 {status:"applied"} or 202 {status:"pending"}.
    return json as T;
  }
  return undefined as T;
}

export const api = {
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b),
  put: <T>(p: string, b?: unknown) => request<T>("PUT", p, b),
  patch: <T>(p: string, b?: unknown) => request<T>("PATCH", p, b),
  del: <T>(p: string, b?: unknown) => request<T>("DELETE", p, b),
};

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
