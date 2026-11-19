// SPDX-License-Identifier: Apache-2.0
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  foreignKey,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ProvisioningInfo } from "../lib/provisioning.js";
import type { Home, StoredSettings } from "../lib/phone-settings.js";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  locale: text("locale").notNull().default("en"),
  createdAt: createdAt(),
});

/** One-time login links. Only the SHA-256 of the token is stored. */
export const magicLinks = pgTable(
  "magic_links",
  {
    id: id(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("magic_links_expires_idx").on(t.expiresAt)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const households = pgTable("households", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

/** Parents (and adults with a Self profile) who manage the household's phones. */
export const householdMembers = pgTable(
  "household_members",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "parent"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.userId] })],
);

export const householdInvites = pgTable("household_invites", {
  id: id(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  trustedPhoneId: uuid("trusted_phone_id").references((): AnyPgColumn => phones.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const UPDATE_ERROR_CODES = [
  "battery_exemption_missing",
  "network",
  "signature_mismatch",
  "version_not_newer",
  "metadata_mismatch",
  "install_failed",
  "unknown",
] as const;

export type StatusNotice = { id?: string; receivedAt: string };

/** What the phone reports about itself and its lock (`PUT /device/status`). */
export const FILTER_METHODS = ["vpn", "privateDns"] as const;
export const PRIVATE_DNS_ISSUES = ["off", "automatic", "wrongHost", "waiting", "unverified", "alwaysOn", "strictDns"] as const;
export type FilterMethod = (typeof FILTER_METHODS)[number];

export interface DeviceStatus {
  pushProvider?: "none" | "fcm" | "unifiedpush";
  filterMethod?: FilterMethod;
  filterWorking?: boolean;
  filterIssue?: (typeof PRIVATE_DNS_ISSUES)[number];
  /** Server-side alert state, preserved across inconclusive reports for the same method. */
  lastConfirmedFilterWorking?: boolean;
  lockIntactWithoutFilter?: boolean;
  appVersion: string;
  androidVersion?: string;
  appVersionCode?: number;
  update?: {
    state: "upToDate" | "available" | "installing" | "prompted" | "refused" | "failed";
    errorCode?: (typeof UPDATE_ERROR_CODES)[number];
    detail: string | null;
    checkedAt: string | null;
    latestVersion: string | null;
  };
  batteryPct: number | null;
  charging: boolean | null;
  deviceOwner: boolean;
  /** Every lock policy was applied and no maintenance unlock is running. */
  lockIntact: boolean;
  /** A PIN maintenance unlock is running on the phone. */
  maintenance: boolean;
  /** Names of the lock steps that failed. */
  failedPolicies: string[];
  /** ETag of the rules the phone last applied. */
  rulesEtag: string | null;
  rulesAppliedAt: string | null;
  /** The private DNS host the phone actually uses. */
  dnsHost: string | null;
  /** Factory reset protection on the phone: on, off, no-play-services or failed (#19). Missing on old apps. */
  resetProtection?: "on" | "off" | "no-play-services" | "failed" | null;
  /** Account types signed in on the phone ("com.google"), no names (#21). */
  accountTypes?: string[] | null;
  callRoleActionNeeded?: boolean;
  parallelAppsRemoved?: boolean;
  /** Missing on phones that predate light mode: strong. */
  mode?: "strong" | "light";
  /** What is active on the phone right now (light mode reports all of them). */
  protections?: Partial<Record<Protection, boolean>>;
  /** Minutes used today per limited package; "*" is the total. */
  timeUsed?: Record<string, number>;
}

/** What the server read from the phone's key attestation (#23). No serial number or IMEI. */
export interface PhoneAttestation {
  state: "verified" | "unlocked" | "custom-os" | "failed-boot" | "unverifiable" | "revoked";
  securityLevel: "software" | "tee" | "strongbox" | null;
  deviceLocked: boolean | null;
  verifiedBootState: "verified" | "self-signed" | "unverified" | "failed" | null;
  osPatchLevel: number | null;
  revocationChecked: boolean;
  lastFailedAt?: string;
}

/** The protections a phone can report in `PUT /device/status`. */
export const PROTECTIONS = [
  "deviceOwner",
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
] as const;
export type Protection = (typeof PROTECTIONS)[number];

/**
 * When a phone sends its position:
 * - `off`: never,
 * - `find`: only when a parent presses Find,
 * - `checkin`: on Find, and once when an "Are you okay?" goes unanswered (the default for a child),
 * - `always`: every 5 minutes, plus the above. The phone shows this all the time.
 */
export const LOCATION_MODES = ["off", "find", "checkin", "always"] as const;
export type LocationMode = (typeof LOCATION_MODES)[number];

export const phones = pgTable(
  "phones",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    profile: text("profile", { enum: ["child", "self"] }).notNull(),
    /** Null preserves the always-on contact restriction on previously paired Strong Self phones. */
    suggestDeviceContacts: boolean("suggest_device_contacts").notNull().default(false),
    allowServerMove: boolean("allow_server_move"),
    awaitingServerMove: boolean("awaiting_server_move").notNull().default(false),
    lightContactRestriction: boolean("light_contact_restriction").notNull().default(true),
    selfScheduleContacts: boolean("self_schedule_contacts").default(false),
    mode: text("mode", { enum: ["strong", "light"] }).notNull().default("strong"),
    language: text("language", { enum: ["da", "en", "sv", "nb", "de"] }),
    lockSystemLanguage: boolean("lock_system_language").notNull().default(true),
    filterMethod: text("filter_method", { enum: FILTER_METHODS }).notNull().default("vpn"),
    /** Open mode (docs/open-mode.md): all apps allowed except the block list. */
    openMode: boolean("open_mode").notNull().default(false),
    /** App categories ("social", "gambling") whose known apps are on the block list in open mode. */
    blockedAppCategories: text("blocked_app_categories").array().notNull().default(sql`'{}'::text[]`),
    timezone: text("timezone").notNull().default("Europe/Copenhagen"),
    deviceTokenHash: text("device_token_hash").unique(),
    /** Opaque id used as the DNS-over-TLS ClientID (`<dnsClientId>.dns.plainphone.org`). */
    dnsClientId: text("dns_client_id").notNull().unique(),
    /** True when the DNS service has not yet received the latest DNS rules. */
    dnsDirty: boolean("dns_dirty").notNull().default(true),
    /** Bumped on every sync attempt, so an older attempt cannot clear dnsDirty. */
    dnsVersion: integer("dns_version").notNull().default(0),
    /**
     * Set the first time the DNS service accepted this phone's ClientID, and never cleared.
     * Until then the phone must not switch to its private DNS host: the DNS service answers
     * REFUSED for ClientIDs it does not know, so the phone would lose DNS entirely.
     */
    dnsConfirmedAt: timestamp("dns_confirmed_at", { withTimezone: true }),
    dnsConfirmedProvider: text("dns_confirmed_provider"),
    /** Kept equal to `locationMode !== "off"`, for phones and clients that only know the boolean. */
    locationEnabled: boolean("location_enabled").notNull(),
    updateRequestedAt: timestamp("update_requested_at", { withTimezone: true }),
    /** When the phone sends its position (docs/location.md). */
    locationMode: text("location_mode", { enum: LOCATION_MODES }).notNull().default("off"),
    /** "always" is time-boxed: after this the phone falls back to "checkin" (sweeper). */
    locationAlwaysUntil: timestamp("location_always_until", { withTimezone: true }),
    locateRequestedAt: timestamp("locate_requested_at", { withTimezone: true }),
    fcmToken: text("fcm_token"),
    fcmValidationKey: text("fcm_validation_key"),
    unifiedPushEndpoint: text("unified_push_endpoint"),
    pushWakeups: boolean("push_wakeups").notNull().default(false),
    preferUnifiedPush: boolean("prefer_unified_push").notNull().default(false),
    deviceInfo: jsonb("device_info").$type<Record<string, string>>(),
    pairedAt: timestamp("paired_at", { withTimezone: true }),
    setupUndoMinutes: integer("setup_undo_minutes"),
    setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
    /**
     * Set when the parents asked to release the phone: it switches Plainphone off on its own
     * and then calls `POST /device/released`, which deletes this row. Until then the rules
     * document carries `release: true`.
     */
    releaseRequestedAt: timestamp("release_requested_at", { withTimezone: true }),
    releaseSyncCount: integer("release_sync_count").notNull().default(0),
    supportEnabled: boolean("support_enabled").notNull().default(true),
    releaseWarningsEnabled: boolean("release_warnings_enabled").notNull().default(true),
    sosCallbackNumber: text("sos_callback_number"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    /** The phone's own report from `PUT /device/status`; null until it has reported once. */
    deviceStatus: jsonb("device_status").$type<DeviceStatus & {
      parallelAppsRemovedNotice?: StatusNotice;
      lateGoogleAccountNotice?: StatusNotice;
      installOverrun?: { policy: string; sequence?: number; receivedAt: string };
    }>(),
    /** Server time of that report. */
    statusReportedAt: timestamp("status_reported_at", { withTimezone: true }),
    /** The last hardware attestation result (#23); null until the phone attested once. */
    attestation: jsonb("attestation").$type<PhoneAttestation>(),
    attestedAt: timestamp("attested_at", { withTimezone: true }),
    /** When the parents were told the phone is offline; cleared when it is seen again. */
    offlineAlertedAt: timestamp("offline_alerted_at", { withTimezone: true }),
    /** Hours of silence before the parents are told; null = the server default, 0 = never. */
    offlineAlertHours: integer("offline_alert_hours"),
    createdAt: createdAt(),
  },
  (t) => [index("phones_household_idx").on(t.householdId)],
);

/**
 * A pairing started by the phone. The phone shows `code`; a parent claims it.
 * The phone polls with `pollSecret` and receives its device token once.
 */
export const pairings = pgTable("pairings", {
  id: id(),
  codeHash: text("code_hash").notNull().unique(),
  pollSecretHash: text("poll_secret_hash").notNull(),
  mode: text("mode", { enum: ["strong", "light"] }).notNull(),
  deviceInfo: jsonb("device_info").$type<Record<string, string>>(),
  phoneId: uuid("phone_id").references(() => phones.id, { onDelete: "cascade" }),
  profileHint: text("profile_hint", { enum: ["child", "self"] }),
  requiresConfirmation: boolean("requires_confirmation").notNull().default(false),
  claimedBy: uuid("claimed_by").references(() => users.id, { onDelete: "set null" }),
  /** Device token available for delivery or recovery until the first sync. */
  pendingDeviceToken: text("pending_device_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Apps the phone reports as installed, and whether they may be shown. */
export const phoneApps = pgTable(
  "phone_apps",
  {
    phoneId: uuid("phone_id")
      .notNull()
      .references(() => phones.id, { onDelete: "cascade" }),
    packageName: text("package_name").notNull(),
    label: text("label").notNull(),
    allowed: boolean("allowed").notNull(),
    /** Explicit block, distinct from the default for newly reported apps. */
    explicitlyBlocked: boolean("explicitly_blocked").notNull().default(false),
    /** Reported by the phone: dialer, messages, settings, launcher... Never hidden. */
    core: boolean("core").notNull().default(false),
    installed: boolean("installed").notNull().default(true),
    /** The parent picked it from the app catalog; the phone offers to install it. */
    requested: boolean("requested").notNull().default(false),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.phoneId, t.packageName] })],
);

/** Weekday overrides of a limit: ISO weekday ("1" = Monday) to minutes. */
export type LimitDays = Partial<Record<"1" | "2" | "3" | "4" | "5" | "6" | "7", number>>;

/** Daily time limits. packageName "*" is the cap for all non-core apps together. */
export const timeLimits = pgTable(
  "time_limits",
  {
    phoneId: uuid("phone_id")
      .notNull()
      .references(() => phones.id, { onDelete: "cascade" }),
    packageName: text("package_name").notNull(),
    minutes: integer("minutes").notNull(),
    days: jsonb("days").$type<LimitDays>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.phoneId, t.packageName] })],
);

/** Extra minutes for one local date (the phone's time zone). packageName "*" is the total cap. */
export const timeBonuses = pgTable(
  "time_bonuses",
  {
    id: id(),
    phoneId: uuid("phone_id")
      .notNull()
      .references(() => phones.id, { onDelete: "cascade" }),
    packageName: text("package_name").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    minutes: integer("minutes").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("time_bonuses_phone_day_idx").on(t.phoneId, t.day)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    phoneId: uuid("phone_id")
      .notNull()
      .references(() => phones.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** E.164, e.g. +4512345678. */
    number: text("number").notNull(),
    sosParent: boolean("sos_parent").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("contacts_phone_number_uq").on(t.phoneId, t.number)],
);

// A cleared name remembers a reviewed number without retaining the address book label.
export const contactSuggestions = pgTable(
  "contact_suggestions",
  {
    id: id(),
    groupId: uuid("group_id").notNull(),
    phoneId: uuid("phone_id").notNull().references(() => phones.id, { onDelete: "cascade" }),
    name: text("name"),
    number: text("number").notNull(),
  },
  (t) => [
    uniqueIndex("contact_suggestions_phone_number_uq").on(t.phoneId, t.number),
    index("contact_suggestions_phone_group_idx").on(t.phoneId, t.groupId),
  ],
);

export const DNS_CATEGORIES = ["social", "adult", "gambling", "games", "dating", "video"] as const;
export type DnsCategory = (typeof DNS_CATEGORIES)[number];

export const dnsSettings = pgTable("dns_settings", {
  phoneId: uuid("phone_id")
    .primaryKey()
    .references(() => phones.id, { onDelete: "cascade" }),
  /** Categories that are blocked. */
  blockedCategories: text("blocked_categories").array().notNull(),
  allowDomains: text("allow_domains").array().notNull().default(sql`'{}'::text[]`),
  blockDomains: text("block_domains").array().notNull().default(sql`'{}'::text[]`),
});

/** School time and bedtime windows, in the phone's local time. */
export const schedules = pgTable(
  "schedules",
  {
    id: id(),
    phoneId: uuid("phone_id")
      .notNull()
      .references(() => phones.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["school", "bedtime"] }).notNull(),
    /** ISO weekdays, 1 = Monday ... 7 = Sunday. */
    days: smallint("days").array().notNull(),
    /** Minutes after local midnight. A window may cross midnight (end < start). */
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    /** Apps that stay usable during the window, besides phone and messages. */
    allowedPackages: text("allowed_packages").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [index("schedules_phone_idx").on(t.phoneId)],
);

/**
 * What the parent set for the phone's own settings, and how the home screen looks
 * (docs/phone-settings.md). `settings` only holds settings that are not free.
 */
export const phoneSettings = pgTable("phone_settings", {
  phoneId: uuid("phone_id")
    .primaryKey()
    .references(() => phones.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<StoredSettings>().notNull().default({}),
  /** The home screen choices. May be empty: the defaults are filled in when read. */
  home: jsonb("home").$type<Partial<Home>>().notNull().default({}),
});

/** Only the latest known position per phone (decision D7). No history. */
export const locations = pgTable("locations", {
  phoneId: uuid("phone_id")
    .primaryKey()
    .references(() => phones.id, { onDelete: "cascade" }),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  accuracyM: doublePrecision("accuracy_m"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * "Ring the phone" and "Are you okay?". Only the latest request of each kind per phone is kept:
 * a new one replaces the old, and the sweeper deletes finished ones after a day.
 */
export const safetyRequests = pgTable(
  "safety_requests",
  {
    id: id(),
    phoneId: uuid("phone_id")
      .notNull()
      .references(() => phones.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["ring", "checkin"] }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Ring: when the sound stops at the latest. Check-in: the reply deadline. */
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** Ring: stop when the child taps "I'm here". False keeps it ringing until `endsAt`. */
    stopOnAnswer: boolean("stop_on_answer").notNull().default(true),
    /** Check-in: an approved contact the child can call back from the screen. */
    callNumber: text("call_number"),
    /** The phone showed the request. */
    shownAt: timestamp("shown_at", { withTimezone: true }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    answer: text("answer", { enum: ["here", "ok", "call"] }),
    /** The parent stopped or cancelled it. */
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    /** Check-in: hold the fix privately while an answer can still arrive. */
    pendingLocation: jsonb("pending_location").$type<{
      lat: number; lon: number; accuracyM: number | null; recordedAt: string; receivedAt: string;
    }>(),
    /** Check-in: the position sent because nobody answered. */
    locatedAt: timestamp("located_at", { withTimezone: true }),
    /** Check-in: the parents were told nobody answered by the deadline. */
    noReplyNotifiedAt: timestamp("no_reply_notified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("safety_requests_phone_kind_idx").on(t.phoneId, t.kind)],
);

/** The key that guards loosening changes on a Self-profile phone (D12, D13). */
export const selfKeys = pgTable("self_keys", {
  phoneId: uuid("phone_id")
    .primaryKey()
    .references(() => phones.id, { onDelete: "cascade" }),
  keyType: text("key_type", { enum: ["delay", "trusted"] }).notNull().default("delay"),
  delayHours: integer("delay_hours").notNull().default(24),
  trustedUserId: uuid("trusted_user_id").references(() => users.id, { onDelete: "set null" }),
  /** Pending invite for a trusted person who has no account yet. */
  trustedEmail: text("trusted_email"),
  payUnlockEnabled: boolean("pay_unlock_enabled").notNull().default(false),
  /** Minor units (øre/cents). Default 500 kr. */
  payUnlockAmount: integer("pay_unlock_amount").notNull().default(50000),
  payUnlockCurrency: text("pay_unlock_currency").notNull().default("DKK"),
  payUnlockRecipient: text("pay_unlock_recipient").notNull().default("plainphone"),
});

export type ChangeStatus = "pending" | "applied" | "cancelled" | "rejected" | "failed";

/** A loosening change on a Self-profile phone that waits for the key. */
export const pendingChanges = pgTable(
  "pending_changes",
  {
    id: id(),
    phoneId: uuid("phone_id")
      .notNull()
      .references(() => phones.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    op: jsonb("op").notNull(),
    keyType: text("key_type", { enum: ["delay", "trusted"] }).notNull(),
    status: text("status", { enum: ["pending", "applied", "cancelled", "rejected", "failed"] })
      .notNull()
      .default("pending"),
    /** For the delay key: when the change takes effect. Null for the trusted-person key. */
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    approvalChallengeHash: text("approval_challenge_hash"),
    approvalFingerprintKey: uuid("approval_fingerprint_key").defaultRandom().notNull(),
    awaitingQrHelper: boolean("awaiting_qr_helper").notNull().default(false),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("pending_changes_phone_status_idx").on(t.phoneId, t.status),
    index("pending_changes_due_idx").on(t.status, t.keyType, t.effectiveAt),
  ],
);

/**
 * Pay-to-unlock attempts (D13). Data model only: no payment provider is wired up yet,
 * and the API refuses to create rows unless payments are enabled.
 */
export const unlockPayments = pgTable("unlock_payments", {
  id: id(),
  pendingChangeId: uuid("pending_change_id")
    .notNull()
    .references(() => pendingChanges.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  recipient: text("recipient").notNull(),
  provider: text("provider").notNull(),
  providerRef: text("provider_ref"),
  status: text("status", { enum: ["created", "succeeded", "failed", "refunded"] }).notNull(),
  createdAt: createdAt(),
});

/**
 * ClientIDs the DNS service must forget. A row is written in the same transaction that
 * deletes a phone, so the sweeper can retry the delete until the DNS service confirms it
 * (204 or 404). Holds no personal data: only the random ClientID.
 */
export const dnsDeletions = pgTable("dns_deletions", {
  clientId: text("client_id").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * Where to send notifications for a parent: one row per browser (Web Push) or, later,
 * per native app install (APNs/FCM device token). Push messages are end-to-end encrypted
 * for Web Push; the push service (Google, Apple, Mozilla) only sees the endpoint.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    installationHash: text("installation_hash").unique(),
    state: text("state", { enum: ["active", "gone", "revoked"] }).notNull().default("active"),
    platform: text("platform", { enum: ["web", "apns", "fcm"] }).notNull(),
    /** Web Push: the push service URL. APNs/FCM: the device token. */
    endpoint: text("endpoint").notNull().unique(),
    /** Web Push only: the browser's public key and auth secret (base64url). */
    p256dh: text("p256dh"),
    auth: text("auth"),
    /** A short label the app shows, such as "Chrome on Android". Not used for anything else. */
    label: text("label"),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    failures: integer("failures").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("push_subscriptions_user_idx").on(t.userId),
    index("push_subscriptions_session_idx").on(t.sessionId),
  ],
);

// A deleted phone must no longer be needed to deliver its final notice.
export const setupUndoNotices = pgTable("setup_undo_notices", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  phoneId: uuid("phone_id").notNull(),
  phoneName: text("phone_name").notNull(),
  reportedLate: boolean("reported_late").notNull().default(false),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").references(() => pushSubscriptions.id, { onDelete: "cascade" }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
}, (t) => [index("setup_undo_notices_due_idx").on(t.nextAttemptAt)]);

/** Phones a parent does not want notifications about. Absent means on. */
export const notificationMutes = pgTable(
  "notification_mutes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    phoneId: uuid("phone_id")
      .notNull()
      .references(() => phones.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.phoneId] })],
);

/** Something the person with the phone asks for: an app from its list, or a contact. */
export const phoneRequests = pgTable(
  "phone_requests",
  {
    id: id(),
    phoneId: uuid("phone_id")
      .notNull()
      .references(() => phones.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["app", "contact"] }).notNull(),
    packageName: text("package_name"),
    contactName: text("contact_name"),
    /** E.164. */
    contactNumber: text("contact_number"),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    /** On a Self phone an approval becomes a change that waits for the key. */
    changeId: uuid("change_id").references(() => pendingChanges.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("phone_requests_phone_status_idx").on(t.phoneId, t.status)],
);

/**
 * One-time enrollment token in a provisioning QR code made in the dashboard. The phone sends it
 * after setup and is paired with [phoneId] without a code. Only the SHA-256 of the token is stored.
 */
export const enrollments = pgTable(
  "enrollments",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    phoneId: uuid("phone_id")
      .notNull()
      .references(() => phones.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    provisioning: jsonb("provisioning").$type<ProvisioningInfo>(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    /** SHA-256 of the phone's install id, so a lost answer can be retried by the same phone. */
    installIdHash: text("install_id_hash"),
    createdAt: createdAt(),
  },
  (t) => [index("enrollments_phone_idx").on(t.phoneId)],
);

/**
 * A parent's Google account for factory reset protection (#20), one per member and household.
 * Only the numeric account ID (Google People API) is stored, no email address.
 */
export const frpAccounts = pgTable(
  "frp_accounts",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    googleAccountId: text("google_account_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.userId] })],
);

/** Short-lived rule snapshots, deliberately without a source or recipient identifier. */
export const selfRuleTemplates = pgTable("self_rule_templates", {
  tokenHash: text("token_hash").primaryKey(),
  rules: jsonb("rules").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const sosEvents = pgTable("sos_events", {
  phoneId: uuid("phone_id").notNull().references(() => phones.id, { onDelete: "cascade" }),
  id: uuid("id").notNull(),
  kind: text("kind", { enum: ["urgent", "help"] }).notNull(),
  createdAt: createdAt(),
  lat: doublePrecision("lat"),
  lon: doublePrecision("lon"),
  battery: smallint("battery"),
  deliveredVia: text("delivered_via", { enum: ["push", "sms"] }),
  seenBy: uuid("seen_by").references(() => users.id, { onDelete: "set null" }),
  seenByName: text("seen_by_name"),
  seenAt: timestamp("seen_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  notificationClaimedAt: timestamp("notification_claimed_at", { withTimezone: true }),
  notificationLeaseUntil: timestamp("notification_lease_until", { withTimezone: true }),
  /** Set when delivery to every parent was still incomplete at the final timeout. */
  deliveryFailedAt: timestamp("delivery_failed_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.phoneId, t.id] }),
  index("sos_phone_created_idx").on(t.phoneId, t.createdAt),
  index("sos_created_idx").on(t.createdAt),
]);

/** What each parent has been sent for one SOS, so a retry only repeats what failed. */
export const sosDeliveries = pgTable("sos_deliveries", {
  phoneId: uuid("phone_id").notNull(),
  eventId: uuid("event_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pushedAt: timestamp("pushed_at", { withTimezone: true }),
  mailedAt: timestamp("mailed_at", { withTimezone: true }),
  /** Reached, or nothing could reach them (no push registration and no mail): no more retries. */
  doneAt: timestamp("done_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.phoneId, t.eventId, t.userId] }),
  foreignKey({ columns: [t.phoneId, t.eventId], foreignColumns: [sosEvents.phoneId, sosEvents.id] }).onDelete("cascade"),
]);
/** Transfer signing identity. The private key stays on the server. */
export const moveIdentity = pgTable("move_identity", {
  id: integer("id").primaryKey(),
  privateKey: text("private_key").notNull(),
});

export const moveImports = pgTable("move_imports", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url").notNull(),
  sourceKey: text("source_key").notNull(),
  privateKey: text("private_key"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }),
});

export const phoneMoves = pgTable("phone_moves", {
  id: id(),
  phoneId: uuid("phone_id").notNull().references(() => phones.id, { onDelete: "cascade" }),
  direction: text("direction", { enum: ["incoming", "outgoing"] }).notNull(),
  transferId: uuid("transfer_id").notNull(),
  serverUrl: text("server_url").notNull(),
  token: text("token"),
  tokenHash: text("token_hash").unique(),
  policyHash: text("policy_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  active: boolean("active").notNull().default(false),
}, (t) => [index("phone_moves_phone_idx").on(t.phoneId)]);
