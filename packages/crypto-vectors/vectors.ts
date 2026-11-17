// SPDX-License-Identifier: Apache-2.0
// Public, deterministic fixtures only. Never use these keys, seeds or nonces for live data.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 as FallbackKem } from "@hpke/dhkem-x25519";
import { ed25519 } from "@noble/curves/ed25519.js";
import canonicalize from "canonicalize";

const { subtle } = webcrypto;
const utf8 = (value: string) => Buffer.from(value, "utf8");
const hex = (value: string) => Buffer.from(value, "hex");
const b64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(new Uint8Array(bytes)).toString("base64url");
function encode(value: unknown) {
  const canonical = canonicalize(value);
  assert.equal(typeof canonical, "string");
  return utf8(canonical as string);
}
const hash = (value: Uint8Array<ArrayBuffer>) => subtle.digest("SHA-256", value);
const domain = (purpose: string, value: unknown) => encode(["plainphone", 1, purpose, value]);
const suite = new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
const fallback = new CipherSuite({ kem: new FallbackKem(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });

const householdId = "00000000-0000-4000-8000-000000000001";
const phoneId = "00000000-0000-4000-8000-000000000002";
const signerDeviceId = "00000000-0000-4000-8000-000000000003";
const recipientDeviceId = "00000000-0000-4000-8000-000000000004";
const commandIdPrefix = "00000000-0000-4000-8000-00000000000";

const signSeed = hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
const signPub = ed25519.getPublicKey(signSeed);
const signingKey = await subtle.importKey("pkcs8", Buffer.concat([
  hex("302e020100300506032b657004220420"), signSeed,
]), "Ed25519", false, ["sign"]);
const verifyKey = await subtle.importKey("raw", signPub, "Ed25519", false, ["verify"]);

async function signed(purpose: string, body: object) {
  const input = domain(purpose, body);
  const sig = await subtle.sign("Ed25519", signingKey, input);
  assert(await subtle.verify("Ed25519", verifyKey, sig, input));
  assert(ed25519.verify(new Uint8Array(sig), input, signPub, { zip215: false }));
  assert(!(await subtle.verify("Ed25519", verifyKey, sig, domain(purpose + "-other", body))));
  return { wire: { ...body, sig: b64(sig) }, signInput: b64(input) };
}

async function mac(key: Uint8Array<ArrayBuffer>, message: Uint8Array<ArrayBuffer>) {
  const imported = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return subtle.sign("HMAC", imported, message);
}

async function hkdf(ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number,
                    salt = Buffer.alloc(32)) {
  const key = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
}

const hmacKey = Buffer.alloc(20, 0x0b);
const hmacMessage = utf8("Hi There");
const hmacTag = await mac(hmacKey, hmacMessage);
assert.equal(b64(hmacTag), b64(hex("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7")));

const shaDigest = await hash(utf8("abc"));
assert.equal(b64(shaDigest), b64(hex("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")));

const hkdfIkm = Buffer.alloc(22, 0x0b);
const hkdfSalt = hex("000102030405060708090a0b0c");
const hkdfInfo = hex("f0f1f2f3f4f5f6f7f8f9");
const hkdfOutput = await hkdf(hkdfIkm, hkdfInfo, 42, hkdfSalt);
assert.equal(b64(hkdfOutput), b64(hex("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865")));

const rKey = Buffer.alloc(32, 0x21);
const lKey = Buffer.alloc(32, 0x22);
const hKey = Buffer.alloc(32, 0x23);
const signerKem = await suite.kem.deriveKeyPair(Buffer.alloc(32, 0x31));
const receiverIkm = Buffer.alloc(32, 0x32);
const receiver = await suite.kem.deriveKeyPair(receiverIkm);
const receiverPub = await suite.kem.serializePublicKey(receiver.publicKey);
const receiverSignSeed = Buffer.alloc(32, 0x33);
const receiverSignPub = ed25519.getPublicKey(receiverSignSeed);

async function keyEpoch(scope: string, id: string | null, key: Buffer<ArrayBuffer>) {
  return { scope, phoneId: id, epoch: 1, keyHash: b64(await hash(key)) };
}

async function log(seq: number, prevHash: string | null, type: string, data: object, epochs: object[]) {
  const entry = await signed("log", { v: 1, householdId, seq, prevHash, type, data, epochs, signerDeviceId });
  const head = b64(await hash(domain("log-head", entry.wire)));
  return { ...entry, head };
}
const genesis = await log(0, null, "genesis", {
  deviceId: signerDeviceId, userId: "00000000-0000-4000-8000-000000000006",
  signPub: b64(signPub), kemPub: b64(await suite.kem.serializePublicKey(signerKem.publicKey)),
}, [await keyEpoch("H", null, hKey)]);
const enrolled = await log(1, genesis.head, "phone.add", {
  phoneId, profile: "child", ownerUserId: null, deviceId: recipientDeviceId, signPub: b64(receiverSignPub), kemPub: b64(receiverPub),
}, [await keyEpoch("L", phoneId, lKey), await keyEpoch("R", phoneId, rKey)]);
const rosterHead = enrolled.head;

async function hpke(info: Buffer<ArrayBuffer>, aad: Buffer<ArrayBuffer>, plaintext: Buffer<ArrayBuffer>,
                    ikm: Buffer<ArrayBuffer>, ikmE: Buffer<ArrayBuffer>) {
  const recipient = await suite.kem.deriveKeyPair(ikm);
  const sender = await suite.createSenderContext({ recipientPublicKey: recipient.publicKey, info, ekm: ikmE });
  const ct = await sender.seal(plaintext, aad);
  assert.equal(sender.enc.byteLength, 32);
  const receiver = await suite.createRecipientContext({ recipientKey: recipient, enc: sender.enc, info });
  assert.equal(b64(await receiver.open(ct, aad)), b64(plaintext));
  const fallbackKeys = await fallback.kem.deriveKeyPair(ikm);
  const fallbackSender = await fallback.createSenderContext({
    recipientPublicKey: fallbackKeys.publicKey, info, ekm: ikmE,
  });
  assert.equal(b64(fallbackSender.enc), b64(sender.enc));
  assert.equal(b64(await fallbackSender.seal(plaintext, aad)), b64(ct));
  const fallbackReceiver = await fallback.createRecipientContext({
    recipientKey: fallbackKeys, enc: sender.enc, info,
  });
  assert.equal(b64(await fallbackReceiver.open(ct, aad)), b64(plaintext));
  const wrongContext = await suite.createRecipientContext({
    recipientKey: recipient, enc: sender.enc, info: Buffer.concat([info, utf8("wrong")]),
  });
  await assert.rejects(wrongContext.open(ct, aad));
  return {
    info: b64(info), aad: b64(aad), plaintext: b64(plaintext), ikm: b64(ikm), ikmE: b64(ikmE),
    recipientPrivateKey: b64(await suite.kem.serializePrivateKey(recipient.privateKey)),
    recipientPublicKey: b64(await suite.kem.serializePublicKey(recipient.publicKey)),
    enc: b64(sender.enc), ct: b64(ct),
  };
}

const rfcHpke = await hpke(
  hex("4f6465206f6e2061204772656369616e2055726e"), hex("436f756e742d30"),
  hex("4265617574792069732074727574682c20747275746820626561757479"),
  hex("dac33b0e9db1b59dbbea58d59a14e7b5896e9bdf98fad6891e99d1686492b9ee"),
  hex("2cd7c601cefb3d42a62b04b7a9041494c06c7843818e0ce28a8f704ae7ab20f9"),
);
assert.equal(rfcHpke.enc, b64(hex("6c93e09869df3402d7bf231bf540fadd35cd56be14f97178f0954db94b7fc256")));
assert.equal(rfcHpke.ct, b64(hex("e5d84cd531cfb583096e7cfa9641bd3079cf3a91cda813c52deb5f512be9931980a41de125a925cdad859d5b7a")));
const emptySig = await subtle.sign("Ed25519", signingKey, Buffer.alloc(0));
assert.equal(b64(ed25519.sign(Buffer.alloc(0), signSeed)), b64(emptySig));
assert.equal(b64(emptySig), b64(hex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")));

async function aead(key: Buffer<ArrayBuffer>, nonce: Buffer<ArrayBuffer>, aad: Buffer<ArrayBuffer>, plaintext: Buffer<ArrayBuffer>) {
  const aes = await subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
  const params = { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 };
  const ct = await subtle.encrypt(params, aes, plaintext);
  assert.equal(b64(await subtle.decrypt(params, aes, ct)), b64(plaintext));
  await assert.rejects(subtle.decrypt({ ...params, additionalData: utf8("wrong") }, aes, ct));
  const tampered = new Uint8Array(ct.slice(0));
  tampered[0] = tampered[0]! ^ 1;
  await assert.rejects(subtle.decrypt(params, aes, tampered));
  return { key: b64(key), nonce: b64(nonce), aad: b64(aad), plaintext: b64(plaintext), ct: b64(ct) };
}

const aesGcm = await aead(Buffer.alloc(32), Buffer.alloc(12), Buffer.alloc(0), Buffer.alloc(16));
assert.equal(aesGcm.ct, b64(hex("cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919")));

async function encrypted(header: object, body: object, key: Buffer<ArrayBuffer>, nonceByte: number) {
  const payload = encode(body);
  const padded = Buffer.alloc(Math.max(256, 2 ** Math.ceil(Math.log2(payload.length + 4))));
  padded.writeUInt32BE(payload.length);
  payload.copy(padded, 4);
  const encryption = await aead(key, Buffer.alloc(12, nonceByte), domain("blob", header), padded);
  const signature = await signed("record", { header, nonce: encryption.nonce, ct: encryption.ct });
  return { ...signature, body, encryption };
}

const envelopeHeader = { v: 1, householdId, phoneId, scope: "R", epoch: 1, recipientDeviceId, rosterHead, signerDeviceId };
const envelopeCrypto = await hpke(domain("key-envelope", envelopeHeader), Buffer.alloc(0), rKey,
  receiverIkm, Buffer.alloc(32, 0x34));
const envelope = await signed("key-envelope", { header: envelopeHeader, enc: envelopeCrypto.enc, ct: envelopeCrypto.ct });

const common = { v: 1, householdId, phoneId, epoch: 1, version: 1, rosterHead, signerDeviceId };
const rules = await encrypted({ ...common, table: "phone_state", scope: "R", recordId: phoneId },
  { schema: 1, rules: { timezone: "Etc/UTC", contacts: [], locationMode: "off" } }, rKey, 0x41);
const now = 1794948000000;
const commands = [];
for (const [index, body] of ([
  { kind: "locate" }, { kind: "ring", stopAfter: 30 }, { kind: "okay", deadline: now + 600000 },
  { kind: "release" },
] as const).entries()) {
  const scope = body.kind === "release" ? "R" : "L";
  commands.push(await encrypted({
    ...common, table: "commands", recordId: commandIdPrefix + (index + 5),
    scope, issuedAt: now, expiresAt: now + 120000,
  }, body, scope === "R" ? rKey : lKey, 0x42 + index));
}

const secret = Buffer.alloc(16, 0x51);
const enrollment = { householdId, phoneId, profile: "child", ownerUserId: null, rosterHead: genesis.head, deviceId: recipientDeviceId,
  signPub: b64(receiverSignPub), kemPub: b64(receiverPub) };
const enrollmentBytes = domain("enroll", enrollment);
const pairing = { householdId, phoneId, profile: "child", ownerUserId: null, rosterHead: genesis.head,
  pairingId: "00000000-0000-4000-8000-000000000010" };
const pairingBytes = domain("pair-context", pairing);
const recoverySeed = Buffer.alloc(16);
const recoverySignInfo = domain("recovery", { householdId, use: "sign" });
const recoveryKemInfo = domain("recovery", { householdId, use: "kem" });
const recoverySign = await hkdf(recoverySeed, recoverySignInfo, 32);
const recoveryKem = await hkdf(recoverySeed, recoveryKemInfo, 32);
const recoveryKeys = await suite.kem.deriveKeyPair(new Uint8Array(recoveryKem));
const dedupeInfo = domain("dedupe-key", { householdId, phoneId, epoch: 1 });
const dedupeKey = await hkdf(rKey, dedupeInfo, 32);
const dedupeInput = domain("dedupe", { kind: "app", value: "org.example.fixture" });
const dnsHeader = { v: 1, householdId, phoneId, clientId: "fixture", revision: 1,
  ppdnsKeyId: b64(await hash(new Uint8Array(receiverPub))) };
const dns = await hpke(domain("dns-config", dnsHeader), Buffer.alloc(0),
  encode({ allowDomains: ["example.test"], blockDomains: [], blockedCategories: [] }),
  receiverIkm, Buffer.alloc(32, 0x35));

const canonicalInput = { "€": "e\u0301", "😀": "\n", z: [3, null, true], a: "é" };
assert.equal(encode(canonicalInput).toString(), '{"a":"é","z":[3,null,true],"€":"é","😀":"\\n"}');

const fixtures = {
  primitives: {
    encoding: { input: canonicalInput, expected: b64(encode(canonicalInput)) },
    sha256: { input: b64(utf8("abc")), digest: b64(shaDigest) },
    hmacSha256: { key: b64(hmacKey), input: b64(hmacMessage), tag: b64(hmacTag) },
    hkdfSha256: { ikm: b64(hkdfIkm), salt: b64(hkdfSalt), info: b64(hkdfInfo),
      length: 42, okm: b64(hkdfOutput) },
    ed25519: { seed: b64(signSeed), publicKey: b64(signPub), message: "", signature: b64(emptySig) },
    aesGcm, hpke: rfcHpke,
  },
  protocol: {
    signing: { seed: b64(signSeed), publicKey: b64(signPub) },
    log: [genesis, enrolled], envelope: { ...envelope, hpke: envelopeCrypto },
    rules, commands,
    enrollment: { secret: b64(secret), fields: enrollment, input: b64(enrollmentBytes),
      mac: b64(await mac(secret, enrollmentBytes)) },
    pairing: { secret: b64(secret), fields: pairing, input: b64(pairingBytes),
      mac: b64(await mac(secret, pairingBytes)) },
    recovery: { householdId, seed: b64(recoverySeed), code: "PP-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA",
      signInfo: b64(recoverySignInfo), kemInfo: b64(recoveryKemInfo), signingSeed: b64(recoverySign),
      signPub: b64(ed25519.getPublicKey(new Uint8Array(recoverySign))), kemIkm: b64(recoveryKem),
      kemPub: b64(await suite.kem.serializePublicKey(recoveryKeys.publicKey)) },
    dedupe: { rKey: b64(rKey), info: b64(dedupeInfo), key: b64(dedupeKey), input: b64(dedupeInput),
      tag: b64(await mac(new Uint8Array(dedupeKey), dedupeInput)) },
    dns: { wire: { header: dnsHeader, enc: dns.enc, ct: dns.ct }, hpke: dns },
  },
};

// Derive new fixtures and compare to the checked-in bytes. A wire change requires an explicit rewrite.
for (const [name, fixture] of Object.entries(fixtures)) {
  const file = new URL(`../../docs/encryption-test-vectors/${name}.json`, import.meta.url);
  const output = JSON.stringify(fixture, null, 2) + "\n";
  if (process.argv[2] === "--write") writeFileSync(file, output);
  else assert.deepEqual(fixture, JSON.parse(readFileSync(file, "utf8")), `${name}.json drifted`);
}
console.log("Plainphone vectors verified (native and fallback HPKE, RFC known answers, protocol fixtures)");
