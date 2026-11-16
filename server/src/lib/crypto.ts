// SPDX-License-Identifier: Apache-2.0
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export function randomToken(prefix = ""): string {
  return prefix + randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Unambiguous alphabet: no 0/O, 1/I/L, so codes can be read aloud and typed. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Pairing code like "K7MP-4QXR" (8 symbols, ~39 bits). */
export function pairingCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Uppercases and strips separators so "k7mp 4qxr" matches "K7MP-4QXR". */
export function normalizePairingCode(input: string): string {
  const s = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

/** Lowercase id for DNS ClientIDs: a DNS label of 20 base32 characters. */
export function dnsClientId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let s = "";
  for (let i = 0; i < 20; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}
