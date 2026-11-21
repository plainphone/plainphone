// SPDX-License-Identifier: Apache-2.0
//
// Hardware key attestation (#23): the phone creates a key in its TEE or StrongBox with a challenge
// from this server and sends the certificate chain. The server checks the chain against Google's
// attestation roots and the revocation list, and reads the boot state from the attestation record
// (https://source.android.com/docs/security/features/keystore/attestation#schema). Verification
// only ever happens here, never on the phone. No serial number or IMEI is attested or stored.

import { errorSummary } from "../lib/log.js";
import { execFile } from "node:child_process";
import { randomBytes, X509Certificate } from "node:crypto";
import { GOOGLE_ATTESTATION_ROOTS } from "../lib/attestation-roots.js";
import { asBool, asInt, asOctets, certificateExtension, children, readTlv, type Tlv } from "../lib/der.js";

export const KEY_ATTESTATION_OID = "1.3.6.1.4.1.11129.2.1.17";
export const REVOCATION_URL = "https://android.googleapis.com/attestation/status";
const TAG_ROOT_OF_TRUST = 704;
const TAG_OS_PATCH_LEVEL = 706;

/**
 * - `verified`: locked bootloader, the maker's own system.
 * - `unlocked`: the bootloader is unlocked (FRP is then off, and the system can be replaced).
 * - `custom-os`: locked, but with a system signed by someone other than the maker.
 * - `failed-boot`: verified boot reported a failure.
 * - `unverifiable`: no hardware attestation (software keystore, or a root that is not Google's).
 * - `revoked`: legacy stored verdict. A revoked batch key cannot establish boot state.
 */
export type AttestationState = "verified" | "unlocked" | "custom-os" | "failed-boot" | "unverifiable" | "revoked";

export interface AttestationResult {
  state: AttestationState;
  securityLevel: "software" | "tee" | "strongbox" | null;
  deviceLocked: boolean | null;
  verifiedBootState: "verified" | "self-signed" | "unverified" | "failed" | null;
  /** YYYYMM, from the hardware-enforced list. */
  osPatchLevel: number | null;
  /** False when Google's revocation list could not be fetched. */
  revocationChecked: boolean;
}

export class ChallengeMismatch extends Error {}
export class AttestationVerifierUnavailable extends Error {}

export const UNVERIFIABLE_ATTESTATION: AttestationResult = {
  state: "unverifiable",
  securityLevel: null,
  deviceLocked: null,
  verifiedBootState: null,
  osPatchLevel: null,
  revocationChecked: false,
};

export const ATTESTATION_MAX_AGE_MS = 48 * 60 * 60_000;

const BOOT_STATES = ["verified", "self-signed", "unverified", "failed"] as const;
const LEVELS = ["software", "tee", "strongbox"] as const;

const rootKeys = GOOGLE_ATTESTATION_ROOTS.map((pem) =>
  new X509Certificate(pem).publicKey.export({ type: "spki", format: "der" }).toString("base64"),
);

/** Serial numbers as the revocation list writes them: lowercase hex without leading zeros. */
export function serialKey(cert: X509Certificate): string {
  return cert.serialNumber.toLowerCase().replace(/^0+(?=.)/, "");
}

function explicitField(list: Tlv, tag: number): Tlv | null {
  const f = children(list.value).find((t) => t.cls === 2 && t.tag === tag);
  return f ? (children(f.value)[0] ?? null) : null;
}

/**
 * Verifies a chain (leaf first) for [challenge]. Throws [ChallengeMismatch] when the record was
 * made for another challenge, and plain errors for a chain that does not parse or does not link up.
 */
export async function verifyAttestation(chainDer: Buffer[], challenge: Buffer, revoked: Set<string> | null, now = Date.now()): Promise<AttestationResult> {
  if (chainDer.length < 2) throw new Error("chain too short");
  const certs = chainDer.map((d) => new X509Certificate(d));
  for (let i = 0; i < certs.length - 1; i++) {
    if (!certs[i]!.verify(certs[i + 1]!.publicKey)) throw new Error(`certificate ${i} is not signed by the next one`);
  }
  const root = certs.at(-1)!;
  if (!root.verify(root.publicKey)) throw new Error("the last certificate is not self-signed");

  // Use the record closest to the root. A later certificate can carry an extension
  // added by whoever controls an already-attested key.
  const ext = chainDer.toReversed().map((der) => certificateExtension(der, KEY_ATTESTATION_OID)).find(Boolean);
  if (!ext) throw new Error("no attestation record in the certificate chain");
  const desc = children(readTlv(ext).tlv.value);
  if (desc.length < 8) throw new Error("attestation record too short");
  const level = LEVELS[asInt(desc[1]!)] ?? null;
  if (!asOctets(desc[4]!).equals(challenge)) throw new ChallengeMismatch("attestation is for another challenge");

  const revocationChecked = revoked !== null;
  const base = { securityLevel: level, revocationChecked };
  const unverifiable = { ...UNVERIFIABLE_ATTESTATION, ...base };
  const rootKey = root.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  if (!rootKeys.includes(rootKey)) return unverifiable;
  if (revoked && certs.some((c) => revoked.has(serialKey(c)))) return unverifiable;
  if (level === "software" || level === null || !(await validCertificatePath(certs, now))) return unverifiable;

  const hardware = desc[7]!;
  const rot = explicitField(hardware, TAG_ROOT_OF_TRUST);
  if (!rot) return unverifiable;
  const rotParts = children(rot.value);
  const deviceLocked = asBool(rotParts[1]!);
  const bootState = BOOT_STATES[asInt(rotParts[2]!)] ?? null;
  const patch = explicitField(hardware, TAG_OS_PATCH_LEVEL);
  const osPatchLevel = patch ? asInt(patch) : null;

  return { ...base, state: bootVerdict(deviceLocked, bootState, revocationChecked), deviceLocked, verifiedBootState: bootState, osPatchLevel };
}

export function bootVerdict(locked: boolean, boot: AttestationResult["verifiedBootState"], revocationChecked: boolean): AttestationState {
  if (boot === "unverified") return "unlocked";
  if (boot === "failed") return "failed-boot";
  if (boot === "self-signed") return "custom-os";
  return boot === "verified" && locked && revocationChecked ? "verified" : "unverifiable";
}

/** Verify CA constraints, key usage, validity, and critical extensions against the pinned root. */
async function validCertificatePath(certs: X509Certificate[], now: number): Promise<boolean> {
  if (certs.some((cert) => now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo))) return false;

  // Pass PEM through anonymous pipes. The chain never needs a file or a command-line argument.
  const verify = `
    IFS= read -r -d '' leaf
    IFS= read -r -d '' root
    IFS= read -r -d '' intermediates
    if [[ -n "$intermediates" ]]; then
      openssl verify -trusted <(printf '%s' "$root") -untrusted <(printf '%s' "$intermediates") -attime "$1" <(printf '%s' "$leaf")
    else
      openssl verify -trusted <(printf '%s' "$root") -attime "$1" <(printf '%s' "$leaf")
    fi`;
  const input = [
    certs[0]!.toString(),
    certs.at(-1)!.toString(),
    certs.slice(1, -1).map((cert) => cert.toString()).join(""),
    "",
  ].join("\0");
  // Asynchronous, so a slow openssl does not hold up every other request.
  const status = await new Promise<number | null>((resolve, reject) => {
    const child = execFile("bash", ["-c", verify, "verify", String(Math.floor(now / 1000))], { timeout: 3000 }, (error) => {
      if (!error) return resolve(0);
      typeof error.code === "number" && !error.killed ? resolve(error.code) : reject(error);
    });
    child.stdin?.on("error", () => {}); // a verifier that exits early closes the pipe; the exit code tells
    child.stdin?.end(input);
  }).catch((cause: unknown) => {
    throw new AttestationVerifierUnavailable("certificate verifier unavailable", { cause });
  });
  if (status !== 0 && status !== 2) throw new AttestationVerifierUnavailable("certificate verifier unavailable");
  return status === 0;
}

export function newChallenge(): Buffer {
  return randomBytes(32);
}

/** Google's revocation list, cached for an hour. Once stale, a failed refresh leaves no usable list. */
export class RevocationList {
  private cached: { at: number; serials: Set<string> } | null = null;

  constructor(private readonly fetcher: () => Promise<unknown> = defaultFetch) {}

  async get(now: number): Promise<Set<string> | null> {
    if (this.cached && now - this.cached.at < 60 * 60_000) return this.cached.serials;
    try {
      const body = (await this.fetcher()) as { entries?: Record<string, unknown> };
      if (!body?.entries || typeof body.entries !== "object" || Array.isArray(body.entries)) {
        throw new Error("invalid revocation list");
      }
      const serials = new Set(Object.keys(body.entries).map((s) => s.toLowerCase().replace(/^0+(?=.)/, "")));
      this.cached = { at: now, serials };
    } catch (err) {
      console.error(`attestation revocation list: ${errorSummary(err)}`);
      return null;
    }
    return this.cached?.serials ?? null;
  }
}

async function defaultFetch(): Promise<unknown> {
  const res = await fetch(REVOCATION_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
