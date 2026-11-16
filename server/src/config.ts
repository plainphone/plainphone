// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

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
  /** Pay to unlock (D13). Off until a payment provider is integrated. */
  PAYMENTS_ENABLED: z
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
  if (cfg.DNS_PROVIDER === "http" && (!cfg.DNS_API_URL || !cfg.DNS_API_TOKEN)) {
    throw new Error("DNS_PROVIDER=http needs DNS_API_URL and DNS_API_TOKEN");
  }
  return cfg;
}
