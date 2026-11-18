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
const ownerUserId = "00000000-0000-4000-8000-000000000006";
const recipientDeviceId = "00000000-0000-4000-8000-000000000004";
const commandIdPrefix = "00000000-0000-4000-8000-00000000000";

const scalarLE = (bytes: Uint8Array) => BigInt("0x" + Buffer.from(bytes).reverse().toString("hex"));

const signSeed = hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
const signPub = ed25519.getPublicKey(signSeed);
const signingKey = await subtle.importKey("pkcs8", Buffer.concat([
  hex("302e020100300506032b657004220420"), signSeed,
]), "Ed25519", false, ["sign"]);
const verifyKey = await subtle.importKey("raw", signPub, "Ed25519", false, ["verify"]);

async function verifyStrict(sig: Uint8Array, input: Buffer<ArrayBuffer>, pub: Uint8Array) {
  if (sig.length !== 64 || pub.length !== 32) return false;
  const r = sig.subarray(0, 32);
  const order = ed25519.Point.Fn.ORDER;
  const s = scalarLE(sig.subarray(32));
  if (s >= order) return false;
  try {
    const a = ed25519.Point.fromBytes(pub, false);
    const pointR = ed25519.Point.fromBytes(r, false);
    if (a.isSmallOrder() || pointR.isSmallOrder()) return false;
    const digest = await subtle.digest("SHA-512", Buffer.concat([r, pub, input]));
    const k = scalarLE(new Uint8Array(digest)) % order;
    return ed25519.Point.BASE.multiplyUnsafe(s).equals(pointR.add(a.multiplyUnsafe(k)));
  } catch {
    return false;
  }
}

async function signed<T extends object>(purpose: string, body: T, seed?: Buffer<ArrayBuffer>) {
  const input = domain(purpose, body);
  const sig = seed ? ed25519.sign(input, seed) : new Uint8Array(await subtle.sign("Ed25519", signingKey, input));
  const pub = seed ? ed25519.getPublicKey(seed) : signPub;
  assert(await verifyStrict(sig, input, pub));
  assert(!(await verifyStrict(sig, domain(purpose + "-other", body), pub)));
  if (!seed) assert(await subtle.verify("Ed25519", verifyKey, sig, input));
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

async function keyEpoch(scope: string, id: string | null, key: Buffer<ArrayBuffer>, epoch = 1) {
  return { scope, phoneId: id, epoch, keyHash: b64(await hash(domain("scope-key", { scope, phoneId: id, epoch, key: b64(key) }))) };
}

async function log<T extends object>(seq: number, prevHash: string | null, type: string, data: T, epochs: object[]) {
  const entry = await signed("log", { v: 1, householdId, seq, prevHash, type, data, epochs, signerDeviceId });
  const head = b64(await hash(domain("log-head", entry.wire)));
  return { ...entry, head };
}
const genesis = await log(0, null, "genesis", {
  deviceId: signerDeviceId, userId: ownerUserId,
  signPub: b64(signPub), kemPub: b64(await suite.kem.serializePublicKey(signerKem.publicKey)),
}, [await keyEpoch("H", null, hKey)]);
const enrolled = await log(1, genesis.head, "phone.add", {
  phoneId, profile: "self", ownerUserId, ownerPrincipalId: signerDeviceId, deviceId: recipientDeviceId, signPub: b64(receiverSignPub), kemPub: b64(receiverPub),
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

function pad(body: object) {
  const payload = encode(body);
  const padded = Buffer.alloc(Math.max(256, 2 ** Math.ceil(Math.log2(payload.length + 4))));
  padded.writeUInt32BE(payload.length);
  payload.copy(padded, 4);
  return padded;
}

async function encrypted<H extends object, T extends object>(
  header: H, body: T, key: Buffer<ArrayBuffer>, nonceByte: number, seed?: Buffer<ArrayBuffer>,
) {
  const padded = pad(body);
  const encryption = await aead(key, Buffer.alloc(12, nonceByte), domain("blob", header), padded);
  const signature = await signed("record", { header, nonce: encryption.nonce, ct: encryption.ct }, seed);
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

const releaseCommandId = commandIdPrefix + "8";
const trustedDeviceId = "00000000-0000-4000-8000-000000000011";
const trustedUserId = "00000000-0000-4000-8000-000000000012";
const trustedSeed = Buffer.alloc(32, 0x61);
const trustedSignPub = ed25519.getPublicKey(trustedSeed);
const trustedIkm = Buffer.alloc(32, 0x62);
const trustedKem = await suite.kem.deriveKeyPair(trustedIkm);
const trusted = await log(2, enrolled.head, "device.add", {
  deviceId: trustedDeviceId, userId: trustedUserId, signPub: b64(trustedSignPub),
  kemPub: b64(await suite.kem.serializePublicKey(trustedKem.publicKey)), role: "trusted", scope: [], relationship: "other", selfPhoneIds: [phoneId],
}, []);
const coParentKem = await suite.kem.deriveKeyPair(Buffer.alloc(32, 0x7e));
const coParentKemPub = await suite.kem.serializePublicKey(coParentKem.publicKey);
// This signed admission is on a separate valid branch. Matching the owner's
// account identifier does not make the other person's device an owner.
const coParent = await log(3, trusted.head, "device.add", {
  deviceId: "00000000-0000-4000-8000-000000000019", userId: ownerUserId,
  signPub: b64(ed25519.getPublicKey(Buffer.alloc(32, 0x7d))), kemPub: b64(coParentKemPub),
  role: "admin", scope: "*", relationship: "other", selfPhoneIds: [] as string[],
}, []);
const coParentPrincipal = coParent.wire.data.relationship === "other"
  ? coParent.wire.data.deviceId : signerDeviceId;
assert.notEqual(coParentPrincipal, enrolled.wire.data.ownerPrincipalId);
assert(!coParent.wire.data.selfPhoneIds.includes(phoneId));

const adminDeviceId = "00000000-0000-4000-8000-000000000014";
const adminIkm = Buffer.alloc(32, 0x66);
const adminKem = await suite.kem.deriveKeyPair(adminIkm);
const admin = await log(3, trusted.head, "device.add", {
  deviceId: adminDeviceId, userId: ownerUserId,
  signPub: b64(ed25519.getPublicKey(Buffer.alloc(32, 0x67))),
  kemPub: b64(await suite.kem.serializePublicKey(adminKem.publicKey)), role: "admin", scope: "*", relationship: "own", selfPhoneIds: [phoneId],
}, []);
const rKey2 = Buffer.alloc(32, 0x6a);
const lKey2 = Buffer.alloc(32, 0x69);
const removed = await log(4, admin.head, "device.remove", { deviceId: adminDeviceId }, [
  await keyEpoch("H", null, Buffer.alloc(32, 0x68), 2),
  await keyEpoch("L", phoneId, lKey2, 2),
  await keyEpoch("R", phoneId, rKey2, 2),
]);
commands[3] = await encrypted({
  ...common, epoch: 2, rosterHead: removed.head, table: "commands",
  scope: "R", recordId: releaseCommandId, issuedAt: now, expiresAt: now + 120000,
}, { kind: "release" }, rKey2, 0x45);
const releaseAck = await encrypted({
  ...common, epoch: 2, rosterHead: removed.head, table: "phone_reports", scope: "R", recordId: releaseCommandId,
  signerDeviceId: recipientDeviceId,
}, { kind: "release-ack", commandId: releaseCommandId }, rKey2, 0x46, receiverSignSeed);

const ruleHeader2 = { ...common, epoch: 2, version: 2, rosterHead: removed.head,
  table: "phone_state", scope: "R", recordId: phoneId };
const basePolicyBody = {
  ...rules.body,
  rules: { ...rules.body.rules, self: { delayMs: 3600000, trustedUserId, trustedDeviceIds: [trustedDeviceId] } },
};
const baseRules = await encrypted(ruleHeader2, basePolicyBody, rKey2, 0x41);
const baseRulesVersion = ruleHeader2.version;
const baseRulesDigest = b64(await hash(domain("rules-digest", baseRules.wire)));
const changeBody = {
  op: { kind: "setLocationMode", value: "onRequest" }, trustedUserId, baseRulesVersion,
  baseRulesDigest, effectiveAt: now + 3600000, expiresAt: now + 7200000,
};
const resultingRules = await encrypted({ ...ruleHeader2, version: 3 },
  { ...basePolicyBody, rules: { ...basePolicyBody.rules, locationMode: changeBody.op.value } }, rKey2, 0x42);

const changeId = "00000000-0000-4000-8000-000000000013";
const changeKey = Buffer.alloc(32, 0x63);
const change = await encrypted({
  ...common, epoch: 2, rosterHead: removed.head, table: "pending_changes", scope: "change", recordId: changeId,
}, changeBody, changeKey, 0x64);
const changeEnvelopeHeader = {
  ...envelopeHeader, epoch: 2, scope: "change", changeId, rosterHead: removed.head, recipientDeviceId: trustedDeviceId,
};
const changeHpke = await hpke(domain("key-envelope", changeEnvelopeHeader), Buffer.alloc(0),
  changeKey, trustedIkm, Buffer.alloc(32, 0x65));
const changeEnvelope = await signed("key-envelope", {
  header: changeEnvelopeHeader, enc: changeHpke.enc, ct: changeHpke.ct,
});
const phoneChangeEnvelopeHeader = { ...changeEnvelopeHeader, recipientDeviceId };
const phoneChangeHPKE = await hpke(domain("key-envelope", phoneChangeEnvelopeHeader), Buffer.alloc(0),
  changeKey, receiverIkm, Buffer.alloc(32, 0x7c));
const phoneChangeEnvelope = await signed("key-envelope", {
  header: phoneChangeEnvelopeHeader, enc: phoneChangeHPKE.enc, ct: phoneChangeHPKE.ct,
});
const approvalBody = {
  v: 1, householdId, phoneId, changeId, rosterHead: removed.head, signerDeviceId: trustedDeviceId,
  recordHash: b64(await hash(domain("self-change", change.wire))),
  keyHash: b64(await hash(domain("self-change-key", b64(changeKey)))),
  baseRulesVersion, baseRulesDigest, expiresAt: changeBody.expiresAt,
};
const approvalInput = domain("self-approval", approvalBody);
const approvalSig = ed25519.sign(approvalInput, trustedSeed);
assert(ed25519.verify(approvalSig, approvalInput, trustedSignPub, { zip215: false }));
for (const changed of [
  { recordHash: b64(await hash(domain("self-change", { ...change.wire, nonce: b64(Buffer.alloc(12)) }))) },
  { keyHash: b64(await hash(domain("self-change-key", b64(rKey)))) },
  { baseRulesVersion: baseRulesVersion + 1 },
  { baseRulesDigest: b64(Buffer.alloc(32)) },
  { expiresAt: changeBody.expiresAt + 1 },
]) {
  assert(!ed25519.verify(approvalSig, domain("self-approval", { ...approvalBody, ...changed }),
    trustedSignPub, { zip215: false }));
}

const rotated = await log(5, removed.head, "keys.rotate", {}, [
  await keyEpoch("R", phoneId, Buffer.alloc(32, 0x6b), 3),
]);
const emergencySeed = Buffer.alloc(32, 0x70);
const emergencyIkm = Buffer.alloc(32, 0x71);
const emergencyKem = await suite.kem.deriveKeyPair(emergencyIkm);
const emergencyDeviceId = "00000000-0000-4000-8000-000000000015";
const emergency = await log(6, rotated.head, "device.add", {
  deviceId: emergencyDeviceId,
  userId: "00000000-0000-4000-8000-000000000016",
  signPub: b64(ed25519.getPublicKey(emergencySeed)),
  kemPub: b64(await suite.kem.serializePublicKey(emergencyKem.publicKey)),
  role: "emergency", scope: [], relationship: "other", selfPhoneIds: [phoneId],
}, []);

const emergencyRules = await encrypted({
  ...ruleHeader2, epoch: 3, version: 4, rosterHead: emergency.head,
}, { ...basePolicyBody, rules: { ...basePolicyBody.rules, locationMode: "onRequest" } },
Buffer.alloc(32, 0x6b), 0x43);
const findCommandId = "00000000-0000-4000-8000-000000000018";
const emergencyFind = await encrypted({
  ...common, epoch: 2, rosterHead: emergency.head, signerDeviceId: emergencyDeviceId,
  table: "commands", scope: "L", recordId: findCommandId, issuedAt: now, expiresAt: now + 120000,
}, { kind: "locate" }, lKey2, 0x7a, emergencySeed);
const resultHeader = {
  v: 1, householdId, phoneId, commandId: findCommandId, epoch: 2, rosterHead: emergency.head,
  signerDeviceId: recipientDeviceId, recipientDeviceId: emergencyDeviceId,
};
const resultBody = { latitudeE7: 0, longitudeE7: 0, accuracyMm: 5000, capturedAt: now + 1000 };
const resultHPKE = await hpke(domain("command-result", resultHeader), Buffer.alloc(0),
  pad(resultBody), emergencyIkm, Buffer.alloc(32, 0x7b));
const findResult = await signed("command-result", {
  header: resultHeader, enc: resultHPKE.enc, ct: resultHPKE.ct,
}, receiverSignSeed);

const secret = Buffer.alloc(16, 0x51);
const enrollment = { householdId, phoneId, profile: "self", ownerUserId, ownerPrincipalId: signerDeviceId, rosterHead: genesis.head, deviceId: recipientDeviceId,
  signPub: b64(receiverSignPub), kemPub: b64(receiverPub) };
const enrollmentBytes = domain("enroll", enrollment);
const pairing = { householdId, phoneId, profile: "self", ownerUserId, ownerPrincipalId: signerDeviceId, rosterHead: genesis.head,
  pairingId: "00000000-0000-4000-8000-000000000010" };
const pairingBytes = domain("pair-context", pairing);
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encodeRecoveryCode(seed: Buffer<ArrayBuffer>) {
  const bits = Array.from(seed, (byte) => byte.toString(2).padStart(8, "0")).join("").padEnd(130, "0");
  const symbols = bits.match(/.{5}/g)!.map((group) => base32Alphabet[Number.parseInt(group, 2)]).join("");
  return "PP-" + symbols.match(/.{1,4}/g)!.join("-");
}

function decodeRecoveryCode(code: string) {
  const normalized = code.replace(/[ \t\r\n-]/g, "").replace(/[a-z]/g, (letter) => letter.toUpperCase());
  assert.match(normalized, /^PP[A-Z2-7]{26}$/);
  const symbols = normalized.slice(2);
  const bits = Array.from(symbols, (symbol) => base32Alphabet.indexOf(symbol).toString(2).padStart(5, "0")).join("");
  assert.equal(bits.slice(128), "00");
  return Buffer.from(bits.slice(0, 128).match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)));
}

const recoverySeed = hex("0123456789abcdef1032547698badcfe");
const recoveryCode = encodeRecoveryCode(recoverySeed);
assert.equal(recoveryCode, "PP-AERU-KZ4J-VPG6-6EBS-KR3J-ROW4-7Y");
assert.deepEqual(decodeRecoveryCode(recoveryCode), recoverySeed);
assert.deepEqual(decodeRecoveryCode(" pp aeru kz4j vpg6 6ebs kr3j row4 7y\n"), recoverySeed);
assert.throws(() => decodeRecoveryCode(recoveryCode.replace("O", "0")));
assert.throws(() => decodeRecoveryCode(recoveryCode.replace("O", "1")));
assert.throws(() => decodeRecoveryCode(recoveryCode.slice(0, -1) + "Z"));
const decodedRecoverySeed = decodeRecoveryCode(recoveryCode);
const recoverySignInfo = domain("recovery", { householdId, use: "sign" });
const recoveryKemInfo = domain("recovery", { householdId, use: "kem" });
const recoverySign = await hkdf(decodedRecoverySeed, recoverySignInfo, 32);
const recoveryKem = await hkdf(decodedRecoverySeed, recoveryKemInfo, 32);
const recoveryKeys = await suite.kem.deriveKeyPair(new Uint8Array(recoveryKem));
const recovery = await log(7, emergency.head, "device.add", {
  deviceId: "00000000-0000-4000-8000-000000000017", userId: ownerUserId,
  signPub: b64(ed25519.getPublicKey(new Uint8Array(recoverySign))),
  kemPub: b64(await suite.kem.serializePublicKey(recoveryKeys.publicKey)),
  role: "recovery", scope: "*", relationship: "own", selfPhoneIds: [phoneId],
}, []);
const phoneRemoved = await log(8, recovery.head, "phone.remove", { phoneId }, []);

async function joinFingerprint({ deviceId, userId, signPub, kemPub }: typeof trustedData) {
  const fields = { v: 1, householdId, deviceId, userId, signPub, kemPub };
  const input = domain("join-device", fields);
  return { fields, input: b64(input), fingerprint: b64(await hash(input)) };
}

const trustedData = {
  deviceId: trustedDeviceId, userId: trustedUserId, signPub: b64(trustedSignPub),
  kemPub: b64(await suite.kem.serializePublicKey(trustedKem.publicKey)),
};
const join = await joinFingerprint(trustedData);
const relabelledJoin = await joinFingerprint({ ...trustedData, userId: ownerUserId });
assert.notEqual(join.fingerprint, relabelledJoin.fingerprint);

const report = await encrypted({
  ...common, table: "locations", scope: "R", recordId: phoneId,
  signerDeviceId: recipientDeviceId, version: 2,
}, { latitudeE7: 0, longitudeE7: 0, accuracyMm: 5000, capturedAt: now }, rKey, 0x75, receiverSignSeed);
const householdLabel = await encrypted({ ...common, table: "households", scope: "H", phoneId: null,
  recordId: householdId }, { name: "Fixture household" }, hKey, 0x76);

const padding = [];
for (const size of [252, 253]) {
  const body = { text: "x".repeat(size - encode({ text: "" }).length) };
  assert.equal(encode(body).length, size);
  const record = await encrypted({ ...common, table: "households", scope: "H", phoneId: null,
    recordId: householdId, version: size }, body, hKey, size);
  assert.equal(Buffer.from(record.encryption.plaintext, "base64url").length, size === 252 ? 256 : 512);
  padding.push(record);
}

const dedupeInfo = domain("dedupe-key", { householdId, phoneId, epoch: 1 });
const dedupeKey = await hkdf(rKey, dedupeInfo, 32);
const dedupeInput = domain("dedupe", { kind: "app", value: "org.example.fixture" });
const dnsIkm = Buffer.alloc(32, 0x73);
const dnsKeys = await suite.kem.deriveKeyPair(dnsIkm);
const dnsPublic = await suite.kem.serializePublicKey(dnsKeys.publicKey);
const dnsHeader = { v: 1, clientId: "fixture", revision: 1,
  ppdnsKeyId: b64(await hash(new Uint8Array(dnsPublic))) };
const dnsPolicy = { allowDomains: ["example.test"], blockDomains: [], blockedCategories: [] };
const dnsDigest = b64(await hash(domain("dns-policy", dnsPolicy)));
const dns = await hpke(domain("dns-config", dnsHeader), Buffer.alloc(0),
  encode(dnsPolicy),
  dnsIkm, Buffer.alloc(32, 0x35));

const canonicalInput = { "€": "e\u0301", "\uE000": 7, "😀": "\n", z: [3, null, true], a: "é" };
assert.equal(encode(canonicalInput).toString(), '{"a":"é","z":[3,null,true],"€":"é","😀":"\\n","\uE000":7}');

const invalidJson = [
  { reason: "duplicate-key", json: '{"a":1,"a":1}' },
  { reason: "negative-zero", json: '{"a":-0}' },
  { reason: "float", json: '{"a":1.5}' },
  { reason: "lone-surrogate", json: '{"a":"\\ud800"}' },
] as const;
for (const { json } of invalidJson) {
  // For padded blobs the exact bytes must already be canonical. The wire
  // parser must also reject duplicates before mapping noncanonical transport JSON.
  assert.throws(() => {
    const parsed = JSON.parse(json, (_key, value: unknown) => {
      if (typeof value === "number") assert(Number.isSafeInteger(value) && !Object.is(value, -0));
      if (typeof value === "string") assert(value.isWellFormed());
      return value;
    });
    assert.equal(encode(parsed).toString(), json);
  });
}

const invalidBase64url = [
  { reason: "nonzero-unused-bits", value: "AB" },
  { reason: "padding", value: "AA==" },
];
for (const { value } of invalidBase64url) {
  assert.notEqual(b64(Buffer.from(value, "base64url")), value);
}

const identity = hex("01" + "00".repeat(31));
const noncanonicalIdentity = hex("ee" + "ff".repeat(30) + "7f");
const invalidScalar = hex("edd3f55c1a631258d69cf7a2def9de14" + "00".repeat(15) + "10");
const emptySigBytes = new Uint8Array(emptySig);
const ed25519Reject = [
  { reason: "noncanonical-A", pub: noncanonicalIdentity, sig: emptySigBytes },
  { reason: "noncanonical-R", pub: signPub, sig: Buffer.concat([noncanonicalIdentity, emptySigBytes.subarray(32)]) },
  { reason: "small-order-A", pub: identity, sig: emptySigBytes },
  { reason: "small-order-R", pub: signPub, sig: Buffer.concat([identity, emptySigBytes.subarray(32)]) },
  { reason: "S-out-of-range", pub: signPub, sig: Buffer.concat([emptySigBytes.subarray(0, 32), invalidScalar]) },
];
// Construct a signature satisfying the cofactored equation only, by adding
// the order-two point to the RFC example's R and recomputing its challenge.
const orderTwo = ed25519.Point.fromBytes(hex("ec" + "ff".repeat(30) + "7f"), false);
const groupOrder = ed25519.Point.Fn.ORDER;
const alteredR = ed25519.Point.fromBytes(emptySigBytes.subarray(0, 32), false).add(orderTwo).toBytes();
const secretHash = new Uint8Array(await subtle.digest("SHA-512", signSeed));
const secretScalar = secretHash.slice(0, 32);
secretScalar[0] = secretScalar[0]! & 248;
secretScalar[31] = (secretScalar[31]! & 63) | 64;
const nonceScalar = scalarLE(new Uint8Array(await subtle.digest("SHA-512", secretHash.slice(32)))) % groupOrder;
const alteredChallenge = scalarLE(new Uint8Array(
  await subtle.digest("SHA-512", Buffer.concat([alteredR, signPub])),
)) % groupOrder;
const alteredS = (nonceScalar + alteredChallenge * scalarLE(secretScalar)) % groupOrder;
const alteredSig = Buffer.concat([alteredR, hex(alteredS.toString(16).padStart(64, "0")).reverse()]);
assert(ed25519.verify(alteredSig, Buffer.alloc(0), signPub, { zip215: false }));
ed25519Reject.push({ reason: "cofactored-equation-only", pub: signPub, sig: alteredSig });
const scalarBytes = (value: bigint) => hex(value.toString(16).padStart(64, "0")).reverse();
const zeroNonceSignature = async (r: Buffer<ArrayBuffer>) => {
  const challenge = scalarLE(new Uint8Array(
    await subtle.digest("SHA-512", Buffer.concat([r, signPub])),
  )) % groupOrder;
  return Buffer.concat([r, scalarBytes(challenge * scalarLE(secretScalar) % groupOrder)]);
};
const signedIdentity = Buffer.from(identity);
signedIdentity[31] = 128;
ed25519Reject.push(
  { reason: "S-plus-L", pub: signPub, sig: Buffer.concat([
    emptySigBytes.subarray(0, 32), scalarBytes(scalarLE(emptySigBytes.subarray(32)) + groupOrder),
  ]) },
  { reason: "identity-A-and-R", pub: identity, sig: Buffer.concat([identity, Buffer.alloc(32)]) },
  { reason: "x-zero-sign-bit", pub: signPub, sig: await zeroNonceSignature(signedIdentity) },
  { reason: "valid-equation-small-order-R", pub: signPub, sig: await zeroNonceSignature(identity) },
);
const invalidEd25519 = [];
for (const { reason, pub, sig } of ed25519Reject) {
  assert.equal(sig.length, 64);
  assert(!(await verifyStrict(sig, Buffer.alloc(0), pub)), reason);
  invalidEd25519.push({ reason, publicKey: b64(pub), message: "", signature: b64(sig) });
}

const lowOrderEnc = Buffer.alloc(32);
const lowOrderEnvelope = await signed("key-envelope", {
  header: envelopeHeader, enc: b64(lowOrderEnc), ct: envelopeCrypto.ct,
});
for (const backend of [suite, fallback]) {
  const recipientKey = await backend.kem.deriveKeyPair(receiverIkm);
  await assert.rejects(backend.createRecipientContext({
    recipientKey, enc: lowOrderEnc, info: domain("key-envelope", envelopeHeader),
  }));
}

const fork = await log(2, enrolled.head, "keys.rotate", {}, [
  await keyEpoch("R", phoneId, Buffer.alloc(32, 0x79), 2),
]);
assert.equal(fork.wire.seq, trusted.wire.seq);
assert.equal(fork.wire.prevHash, trusted.wire.prevHash);
assert.notEqual(fork.head, trusted.head);

const wrongScope = await encrypted({ ...common, table: "phone_state", scope: "L", recordId: phoneId },
  rules.body, lKey, 0x77);
const wrongRole = await encrypted({
  ...common, rosterHead: emergency.head, epoch: 3,
  signerDeviceId: emergencyDeviceId, table: "phone_state", scope: "R", recordId: phoneId, version: 4,
}, rules.body, Buffer.alloc(32, 0x6b), 0x78, emergencySeed);

function rulesRejection(record: typeof rules, role: string, acceptedVersion: number) {
  const header = record.wire.header;
  if (header.scope !== "R") return "wrong-scope";
  if (role !== "admin") return "wrong-role";
  if (header.version < acceptedVersion) return "old-version";
  return null;
}

const invalidRules = [
  { record: baseRules, role: "admin", acceptedVersion: 3, reason: "old-version" },
  { record: wrongScope, role: "admin", acceptedVersion: 0, reason: "wrong-scope" },
  { record: wrongRole, role: "emergency", acceptedVersion: 3, reason: "wrong-role" },
];
for (const { record, role, acceptedVersion, reason } of invalidRules) {
  assert.equal(rulesRejection(record, role, acceptedVersion), reason);
}

const selfState = { version: baseRulesVersion, digest: baseRulesDigest, epoch: 2 };
const invalidSelf = [
  { state: { ...selfState, version: 3 }, consumed: [], reason: "wrong-base-version" },
  { state: { ...selfState, digest: b64(Buffer.alloc(32)) }, consumed: [], reason: "wrong-base-digest" },
  { state: { ...selfState, epoch: 3 }, consumed: [], reason: "wrong-epoch" },
  { state: { ...selfState, version: resultingRules.wire.header.version,
    digest: b64(await hash(domain("rules-digest", resultingRules.wire))) },
  consumed: [changeId], reason: "replay" },
];

function selfRejection(state: typeof selfState, consumed: string[]) {
  if (consumed.includes(changeId)) return "replay";
  if (state.epoch !== changeEnvelopeHeader.epoch) return "wrong-epoch";
  if (state.version !== changeBody.baseRulesVersion) return "wrong-base-version";
  if (state.digest !== changeBody.baseRulesDigest) return "wrong-base-digest";
  return null;
}
assert.equal(selfRejection(selfState, []), null);
for (const { state, consumed, reason } of invalidSelf) {
  assert.equal(selfRejection(state, consumed), reason);
}

const fixtures = {
  primitives: {
    encoding: { input: canonicalInput, expected: b64(encode(canonicalInput)) },
    sha256: { input: b64(utf8("abc")), digest: b64(shaDigest) },
    hmacSha256: { key: b64(hmacKey), input: b64(hmacMessage), tag: b64(hmacTag) },
    hkdfSha256: { ikm: b64(hkdfIkm), salt: b64(hkdfSalt), info: b64(hkdfInfo),
      length: 42, okm: b64(hkdfOutput) },
    ed25519: { seed: b64(signSeed), publicKey: b64(signPub), message: "", signature: b64(emptySig) },
    aesGcm, hpke: rfcHpke, negative: { json: invalidJson, base64url: invalidBase64url, ed25519: invalidEd25519 },
  },
  protocol: {
    signing: { seed: b64(signSeed), publicKey: b64(signPub) },
    log: [genesis, enrolled, trusted, admin, removed, rotated, emergency, recovery, phoneRemoved], envelope: { ...envelope, hpke: envelopeCrypto },
    rules, commands, report, householdLabel, padding, join,
    emergencyFind: { rules: emergencyRules, command: emergencyFind, result: { ...findResult, body: resultBody, hpke: resultHPKE } },
    negative: {
      lowOrderEnc: { envelope: lowOrderEnvelope, reason: "low-order-enc" },
      fork: { entry: fork, acceptedHead: trusted.head, reason: "fork-head" },
      rules: invalidRules, selfChange: invalidSelf,
      selfOwner: { admission: coParent, phoneId, ownerPrincipalId: signerDeviceId, expectedAccess: false },
      join: { relabelled: relabelledJoin, expectedFingerprint: join.fingerprint, reason: "user-id-mismatch" },
    },
    releaseAck,
    selfChange: {
      baseRules, resultingRules, record: change, envelope: { ...changeEnvelope, hpke: changeHpke },
      phoneEnvelope: { ...phoneChangeEnvelope, hpke: phoneChangeHPKE },
      approval: { wire: { ...approvalBody, sig: b64(approvalSig) }, signInput: b64(approvalInput),
        signingSeed: b64(trustedSeed), signPub: b64(trustedSignPub) },
    },
    enrollment: { secret: b64(secret), fields: enrollment, input: b64(enrollmentBytes),
      mac: b64(await mac(secret, enrollmentBytes)) },
    pairing: { secret: b64(secret), fields: pairing, input: b64(pairingBytes),
      mac: b64(await mac(secret, pairingBytes)) },
    recovery: { householdId, seed: b64(recoverySeed), code: recoveryCode,
      signInfo: b64(recoverySignInfo), kemInfo: b64(recoveryKemInfo), signingSeed: b64(recoverySign),
      signPub: b64(ed25519.getPublicKey(new Uint8Array(recoverySign))), kemIkm: b64(recoveryKem),
      kemPub: b64(await suite.kem.serializePublicKey(recoveryKeys.publicKey)) },
    dedupe: { rKey: b64(rKey), info: b64(dedupeInfo), key: b64(dedupeKey), input: b64(dedupeInput),
      tag: b64(await mac(new Uint8Array(dedupeKey), dedupeInput)) },
    dns: { wire: { header: dnsHeader, enc: dns.enc, ct: dns.ct }, hpke: dns, policyDigest: dnsDigest },
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
