// SPDX-License-Identifier: Apache-2.0
//
// Solves the server's ALTCHA proof-of-work challenge (protocol v1, https://altcha.org), for the
// dashboard and the parent app (docs/operations.md, "Bot and spam protection"). Plain TypeScript
// with its own SHA-256, so it needs no WebCrypto, no webview and no third-party code: React Native's
// Hermes has no crypto.subtle, and one digest call per guess would be slow over any bridge anyway.
//
// The work runs in small slices that yield to the event loop, so the screen stays responsive.

export interface AltchaChallenge {
  algorithm: "SHA-256";
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W = new Uint32Array(64);
const H = new Uint32Array(8);
let scratch = new Uint8Array(64);

/** SHA-256 of `bytes` into H (eight big-endian words). */
function digest(bytes: Uint8Array, length: number): Uint32Array {
  H.set([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const blocks = Math.ceil((length + 9) / 64);
  // Reused between calls: without a JIT (Hermes), an allocation per guess costs more than the hash.
  if (scratch.length !== blocks * 64) scratch = new Uint8Array(blocks * 64);
  const padded = scratch;
  padded.fill(0);
  padded.set(bytes.subarray(0, length));
  padded[length] = 0x80;
  const bits = length * 8;
  const end = padded.length;
  padded[end - 4] = (bits >>> 24) & 0xff;
  padded[end - 3] = (bits >>> 16) & 0xff;
  padded[end - 2] = (bits >>> 8) & 0xff;
  padded[end - 1] = bits & 0xff;
  // Messages here are far below 2^29 bytes, so the upper length word stays 0.
  for (let off = 0; off < end; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      W[i] = (padded[j]! << 24) | (padded[j + 1]! << 16) | (padded[j + 2]! << 8) | padded[j + 3]!;
    }
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15]!;
      const b = W[i - 2]!;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) | 0;
    }
    let a = H[0]!, b = H[1]!, c = H[2]!, d = H[3]!, e = H[4]!, f = H[5]!, g = H[6]!, h = H[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i]! + W[i]!) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0]! + a) | 0; H[1] = (H[1]! + b) | 0; H[2] = (H[2]! + c) | 0; H[3] = (H[3]! + d) | 0;
    H[4] = (H[4]! + e) | 0; H[5] = (H[5]! + f) | 0; H[6] = (H[6]! + g) | 0; H[7] = (H[7]! + h) | 0;
  }
  return H;
}

/** ASCII bytes of `text` (salts and numbers are ASCII). */
function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** Lowercase hex SHA-256 of an ASCII string. Exported for tests. */
export function sha256Hex(text: string): string {
  const h = digest(ascii(text), text.length);
  let out = "";
  for (let i = 0; i < 8; i++) out += (h[i]! >>> 0).toString(16).padStart(8, "0");
  return out;
}

function hexWords(hex: string): Uint32Array {
  const out = new Uint32Array(8);
  for (let i = 0; i < 8; i++) out[i] = parseInt(hex.slice(i * 8, i * 8 + 8), 16);
  return out;
}

/** Writes the decimal digits of `n` into `buf` at `at`; returns the new length. */
function writeNumber(buf: Uint8Array, at: number, n: number): number {
  if (n === 0) {
    buf[at] = 48;
    return at + 1;
  }
  let digits = 0;
  for (let m = n; m > 0; m = Math.floor(m / 10)) digits++;
  for (let i = digits - 1, m = n; i >= 0; i--, m = Math.floor(m / 10)) buf[at + i] = 48 + (m % 10);
  return at + digits;
}

/** The number whose SHA-256 with the salt is the challenge, from `from` up to `to`, or null. */
export function findNumber(c: Pick<AltchaChallenge, "challenge" | "salt">, from: number, to: number): number | null {
  const want = hexWords(c.challenge);
  const salt = ascii(c.salt);
  const buf = new Uint8Array(salt.length + 10);
  buf.set(salt);
  for (let n = from; n <= to; n++) {
    const h = digest(buf, writeNumber(buf, salt.length, n));
    if (h[0] === want[0] && h[1] === want[1] && h[2] === want[2] && h[3] === want[3]
      && h[4] === want[4] && h[5] === want[5] && h[6] === want[6] && h[7] === want[7]) return n;
  }
  return null;
}

export class AltchaAborted extends Error {
  constructor() {
    super("aborted");
  }
}

export interface SolveOptions {
  signal?: AbortSignal;
  /** Called after each slice with the share of the range tried so far (0..1). */
  onProgress?: (share: number) => void;
  /** Guesses per slice before the event loop gets a turn. */
  slice?: number;
  /** How to yield; tests pass a synchronous one. */
  yieldNow?: () => Promise<void>;
}

const defaultYield = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The payload the server wants in `altcha`: base64 of the JSON solution. */
export function altchaPayload(c: AltchaChallenge, number: number, took?: number): string {
  const json = JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number, salt: c.salt, signature: c.signature, ...(took === undefined ? {} : { took }) });
  return btoa(json);
}

/**
 * Finds the solution and returns the payload for `altcha`. Rejects with AltchaAborted when the
 * signal fires, and with an error when no number in the range works (a broken challenge).
 */
export async function solveAltcha(c: AltchaChallenge, options: SolveOptions = {}): Promise<string> {
  if (c.algorithm !== "SHA-256" || !/^[0-9a-f]{64}$/.test(c.challenge)) throw new Error("unsupported challenge");
  const slice = options.slice ?? 2_000;
  const yieldNow = options.yieldNow ?? defaultYield;
  const started = Date.now();
  for (let from = 0; from <= c.maxnumber; from += slice) {
    if (options.signal?.aborted) throw new AltchaAborted();
    const to = Math.min(c.maxnumber, from + slice - 1);
    const found = findNumber(c, from, to);
    if (found !== null) {
      options.onProgress?.(1);
      return altchaPayload(c, found, Date.now() - started);
    }
    options.onProgress?.((to + 1) / (c.maxnumber + 1));
    await yieldNow();
  }
  throw new Error("no solution in range");
}
