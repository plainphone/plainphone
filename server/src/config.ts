// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

/** The shortest review sign-in code accepted: guessing one within the rate limits is hopeless. */
export const REVIEW_CODE_MIN = 32;

/** Compose files pass unset variables as "": treat that as unset, so the default applies. */
const unsetIfEmpty = <T extends z.ZodType>(t: T) => z.preprocess((v) => (v === "" ? undefined : v), t);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8080),
  DATABASE_URL: z.string().min(1),
  /** Database connections this server process keeps open at most (docs/operations.md#capacity). */
  DB_POOL_MAX: unsetIfEmpty(z.coerce.number().int().min(1).max(100).default(10)),
  /** Public base URL of the parent app, used in mails, e.g. https://app.plainphone.org */
  PUBLIC_URL: z.url().default("http://localhost:5173"),
  /** Directory with the built parent PWA. Served at / when it exists. */
  WEB_DIST: z.string().optional(),
  /** none | log | smtp. "none" sends nothing; "log" prints mails to stdout (development only). */
  MAIL_PROVIDER: z.enum(["none", "log", "smtp"]).default("none"),
  MAIL_FROM: z.string().default("Plainphone <no-reply@plainphone.org>"),
  SMTP_URL: z.string().optional(),
  /** mock | http. "http" talks to the Plainphone DNS service (dns/). */
  DNS_PROVIDER: z.enum(["mock", "http"]).default("mock"),
  DNS_API_URL: z.string().optional(),
  DNS_API_TOKEN: z.string().optional(),
  /** Hostname suffix for per-phone DNS-over-TLS, e.g. dns.plainphone.org */
  DNS_HOST_SUFFIX: z.string().default("dns.plainphone.org"),
  /** Default wakeup transport policy, subject to each phone's opt-in. */
  PUSH_PROVIDER: unsetIfEmpty(z.enum(["none", "fcm", "unifiedpush"]).default("none")),
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FCM_SERVICE_ACCOUNT_FILE: z.string().optional(),
  APNS_KEY_P8: z.string().optional(),
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_BUNDLE_ID: unsetIfEmpty(z.string().optional()),
  APNS_SANDBOX: unsetIfEmpty(z.enum(["true", "false"]).default("false")),
  /**
   * Native parent apps that may open this server's links (universal links / app links),
   * served at /.well-known/apple-app-site-association and /.well-known/assetlinks.json.
   * Self-hosters with their own app builds put their own ids here.
   */
  APPLE_APP_IDS: z.string().default("P7698GU4AV.org.plainphone.app"),
  ANDROID_APP_PACKAGE: z.string().default("org.plainphone.parent"),
  /** SHA-256 fingerprints (AA:BB:…) of the Android signing certificates, comma separated. */
  ANDROID_APP_CERT_SHA256: z.string().default(""),
  /**
   * Web Push to the parent app. Without both keys, notifications are off. Make a pair with
   * `node server/dist/lib/webpush.js`. Keep the private key secret; changing the pair
   * invalidates every existing subscription.
   */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  /** Contact the push services can reach (RFC 8292), a mailto: or https: URL. */
  VAPID_SUBJECT: z.string().default("mailto:privacy@plainphone.org"),
  /** Extra push service hosts to allow, comma separated (e.g. "push.example.org,*.example.net"). */
  PUSH_EXTRA_HOSTS: z.string().default(""),
  /**
   * Tell parents when a phone has not been seen for this many hours, unless they chose
   * another time for the phone. 0 switches the default off.
   */
  OFFLINE_ALERT_HOURS: z.coerce.number().int().min(0).max(168).default(12),
  /**
   * Delivery timings (durations and provider names only) for `/api/latency` and the dashboard's
   * "alerts usually arrive in" line (docs/latency.md). "off" records and shows nothing.
   */
  LATENCY_STATS: unsetIfEmpty(z.enum(["on", "off"]).default("on")),
  /**
   * Bearer token for `GET /api/metrics`, the operator's delivery-speed numbers in Prometheus text
   * (docs/latency.md). At least 24 random characters; unset, or shorter (dropped and reported),
   * the endpoint answers 404.
   */
  METRICS_TOKEN: unsetIfEmpty(z.string().min(24).optional()),
  /**
   * Strong-mode setup (provisioning QR made in the dashboard). The phone downloads the app from
   * `${PUBLIC_URL}/download/android`, which redirects to APK_DOWNLOAD_URL when set, otherwise to
   * the newest APK released on GitHub in APK_RELEASES_REPO. Self-hosters with their own build set
   * APK_DOWNLOAD_URL and APK_SIGNATURE_CHECKSUM (base64url SHA-256 of the signing certificate).
   */
  APK_DOWNLOAD_URL: unsetIfEmpty(z.url().optional()),
  APK_METADATA_URL: unsetIfEmpty(z.url({ protocol: /^https$/ }).optional()),
  APK_RELEASES_REPO: unsetIfEmpty(z.string().regex(/^[\w.-]+\/[\w.-]+$/).default("plainphone/plainphone")),
  APK_SIGNATURE_CHECKSUM: unsetIfEmpty(
    z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .default("iGj8FnevSjpvbT6FjOJt-bbsEQc1nbs8I4MbDOBUEhU"),
  ),
  /** Private DNS the phone uses from setup until its own filter host is ready. */
  PROVISIONING_DNS_HOST: unsetIfEmpty(z.string().default("family.adguard-dns.com")),
  /**
   * Google OAuth client (type "Web application") for "Protect against reset" (#20). Redirect URI:
   * `<PUBLIC_URL>/api/reset-protection/google/callback`, People API enabled. Without it the
   * dashboard explains that the feature is not set up on this server.
   */
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  /**
   * iPhone pairing (docs/ios/architecture.md, phase 1). Off until the iOS app ships: the server
   * then answers `platform: "ios"` pairings with `ios_pairing_not_yet`, and the dashboard and
   * the parent app hide "Add an iPhone".
   */
  IOS_PAIRING_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Pay to unlock (D13). Off until a payment provider is integrated. */
  PAYMENTS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /**
   * Billing on the hosted service (docs/billing.md). Off by default: with it off every household
   * keeps an unlimited plan, no billing UI is shown and no payment provider is called.
   */
  BILLING_ENABLED: unsetIfEmpty(z.enum(["true", "false"]).default("false")).transform((v) => v === "true"),
  /**
   * E2EE phase 0 prototype (docs/e2ee-prototype.md): the MLS delivery-service routes under
   * /api/e2ee. Test data only. Off by default, and always off with NODE_ENV=production.
   */
  E2EE_PROTOTYPE_ENABLED: unsetIfEmpty(z.enum(["true", "false"]).default("false")).transform((v) => v === "true"),
  /**
   * Households created before this instant keep an unlimited plan ("grandfathered"). Required
   * when BILLING_ENABLED is true; without it billing stays off and /api/health reports why.
   */
  BILLING_GRANDFATHER_BEFORE: unsetIfEmpty(z.iso.datetime({ offset: true }).optional()),
  /** Free plan limits per household (only enforced with BILLING_ENABLED). */
  BILLING_FREE_PHONES: unsetIfEmpty(z.coerce.number().int().min(1).max(100).default(1)),
  BILLING_FREE_TRUSTED: unsetIfEmpty(z.coerce.number().int().min(0).max(100).default(1)),
  /** Shown prices in minor units (øre/cents) and their currency. Working values, not final prices. */
  BILLING_CURRENCY: unsetIfEmpty(z.string().regex(/^[A-Z]{3}$/).default("DKK")),
  BILLING_PLUS_PRICE_MINOR: unsetIfEmpty(z.coerce.number().int().min(0).default(2900)),
  BILLING_EARLY_UNLOCK_PRICE_MINOR: unsetIfEmpty(z.coerce.number().int().min(0).default(1000)),
  /** Stripe (dashboard checkout for sideloaded phones). Keys come from the environment only. */
  STRIPE_SECRET_KEY: unsetIfEmpty(z.string().optional()),
  STRIPE_WEBHOOK_SECRET: unsetIfEmpty(z.string().optional()),
  /** The recurring Price for the paid household plan (price_...). */
  STRIPE_PRICE_PLUS: unsetIfEmpty(z.string().optional()),
  /** Google Play Billing (Play builds). The service account needs the Play Developer API. */
  PLAY_PACKAGE_NAME: unsetIfEmpty(z.string().default("org.plainphone.app")),
  PLAY_SERVICE_ACCOUNT_JSON: unsetIfEmpty(z.string().optional()),
  PLAY_SERVICE_ACCOUNT_FILE: unsetIfEmpty(z.string().optional()),
  /** Product ids in Play Console: the household subscription and the one-time early unlock. */
  PLAY_PRODUCT_PLUS: unsetIfEmpty(z.string().default("plus_household")),
  PLAY_PRODUCT_EARLY_UNLOCK: unsetIfEmpty(z.string().default("early_unlock")),
  /** Shared secret in the Pub/Sub push URL for real-time developer notifications (?token=...). */
  PLAY_RTDN_TOKEN: unsetIfEmpty(z.string().min(24).optional()),
  /**
   * Sign-in for app store review (docs/store-review.md): only this address can sign in with this
   * code, in the dashboard and the parent app, and its household gets a demo phone. Unset (the
   * default), the path does not exist. Both must be valid and the code at least 32 characters;
   * otherwise the path stays off and /api/health reports why, without the values.
   */
  REVIEW_LOGIN_EMAIL: unsetIfEmpty(z.string().optional()),
  REVIEW_LOGIN_CODE: unsetIfEmpty(z.string().optional()),
  /**
   * New households allowed per UTC day (docs/operations.md). Unset or 0: no cap, the self-hosting
   * default. Existing accounts and people invited into a household are never stopped.
   */
  SIGNUP_DAILY_CAP: unsetIfEmpty(z.coerce.number().int().min(0).default(0)),
  /**
   * Bot and spam protection on the sign-in form (docs/operations.md, "Bot and spam protection").
   * `altcha`: the dashboard and the parent app solve a small proof-of-work puzzle before a login
   * link is mailed. Off by default for self-hosting; the hosted service turns it on.
   */
  BOT_CHALLENGE: unsetIfEmpty(z.enum(["altcha", "off"]).default("off")),
  /** Largest number in the puzzle: the average work is half of it (SHA-256 hashes). */
  BOT_CHALLENGE_DIFFICULTY: unsetIfEmpty(z.coerce.number().int().min(1_000).max(10_000_000).default(100_000)),
  /** HMAC key for the puzzles. Unset: made on first start and kept in the database. */
  BOT_CHALLENGE_HMAC_KEY: unsetIfEmpty(z.string().min(32).optional()),
  /** A hidden form field only bots fill in: they get a normal answer, and no mail is sent. */
  SPAM_HONEYPOT: unsetIfEmpty(z.enum(["on", "off"]).default("on")),
  /** Refuse throwaway mail addresses for new households (server/catalog/disposable-email/domains.txt). */
  BLOCK_DISPOSABLE_EMAIL: unsetIfEmpty(z.enum(["on", "off"]).default("on")),
  /** Invitation mails per household per 24 hours, counted in the database. 0: no cap. */
  INVITES_PER_HOUSEHOLD_DAILY: unsetIfEmpty(z.coerce.number().int().min(0).default(20)),
  /**
   * Phones per household at most (docs/operations.md, "Phones per household"). Every phone gets its
   * own DNS filter ClientID, so one account must not register hundreds. Checked only when a phone
   * is added; phones already there are never touched. Unset or 0: no cap, the self-hosting default.
   */
  HOUSEHOLD_PHONE_CAP: unsetIfEmpty(z.coerce.number().int().min(0).default(0)),
  /**
   * Trust X-Forwarded-For from a reverse proxy (Traefik, Caddy, nginx) for rate limits.
   * Leave false when the server is reachable directly, or clients can fake their address.
   */
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Run database migrations on startup. */
  MIGRATE_ON_START: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

/** Every environment variable the server reads (test/env-wiring.test.ts checks the deploy files against it). */
export const CONFIG_KEYS = Object.keys(schema.shape) as readonly (keyof z.infer<typeof schema>)[];

export type Config = z.infer<typeof schema> & {
  /** Optional settings that were invalid and fell back to their default: "<area>: <reason>". */
  configWarnings: { push: string[]; other: string[] };
};

/**
 * Optional switches that must never stop the server. Values are matched case-insensitively
 * ("TRUE", "FCM"); anything else falls back to the default and is reported, never echoed.
 */
const LENIENT: { key: string; values: string[]; area: "push" | "other"; label: string }[] = [
  { key: "PUSH_PROVIDER", values: ["none", "fcm", "unifiedpush"], area: "push", label: "push" },
  { key: "APNS_SANDBOX", values: ["true", "false"], area: "push", label: "apns" },
  { key: "MAIL_PROVIDER", values: ["none", "log", "smtp"], area: "other", label: "mail" },
  { key: "BILLING_ENABLED", values: ["true", "false"], area: "other", label: "billing" },
  { key: "E2EE_PROTOTYPE_ENABLED", values: ["true", "false"], area: "other", label: "e2ee" },
  { key: "LATENCY_STATS", values: ["on", "off"], area: "other", label: "latency" },
  { key: "BOT_CHALLENGE", values: ["altcha", "off"], area: "other", label: "bot challenge" },
  { key: "SPAM_HONEYPOT", values: ["on", "off"], area: "other", label: "honeypot" },
  { key: "BLOCK_DISPOSABLE_EMAIL", values: ["on", "off"], area: "other", label: "disposable mail" },
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const warnings = { push: [] as string[], other: [] as string[] };
  const sane: NodeJS.ProcessEnv = { ...env };
  for (const { key, values, area, label } of LENIENT) {
    const raw = sane[key]?.trim().toLowerCase();
    if (raw === undefined || raw === "") continue;
    if (values.includes(raw)) sane[key] = raw;
    else {
      delete sane[key];
      warnings[area].push(`${label}: invalid ${key}`);
    }
  }
  // Billing settings must not stop a server, least of all one where billing is off. An invalid
  // value is dropped and reported; without a cutoff billing stays off (below).
  const softBilling: [string, z.ZodType][] = [
    ["PLAY_RTDN_TOKEN", z.string().min(24)],
    ["BILLING_GRANDFATHER_BEFORE", z.iso.datetime({ offset: true })],
  ];
  for (const [key, check] of softBilling) {
    const raw = sane[key];
    if (raw === undefined || raw === "" || check.safeParse(raw).success) continue;
    delete sane[key];
    warnings.other.push(`billing: invalid ${key}`);
  }
  if (sane.METRICS_TOKEN && sane.METRICS_TOKEN.length < 24) {
    delete sane.METRICS_TOKEN;
    warnings.other.push("metrics: invalid METRICS_TOKEN");
  }
  if (sane.BOT_CHALLENGE_HMAC_KEY && sane.BOT_CHALLENGE_HMAC_KEY.length < 32) {
    // The server then makes its own key, so the challenge keeps working.
    delete sane.BOT_CHALLENGE_HMAC_KEY;
    warnings.other.push("bot challenge: invalid BOT_CHALLENGE_HMAC_KEY");
  }
  // A protection that was asked for but misspelt stays on rather than silently off.
  if (warnings.other.includes("bot challenge: invalid BOT_CHALLENGE")) sane.BOT_CHALLENGE = "altcha";
  if (sane.REVIEW_LOGIN_EMAIL || sane.REVIEW_LOGIN_CODE) {
    const address = z.string().trim().toLowerCase().pipe(z.email()).safeParse(sane.REVIEW_LOGIN_EMAIL ?? "");
    const code = sane.REVIEW_LOGIN_CODE?.trim() ?? "";
    if (address.success && code.length >= REVIEW_CODE_MIN && code.length <= 200) {
      sane.REVIEW_LOGIN_EMAIL = address.data;
      sane.REVIEW_LOGIN_CODE = code;
    } else {
      delete sane.REVIEW_LOGIN_EMAIL;
      delete sane.REVIEW_LOGIN_CODE;
      warnings.other.push("review: needs REVIEW_LOGIN_EMAIL and a REVIEW_LOGIN_CODE of 32 to 200 characters");
    }
  }
  const parsed = schema.safeParse(sane);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${z.prettifyError(parsed.error)}`);
  }
  const cfg: Config = { ...parsed.data, configWarnings: warnings };
  if (cfg.MAIL_PROVIDER === "log" && cfg.NODE_ENV === "production") {
    // Optional: degrade to no mail rather than print login links or crash.
    cfg.MAIL_PROVIDER = "none";
    warnings.other.push("mail: MAIL_PROVIDER=log is not allowed in production");
  }
  if (cfg.BILLING_ENABLED && !cfg.BILLING_GRANDFATHER_BEFORE) {
    // Optional: without a cutoff nobody could be grandfathered, so billing stays off.
    cfg.BILLING_ENABLED = false;
    warnings.other.push("billing: BILLING_ENABLED needs BILLING_GRANDFATHER_BEFORE");
  }
  if (cfg.E2EE_PROTOTYPE_ENABLED && cfg.NODE_ENV === "production") {
    // The prototype has had no independent review: never in production (docs/e2ee-prototype.md).
    cfg.E2EE_PROTOTYPE_ENABLED = false;
    warnings.other.push("e2ee: E2EE_PROTOTYPE_ENABLED is not allowed in production");
  }
  if (cfg.DNS_PROVIDER === "http" && (!cfg.DNS_API_URL || !cfg.DNS_API_TOKEN)) {
    throw new Error("DNS_PROVIDER=http needs DNS_API_URL and DNS_API_TOKEN");
  }
  return cfg;
}
