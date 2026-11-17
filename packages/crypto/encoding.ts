// SPDX-License-Identifier: Apache-2.0
import canonicalize from "canonicalize";

export type Bytes = Uint8Array<ArrayBuffer>;
export type Json = null | boolean | number | string | Json[] | JsonObject;
export type JsonObject = { [name: string]: Json };

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const bucketMin = 256;
const bucketMax = 4 * 1024 * 1024;

export function base64url(data: Uint8Array): string {
  let result = "";
  let bits = 0;
  let count = 0;
  for (const byte of data) {
    bits = (bits << 8) | byte;
    count += 8;
    while (count >= 6) {
      count -= 6;
      result += alphabet[(bits >>> count) & 63];
    }
  }
  if (count) result += alphabet[(bits << (6 - count)) & 63];
  return result;
}

export function unbase64url(value: string, length?: number): Bytes {
  if (typeof value !== "string" || /[^A-Za-z0-9_-]/.test(value) || value.length % 4 === 1) {
    throw new Error("Invalid base64url");
  }
  const data = new Uint8Array(Math.floor(value.length * 6 / 8));
  if (length !== undefined && data.length !== length) throw new Error("Invalid byte length");
  let bits = 0;
  let count = 0;
  let offset = 0;
  for (const digit of value) {
    bits = (bits << 6) | alphabet.indexOf(digit);
    count += 6;
    if (count >= 8) {
      count -= 8;
      data[offset++] = bits >>> count;
    }
  }
  if ((bits & ((1 << count) - 1)) !== 0) throw new Error("Noncanonical base64url");
  return data;
}

function validate(value: unknown, ancestors: Set<object>) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0)) return;
  if (typeof value !== "object" || ancestors.has(value)) throw new Error("Invalid JSON value");
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error("Invalid JSON object");
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) validate(item, ancestors);
  } else {
    for (const item of Object.values(value)) validate(item, ancestors);
  }
  ancestors.delete(value);
}

export function canonical(value: unknown): Bytes {
  validate(value, new Set());
  const json = canonicalize(value);
  if (typeof json !== "string") throw new Error("Invalid JSON");
  return new TextEncoder().encode(json);
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

export function parseCanonical(bytes: Uint8Array): Json {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const result = JSON.parse(text) as Json;
  // Comparing the original encoding also rejects duplicate names and a BOM.
  if (!equal(bytes, canonical(result))) throw new Error("Noncanonical JSON");
  return result;
}

function bucket(length: number) {
  if (length < 1 || length > bucketMax - 4) throw new Error("Invalid plaintext length");
  return Math.max(bucketMin, 2 ** Math.ceil(Math.log2(length + 4)));
}

export function pad(body: Json): Bytes {
  const payload = canonical(body);
  const result = new Uint8Array(bucket(payload.length));
  new DataView(result.buffer).setUint32(0, payload.length);
  result.set(payload, 4);
  return result;
}

export function unpad(bytes: Uint8Array): Json {
  if (bytes.length < bucketMin || bytes.length > bucketMax) throw new Error("Invalid bucket");
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (bucket(size) !== bytes.length || bytes.subarray(4 + size).some(byte => byte !== 0)) {
    throw new Error("Invalid padding");
  }
  return parseCanonical(bytes.subarray(4, 4 + size));
}
