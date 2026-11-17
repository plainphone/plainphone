// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

/** Compose files pass unset variables as "": treat that as unset, so the default applies. */
const unsetIfEmpty = <T extends z.ZodType>(t: T) => z.preprocess((v) => (v === "" ? undefined : v), t);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8080),
  DATABASE_URL: z.string().min(1),
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
  /** Only "none" today: phones poll. FCM is the planned next layer (docs/sync-api.md). */
  PUSH_PROVIDER: z.enum(["none"]).default("none"),
  /**
   * Native parent apps that may open this server's links (universal links / app links),
   * served at /.well-known/apple-app-site-association and /.well-known/assetlinks.json.
   * Self-hosters with their own app builds put their own ids here.
   */
  APPLE_APP_IDS: z.string().default("P7698GU4AV.org.plainphone.parent"),
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
      .default("mPJAQkicVVPhhgwsBAZJoNloyyj1Cnln74AnjZDi2LM"),
  ),
  /** Private DNS the phone uses from setup until its own filter host is ready. */
  PROVISIONING_DNS_HOST: unsetIfEmpty(z.string().default("family.adguard-dns.com")),
  /** Pay to unlock (D13). Off until a payment provider is integrated. */
  PAYMENTS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
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

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${z.prettifyError(parsed.error)}`);
  }
  const cfg = parsed.data;
  if (cfg.MAIL_PROVIDER === "smtp" && !cfg.SMTP_URL) {
    throw new Error("MAIL_PROVIDER=smtp needs SMTP_URL");
  }
  if (cfg.MAIL_PROVIDER === "log" && cfg.NODE_ENV === "production") {
    throw new Error("MAIL_PROVIDER=log prints login links and is not allowed in production");
  }
  if (Boolean(cfg.VAPID_PUBLIC_KEY) !== Boolean(cfg.VAPID_PRIVATE_KEY)) {
    throw new Error("set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither");
  }
  if (cfg.DNS_PROVIDER === "http" && (!cfg.DNS_API_URL || !cfg.DNS_API_TOKEN)) {
    throw new Error("DNS_PROVIDER=http needs DNS_API_URL and DNS_API_TOKEN");
  }
  return cfg;
}
