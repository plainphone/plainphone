// SPDX-License-Identifier: Apache-2.0
import type { phones } from "../db/schema.js";
import type { Config } from "../config.js";

type PhoneSetup = Pick<typeof phones.$inferSelect, "language" | "timezone" | "mode" | "profile">;

const locales = { da: "da_DK", en: "en_GB", sv: "sv_SE", nb: "nb_NO", de: "de_DE" };
const callingCodes: Record<string, string> = {
  "Europe/Copenhagen": "45",
  "Europe/Oslo": "47",
  "Europe/Stockholm": "46",
  "Europe/Helsinki": "358",
  "Europe/Berlin": "49",
  "Europe/London": "44",
  "Europe/Amsterdam": "31",
};

export function provisioningInfo(cfg: Config, phone: PhoneSetup) {
  const serverUrl = cfg.PUBLIC_URL.replace(/\/$/, "");
  const strong = phone.mode === "strong";
  return {
    adminComponent: "org.plainphone.app/.PlainphoneAdminReceiver",
    downloadUrl: `${serverUrl}/download/android`,
    signatureChecksum: cfg.APK_SIGNATURE_CHECKSUM,
    serverUrl,
    dnsHost: cfg.PROVISIONING_DNS_HOST,
    mode: phone.mode,
    profile: phone.profile,
    language: phone.language,
    timezone: phone.timezone,
    locale: strong && phone.profile === "child" && phone.language ? locales[phone.language] : null,
    countryCode: strong ? callingCodes[phone.timezone] ?? null : null,
  };
}

export type ProvisioningInfo = ReturnType<typeof provisioningInfo>;
