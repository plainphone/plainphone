// SPDX-License-Identifier: Apache-2.0
import type { Config } from "../config.js";
import { validVapidKeys } from "../lib/webpush.js";
import { LogMailProvider, NoMailProvider, SmtpMailProvider, type MailProvider } from "../providers/mail.js";
import { readFileSync } from "node:fs";
import { configureNativePush, NativeParentPush, normalizeServiceAccount } from "../providers/native-push.js";
import { NoParentPushProvider, WebPushProvider } from "../providers/parent-push.js";
import { PhonePushProvider } from "../providers/push.js";
import { HttpPlay } from "../providers/play-billing.js";
import { HttpStripe } from "../providers/stripe.js";
import type { Ctx } from "./context.js";

/**
 * Builds the optional integrations (mail, Web Push, FCM, APNs). Invalid settings never stop the
 * server: the integration is switched off, one line is logged (name and reason, never the value
 * or the underlying error text) and the reason is reported by /api/health. Required settings,
 * such as the database, stay fail-fast in loadConfig and main.
 */
export function buildOptionalProviders(cfg: Config): Pick<Ctx, "mail" | "push" | "parentPush" | "degraded" | "billing"> {
  const degraded = { push: [] as string[], other: [] as string[] };
  const fail = (list: string[], reason: string) => {
    list.push(reason);
    console.error(`integration disabled: ${reason}`);
  };
  for (const r of cfg.configWarnings.push) fail(degraded.push, r);
  for (const r of cfg.configWarnings.other) fail(degraded.other, r);

  const { fcm, apns, errors } = configureNativePush(cfg);
  for (const r of errors) fail(degraded.push, r);

  let vapid: { publicKey: string; privateKey: string } | null = null;
  if (cfg.VAPID_PUBLIC_KEY || cfg.VAPID_PRIVATE_KEY) {
    if (!cfg.VAPID_PUBLIC_KEY || !cfg.VAPID_PRIVATE_KEY) {
      fail(degraded.push, "web: needs both VAPID keys");
    } else if (!validVapidKeys({ publicKey: cfg.VAPID_PUBLIC_KEY, privateKey: cfg.VAPID_PRIVATE_KEY })) {
      fail(degraded.push, "web: invalid VAPID key pair");
    } else {
      vapid = { publicKey: cfg.VAPID_PUBLIC_KEY, privateKey: cfg.VAPID_PRIVATE_KEY };
    }
  }

  let mail: MailProvider;
  if (cfg.MAIL_PROVIDER === "smtp") {
    try {
      if (!cfg.SMTP_URL) throw new Error("missing");
      mail = new SmtpMailProvider(cfg.SMTP_URL, cfg.MAIL_FROM);
    } catch {
      fail(degraded.other, "smtp: invalid or missing SMTP_URL");
      mail = new NoMailProvider();
    }
  } else {
    mail = cfg.MAIL_PROVIDER === "log" ? new LogMailProvider() : new NoMailProvider();
  }

  const parentWeb = vapid ? new WebPushProvider(vapid, cfg.VAPID_SUBJECT) : new NoParentPushProvider();

  const billing = buildBilling(cfg, (r) => fail(degraded.other, r));

  return {
    billing,
    mail,
    push: new PhonePushProvider(cfg, fcm),
    parentPush: new NativeParentPush(parentWeb, fcm, apns),
    degraded,
  };
}

/**
 * Payment providers (docs/billing.md). Nothing is built while BILLING_ENABLED is off, so a
 * server without billing never talks to Stripe or Google Play.
 */
export function buildBilling(cfg: Config, fail: (reason: string) => void): Ctx["billing"] {
  if (!cfg.BILLING_ENABLED) return undefined;
  const out: NonNullable<Ctx["billing"]> = {};
  if (cfg.STRIPE_SECRET_KEY) {
    if (!/^(sk|rk)_(test|live)_/.test(cfg.STRIPE_SECRET_KEY)) fail("stripe: invalid STRIPE_SECRET_KEY");
    else if (!cfg.STRIPE_WEBHOOK_SECRET) fail("stripe: needs STRIPE_WEBHOOK_SECRET");
    else out.stripe = new HttpStripe(cfg.STRIPE_SECRET_KEY);
  }
  const inline = cfg.PLAY_SERVICE_ACCOUNT_JSON;
  const file = cfg.PLAY_SERVICE_ACCOUNT_FILE;
  if (inline || file) {
    try {
      const raw = inline || readFileSync(file!, "utf8");
      out.play = new HttpPlay(normalizeServiceAccount(raw), cfg.PLAY_PACKAGE_NAME);
      if (!cfg.PLAY_RTDN_TOKEN) fail("play: PLAY_RTDN_TOKEN missing, real-time notifications are off");
    } catch {
      fail("play: invalid service account");
    }
  }
  return out;
}
