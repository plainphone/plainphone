// SPDX-License-Identifier: Apache-2.0
import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 as NobleKem } from "@hpke/dhkem-x25519";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base64url, canonical, equal, pad, parseCanonical, unbase64url, unpad } from "./encoding.ts";
import type { Bytes, Json, JsonObject } from "./encoding.ts";
export { base64url, canonical, pad, parseCanonical, unbase64url, unpad };
export type { Bytes, Json, JsonObject };
export { hasSelfScope, rulesRejection, selfBaseRejection } from "./context.ts";

type Backend = "native" | "noble";
type Signer = Bytes | CryptoKey;

export type RecordWire = { header: JsonObject; nonce: string; ct: string; sig: string };
export type Envelope = { header: JsonObject; enc: string; ct: string; sig: string };
export type LogHead = { householdId: string; seq: number; head: string };

const pkcs8Prefix = Uint8Array.of(0x30, 0x2e, 2, 1, 0, 0x30, 5, 6, 3, 0x2b, 0x65, 0x70, 4, 0x22, 4, 0x20);
const empty = new Uint8Array(0);
const scalarLE = (bytes: Uint8Array) => bytes.reduceRight((n, b) => n * 256n + BigInt(b), 0n);
const concat = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};
const exactFields = (object: object, keys: string[]) => {
  const actual = Object.keys(object);
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(object, key))) {
    throw new Error("Unexpected wire fields");
  }
};
const uuid = (value: Json | undefined): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);
const revision = (value: Json | undefined): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const logFields = new Map<string, string[]>([
  ["genesis", ["deviceId", "userId", "signPub", "kemPub"]],
  ["device.add", ["deviceId", "userId", "signPub", "kemPub", "role", "scope", "relationship", "selfPhoneIds"]],
  ["device.grant-self", ["deviceId", "phoneId"]],
  ["device.remove", ["deviceId"]],
  ["phone.add", ["phoneId", "profile", "ownerUserId", "ownerPrincipalId", "deviceId", "signPub", "kemPub"]],
  ["phone.remove", ["phoneId"]],
  ["keys.rotate", []],
]);

function logPayload(type: Json | undefined, data: Json | undefined, epochs: Json | undefined) {
  const fields = typeof type === "string" ? logFields.get(type) : undefined;
  if (!fields || !data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(epochs)) {
    throw new Error("Invalid log payload");
  }
  exactFields(data, fields);
  let previous = "";
  for (const entry of epochs) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid epoch entry");
    exactFields(entry, ["scope", "phoneId", "epoch", "keyHash"]);
    const { scope, phoneId, epoch, keyHash } = entry;
    if ((scope !== "H" && scope !== "L" && scope !== "R")
      || (scope === "H" ? phoneId !== null : !uuid(phoneId))
      || !revision(epoch) || typeof keyHash !== "string") throw new Error("Invalid epoch entry");
    unbase64url(keyHash, 32);
    const order = scope + (phoneId ?? "");
    if (order <= previous) throw new Error("Unordered or duplicate epochs");
    previous = order;
  }
}

function envelopeHeader(header: JsonObject) {
  const { v, householdId, phoneId, scope, epoch, recipientDeviceId, rosterHead, signerDeviceId, changeId } = header;
  const fields = ["v", "householdId", "phoneId", "scope", "epoch", "recipientDeviceId", "rosterHead", "signerDeviceId"];
  exactFields(header, scope === "change" ? [...fields, "changeId"] : fields);
  if (v !== 1 || !uuid(householdId) || !uuid(signerDeviceId) || !uuid(recipientDeviceId)
    || !revision(epoch) || typeof rosterHead !== "string"
    || (scope === "H" ? phoneId !== null : !uuid(phoneId))
    || (scope !== "H" && scope !== "R" && scope !== "L" && scope !== "change")
    || (scope === "change" && !uuid(changeId))) throw new Error("Invalid envelope header");
  unbase64url(rosterHead, 32);
}

export class CryptoCore {
  private readonly suite: CipherSuite;
  private readonly signing: Backend;

  constructor(hpke: Backend = "native", signing: Backend = "native") {
    this.signing = signing;
    this.suite = new CipherSuite({
      kem: hpke === "native" ? new DhkemX25519HkdfSha256() : new NobleKem(),
      kdf: new HkdfSha256(),
      aead: new Aes256Gcm(),
    });
  }

  domain(purpose: string, value: Json): Bytes {
    return canonical(["plainphone", 1, purpose, value]);
  }

  canonical = canonical;
  parseCanonical = parseCanonical;
  base64url = base64url;
  unbase64url = unbase64url;
  pad = pad;
  unpad = unpad;

  async sha256(input: Bytes): Promise<Bytes> {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  }

  async hmac(key: Bytes, input: Bytes): Promise<Bytes> {
    const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", imported, input));
  }

  async hmacVerify(key: Bytes, input: Bytes, tag: Bytes): Promise<boolean> {
    if (tag.length !== 32) return false;
    // Compare in fixed time here instead of trusting each WebCrypto provider's verify (Expo and React
    // Native providers may sign and then compare with an early exit).
    const expected = await this.hmac(key, input);
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i]! ^ tag[i]!;
    return diff === 0;
  }

  async hkdf(ikm: Bytes, salt: Bytes, info: Bytes, length: number): Promise<Bytes> {
    if (!Number.isInteger(length) || length < 1 || length > 255 * 32) throw new Error("Invalid HKDF length");
    const imported = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, imported, length * 8));
  }

  async sign(signer: Signer, message: Bytes): Promise<Bytes> {
    if (signer instanceof Uint8Array && signer.length !== 32) throw new Error("Invalid signing seed");
    if (this.signing === "noble") {
      if (!(signer instanceof Uint8Array)) throw new Error("Expected a signing seed");
      return ed25519.sign(message, signer);
    }
    const key = signer instanceof Uint8Array
      ? await crypto.subtle.importKey("pkcs8", concat(pkcs8Prefix, signer), "Ed25519", false, ["sign"])
      : signer;
    if (key.algorithm.name !== "Ed25519") throw new Error("Expected an Ed25519 key");
    return new Uint8Array(await crypto.subtle.sign("Ed25519", key, message));
  }

  async verify(publicKey: Bytes, message: Bytes, signature: Bytes): Promise<boolean> {
    if (publicKey.length !== 32 || signature.length !== 64) return false;
    const r = signature.subarray(0, 32);
    const s = scalarLE(signature.subarray(32));
    const point = ed25519.Point;
    const order = point.Fn.ORDER;
    if (s >= order) return false;
    let a: ReturnType<typeof point.fromBytes>;
    let decodedR: ReturnType<typeof point.fromBytes>;
    try {
      a = point.fromBytes(publicKey, false);
      decodedR = point.fromBytes(r, false);
    } catch {
      return false;
    }
    if (a.isSmallOrder() || decodedR.isSmallOrder()) return false;
    const digest = await crypto.subtle.digest("SHA-512", concat(r, publicKey, message));
    const k = scalarLE(new Uint8Array(digest)) % order;
    // Noble's verify options both use a cofactored equation.
    return point.BASE.multiplyUnsafe(s).equals(decodedR.add(a.multiplyUnsafe(k)));
  }

  async hpkeSeal(publicKey: Bytes | CryptoKey, info: Bytes, plaintext: Bytes, aad = empty) {
    const recipientPublicKey = publicKey instanceof Uint8Array
      ? await this.suite.kem.deserializePublicKey(publicKey)
      : publicKey;
    const sender = await this.suite.createSenderContext({ recipientPublicKey, info });
    return { enc: new Uint8Array(sender.enc), ct: new Uint8Array(await sender.seal(plaintext, aad)) };
  }

  async hpkeOpen(privateKey: Bytes | CryptoKey, publicKey: Bytes | CryptoKey, info: Bytes,
                 enc: Bytes, ct: Bytes, aad = empty): Promise<Bytes> {
    const recipientKey = {
      privateKey: privateKey instanceof Uint8Array ? await this.suite.kem.deserializePrivateKey(privateKey) : privateKey,
      publicKey: publicKey instanceof Uint8Array ? await this.suite.kem.deserializePublicKey(publicKey) : publicKey,
    };
    const receiver = await this.suite.createRecipientContext({ recipientKey, enc, info });
    return new Uint8Array(await receiver.open(ct, aad));
  }

  async encrypt(key: Bytes, nonce: Bytes, aad: Bytes, plaintext: Bytes): Promise<Bytes> {
    if (key.length !== 32 || nonce.length !== 12) throw new Error("Invalid AES-GCM key or nonce");
    const imported = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
    return new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, imported, plaintext));
  }

  async decrypt(key: Bytes, nonce: Bytes, aad: Bytes, ciphertext: Bytes): Promise<Bytes> {
    if (key.length !== 32 || nonce.length !== 12) throw new Error("Invalid AES-GCM key or nonce");
    const imported = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, imported, ciphertext));
  }

  async signObject<T extends JsonObject>(purpose: string, body: T, signer: Signer): Promise<T & { sig: string }> {
    if (Object.hasOwn(body, "sig")) throw new Error("Unexpected sig in unsigned object");
    const snapshot = parseCanonical(canonical(body)) as T;
    return { ...snapshot, sig: base64url(await this.sign(signer, this.domain(purpose, snapshot))) };
  }

  async verifyObject(purpose: string, wire: JsonObject, signer: Bytes) {
    const { sig, ...unsigned } = wire;
    if (typeof sig !== "string" || !await this.verify(signer, this.domain(purpose, unsigned), unbase64url(sig, 64))) {
      throw new Error("Invalid signature");
    }
  }

  async sealRecord(header: JsonObject, body: Json, key: Bytes, signer: Signer): Promise<RecordWire> {
    const context = parseCanonical(canonical(header)) as JsonObject;
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ct = await this.encrypt(key, nonce, this.domain("blob", context), pad(body));
    return this.signObject("record", { header: context, nonce: base64url(nonce), ct: base64url(ct) }, signer);
  }

  /** The caller supplies the full header and signer authorized by local state. */
  async openRecord(wire: RecordWire, expected: JsonObject, signer: Bytes, key: Bytes): Promise<Json> {
    exactFields(wire, ["header", "nonce", "ct", "sig"]);
    if (!equal(canonical(wire.header), canonical(expected))) throw new Error("Record context mismatch");
    if (wire.ct.length > Math.ceil((4 * 1024 * 1024 + 16) * 4 / 3)) throw new Error("Record too large");
    const nonce = unbase64url(wire.nonce, 12);
    const ct = unbase64url(wire.ct);
    const aad = this.domain("blob", expected);
    await this.verifyObject("record", wire, signer);
    return unpad(await this.decrypt(key, nonce, aad, ct));
  }

  async sealEnvelope(header: JsonObject, key: Bytes, recipient: Bytes | CryptoKey, signer: Signer): Promise<Envelope> {
    const context = parseCanonical(canonical(header)) as JsonObject;
    envelopeHeader(context);
    if (key.length !== 32) throw new Error("Invalid envelope key length");
    const { enc, ct } = await this.hpkeSeal(recipient, this.domain("key-envelope", context), key);
    return this.signObject("key-envelope", { header: context, enc: base64url(enc), ct: base64url(ct) }, signer);
  }

  /** Resolve both heads' permissions before providing expected context and signer. */
  async openEnvelope(wire: Envelope, expected: JsonObject, signer: Bytes,
                     privateKey: Bytes | CryptoKey, publicKey: Bytes | CryptoKey, commitment?: string) {
    exactFields(wire, ["header", "enc", "ct", "sig"]);
    envelopeHeader(expected);
    if (!equal(canonical(wire.header), canonical(expected))) throw new Error("Envelope context mismatch");
    const enc = unbase64url(wire.enc, 32);
    const ct = unbase64url(wire.ct, 48);
    const info = this.domain("key-envelope", expected);
    const { scope, phoneId, epoch } = expected;
    await this.verifyObject("key-envelope", wire, signer);
    const key = await this.hpkeOpen(privateKey, publicKey, info, enc, ct);
    if (scope !== "change") {
      const actual = base64url(await this.sha256(this.domain("scope-key", { scope: scope!, phoneId: phoneId!,
        epoch: epoch!, key: base64url(key) })));
      if (actual !== commitment) throw new Error("Scope commitment mismatch");
    }
    return key;
  }

  async signLog(post: JsonObject, signer: Signer) {
    return this.signObject("log", post, signer);
  }

  /** This checks chain linkage and signature. The caller applies roster transition rules. */
  async verifyLog(post: JsonObject, previous: LogHead | null, signer: Bytes): Promise<LogHead> {
    exactFields(post, ["v", "householdId", "seq", "prevHash", "type", "data", "epochs", "signerDeviceId", "sig"]);
    const { v, householdId, seq, prevHash, type, signerDeviceId } = post;
    if (v !== 1 || !uuid(householdId) || !uuid(signerDeviceId) || typeof seq !== "number"
      || !Number.isSafeInteger(seq) || seq !== (previous ? previous.seq + 1 : 0)
      || (previous ? householdId !== previous.householdId || prevHash !== previous.head || type === "genesis"
        : prevHash !== null || type !== "genesis")) throw new Error("Invalid log link");
    logPayload(type, post.data, post.epochs);
    if (!previous) {
      const genesis = post.data as JsonObject;
      if (genesis.deviceId !== signerDeviceId || genesis.signPub !== base64url(signer)) {
        throw new Error("Genesis signer mismatch");
      }
    }
    const headInput = this.domain("log-head", post);
    await this.verifyObject("log", post, signer);
    return { householdId, seq, head: base64url(await this.sha256(headInput)) };
  }
}
