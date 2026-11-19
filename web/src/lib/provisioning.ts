// SPDX-License-Identifier: Apache-2.0
//
// The provisioning QR code for strong mode, built in the browser. Same content as
// scripts/provisioning-qr.py, plus the one-time enrollment token. The maintenance PIN is hashed
// here with the same PBKDF2 parameters as the script and the app (MaintenancePin.kt); neither the
// PIN nor its hash is sent to the server.

import { encode } from "uqr";
import type { Profile } from "./api";
import type { Language, PhoneLanguage } from "./phone-language";

const provisioningLocales: Record<Language, string> = { da: "da_DK", en: "en_GB", sv: "sv_SE", nb: "nb_NO", de: "de_DE" };

export const PBKDF2_ITERATIONS = 120_000; // must match MaintenancePin.kt and provisioning-qr.py
export const MIN_PIN_LENGTH = 6;
const PREFIX = "android.app.extra.";
/** PolicyConfig.DEFAULT_DNS_HOST and DEFAULT_SERVER_URL in the app. */
export const APP_DEFAULT_DNS_HOST = "family.adguard-dns.com";
export const APP_DEFAULT_SERVER_URL = "https://app.plainphone.org";

/** What the server hands out with an enrollment (POST /phones/enroll). */
export interface ProvisioningInfo {
  adminComponent: string;
  downloadUrl: string;
  signatureChecksum: string;
  serverUrl: string;
  dnsHost: string;
}

export function isValidPin(pin: string): boolean {
  return pin.length >= MIN_PIN_LENGTH && pin.length <= 12 && /^[0-9]+$/.test(pin);
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((x) => parseInt(x, 16)));

export function newSalt(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

/** PBKDF2-HMAC-SHA256, 120,000 iterations, 32 bytes, as lowercase hex. */
export async function hashPin(pin: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return hex(new Uint8Array(bits));
}

/**
 * The JSON the phone's QR reader gets. Only the extras the app needs: everything else keeps the
 * app's defaults, so the code stays small enough for an old camera to read off a screen.
 */
export interface SetupWifi {
  ssid: string;
  password: string;
}

export function provisioningPayload(
  info: ProvisioningInfo,
  opts: { enrollmentToken: string; pinHash: string; pinSalt: string; countryCode?: string | null; language?: PhoneLanguage; profile?: Profile; timezone?: string; wifi?: SetupWifi },
) {
  const extras: Record<string, string> = {
    "plainphone.pin_hash": opts.pinHash,
    "plainphone.pin_salt": opts.pinSalt,
    "plainphone.enroll": opts.enrollmentToken,
  };
  // The app's own defaults (PolicyConfig.kt) need not travel: every byte makes the code denser.
  if (info.dnsHost !== APP_DEFAULT_DNS_HOST) extras["plainphone.dns_host"] = info.dnsHost;
  if (info.serverUrl !== APP_DEFAULT_SERVER_URL) extras["plainphone.server_url"] = info.serverUrl;
  if (opts.profile === "self") extras["plainphone.self"] = "true";
  if (opts.countryCode) extras["plainphone.country_code"] = opts.countryCode.replace(/^\+/, "");
  return {
    [PREFIX + "PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME"]: info.adminComponent,
    [PREFIX + "PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION"]: info.downloadUrl,
    [PREFIX + "PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM"]: info.signatureChecksum,
    // Keep the maker's dialer, messages, camera and clock installed; Plainphone hides the rest.
    [PREFIX + "PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED"]: true,
    [PREFIX + "PROVISIONING_ADMIN_EXTRAS_BUNDLE"]: extras,
    ...(opts.language && opts.profile !== "self" && { [PREFIX + "PROVISIONING_LOCALE"]: provisioningLocales[opts.language] }),
    ...(opts.timezone && { [PREFIX + "PROVISIONING_TIME_ZONE"]: opts.timezone }),
    ...(opts.wifi && {
      [PREFIX + "PROVISIONING_WIFI_SSID"]: opts.wifi.ssid,
      [PREFIX + "PROVISIONING_WIFI_SECURITY_TYPE"]: opts.wifi.password ? "WPA" : "NONE",
      ...(opts.wifi.password && { [PREFIX + "PROVISIONING_WIFI_PASSWORD"]: opts.wifi.password }),
    }),
  };
}

/** Compact JSON (no spaces) and its QR matrix, error correction L like the script. */
export function provisioningQr(payload: ReturnType<typeof provisioningPayload>) {
  const text = JSON.stringify(payload);
  const qr = encode(text, { ecc: "L", border: 0 });
  return { text, size: qr.size, version: qr.version, modules: qr.data };
}

/** Calling code guessed from the browser's time zone; the phone falls back to its SIM. */
export function countryCodeForTimezone(tz: string): string | null {
  const map: Record<string, string> = {
    "Europe/Copenhagen": "45",
    "Europe/Oslo": "47",
    "Europe/Stockholm": "46",
    "Europe/Helsinki": "358",
    "Europe/Berlin": "49",
    "Europe/London": "44",
    "Europe/Amsterdam": "31",
  };
  return map[tz] ?? null;
}
