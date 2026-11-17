// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base64url, unbase64url, canonical, parseCanonical, CryptoCore, rulesRejection, selfBaseRejection, hasSelfScope } from "./index.ts";
import type { JsonObject } from "./index.ts";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../docs/encryption-test-vectors/${name}.json`, import.meta.url), "utf8"));
const primitives = fixture("primitives");
const protocol = fixture("protocol");
const bytes = unbase64url;
const eq = (actual: Uint8Array, expected: string) => assert.equal(base64url(actual), expected);

test("restricted JSON and base64url", () => {
  eq(canonical(primitives.encoding.input), primitives.encoding.expected);
  for (const value of [null, true, Number.MAX_SAFE_INTEGER, "é"]) {
    assert.equal(parseCanonical(canonical(value)), value);
    const padded = new CryptoCore().pad(value);
    padded[padded.length - 1] = 1;
    assert.throws(() => new CryptoCore().unpad(padded));
  }
  for (const { json } of primitives.negative.json)
    assert.throws(() => parseCanonical(new TextEncoder().encode(json)), json);
  for (const { value } of primitives.negative.base64url) assert.throws(() => bytes(value), value);
});

test("Self scope requires a device grant even for the owner principal", () => {
  assert.equal(hasSelfScope("phone", []), false);
  assert.equal(hasSelfScope("phone", ["another-phone"]), false);
  assert.equal(hasSelfScope("phone", ["phone"]), true);
});

for (const backend of ["native", "noble"] as const) {
  const core = new CryptoCore(backend, backend);
  test(`${backend} primitives and strict signatures`, async () => {
    const { sha256, hmacSha256, hkdfSha256, ed25519: sig, aesGcm, hpke, negative } = primitives;
    eq(await core.sha256(bytes(sha256.input)), sha256.digest);
    eq(await core.hmac(bytes(hmacSha256.key), bytes(hmacSha256.input)), hmacSha256.tag);
    eq(await core.hkdf(bytes(hkdfSha256.ikm), bytes(hkdfSha256.salt), bytes(hkdfSha256.info),
      hkdfSha256.length), hkdfSha256.okm);
    assert(await core.verify(bytes(sig.publicKey), bytes(sig.message), bytes(sig.signature)));
    assert(await core.verify(bytes(sig.publicKey), bytes(sig.message),
      await core.sign(bytes(sig.seed), bytes(sig.message))));
    for (const { publicKey, message, signature, reason } of negative.ed25519) {
      assert.equal(await core.verify(bytes(publicKey), bytes(message), bytes(signature)), false, reason);
    }
    eq(await core.decrypt(bytes(aesGcm.key), bytes(aesGcm.nonce), bytes(aesGcm.aad), bytes(aesGcm.ct)),
      aesGcm.plaintext);
    eq(await core.encrypt(bytes(aesGcm.key), bytes(aesGcm.nonce), bytes(aesGcm.aad), bytes(aesGcm.plaintext)),
      aesGcm.ct);
    await checkHpke(core, hpke);
  });

  test(`${backend} protocol vectors`, async () => {
    const admin = bytes(protocol.signing.publicKey);
    const phone = bytes(protocol.log[1].wire.data.signPub);
    const emergency = bytes(protocol.log[6].wire.data.signPub);
    let previous = null;
    for (const entry of protocol.log) {
      await signed(core, "log", entry, admin);
      const head = await core.verifyLog(entry.wire, previous, admin);
      assert.equal(head.head, entry.head);
      previous = head;
    }
    const fork = protocol.negative.fork;
    await assert.rejects(core.verifyLog(fork.entry.wire, {
      head: fork.acceptedHead, seq: 2, householdId: protocol.log[0].wire.householdId,
    }, admin));
    await signed(core, "log", fork.entry, admin);
    const logHead = (entry: typeof fork.entry) => ({
      head: entry.head, seq: entry.wire.seq, householdId: entry.wire.householdId,
    });
    const alternateHead = await core.verifyLog(fork.entry.wire, logHead(protocol.log[1]), admin);
    await assert.rejects(core.verifyLog(protocol.log[3].wire, alternateHead, admin), /Invalid log link/);
    const r1 = bytes(protocol.dedupe.rKey);
    const key = (n: number) => new Uint8Array(32).fill(n);
    for (const [record, recordKey, signer] of [
      ...protocol.padding.map((entry: typeof protocol.rules) => [entry, key(0x23), admin]),
      [protocol.rules, r1, admin], [protocol.householdLabel, key(0x23), admin],
      [protocol.report, r1, phone], [protocol.releaseAck, key(0x6a), phone],
      ...protocol.commands.map((command: typeof protocol.rules) =>
        [command, bytes(command.encryption.key), admin]),
      [protocol.selfChange.baseRules, key(0x6a), admin],
      [protocol.selfChange.resultingRules, key(0x6a), admin],
      [protocol.selfChange.record, key(0x63), admin],
      [protocol.emergencyFind.rules, key(0x6b), admin],
      [protocol.emergencyFind.command, key(0x69), emergency],
    ]) {
      await signed(core, "record", record, signer);
      eq(core.domain("blob", record.wire.header), record.encryption.aad);
      eq(core.pad(record.body), record.encryption.plaintext);
      assert.deepEqual(await core.openRecord(record.wire, record.wire.header, signer, recordKey), record.body);
    }
    const sample = protocol.rules;
    const sealedRecord = await core.sealRecord(sample.wire.header, sample.body, r1, bytes(protocol.signing.seed));
    assert.deepEqual(await core.openRecord(sealedRecord, sample.wire.header, admin, r1), sample.body);
    const revisionDigest = async (wire: typeof sample.wire) =>
      base64url(await core.sha256(core.domain("rules-digest", wire)));
    const accepted = { version: sample.wire.header.version, digest: await revisionDigest(sample.wire) };
    const revisedWire = await core.sealRecord(sample.wire.header, { schema: 1, rules: {} }, r1, bytes(protocol.signing.seed));
    assert.deepEqual(await core.openRecord(revisedWire, sample.wire.header, admin, r1), { schema: 1, rules: {} });
    assert.equal(rulesRejection(sample.wire.header, "admin", accepted.digest, accepted), null);
    for (const v of [undefined, "1", 2]) {
      const header: JsonObject = { ...sample.wire.header };
      if (v === undefined) delete header.v;
      else header.v = v;
      assert.equal(rulesRejection(header, "admin", accepted.digest, accepted), "wrong-wire-version");
    }
    for (const ids of [{ recordId: "other" }, { recordId: null, phoneId: null }]) {
      assert.equal(rulesRejection({ ...sample.wire.header, ...ids }, "admin", accepted.digest, accepted), "wrong-record-id");
    }
    assert.equal(rulesRejection(revisedWire.header, "admin", await revisionDigest(revisedWire), accepted), "revision-conflict");
    for (const { record, role, acceptedVersion, reason } of protocol.negative.rules) {
      await signed(core, "record", record, role === "admin" ? admin : emergency);
      assert.equal(rulesRejection(record.wire.header, role, await revisionDigest(record.wire),
        acceptedVersion === 0 ? null : { version: acceptedVersion, digest: accepted.digest }), reason);
    }
    const self = protocol.selfChange;
    const selfHeader = self.record.wire.header;
    const expectedBase = { version: self.record.body.baseRulesVersion, digest: self.record.body.baseRulesDigest,
      epoch: selfHeader.epoch };
    eq(await core.sha256(core.domain("rules-digest", self.baseRules.wire)), expectedBase.digest);
    for (const { state, consumed, reason } of protocol.negative.selfChange) {
      assert.equal(selfBaseRejection(selfHeader.recordId, expectedBase, state, new Set(consumed)), reason);
    }
    const owner = protocol.negative.selfOwner;
    await signed(core, "log", owner.admission, admin);
    const admission = owner.admission.wire.data;
    assert.equal(admission.userId, protocol.log[0].wire.data.userId);
    assert.equal(admission.relationship, "other");
    assert.equal(hasSelfScope(owner.phoneId, admission.selfPhoneIds), owner.expectedAccess);
    for (const join of [protocol.join, protocol.negative.join.relabelled]) {
      eq(core.domain("join-device", join.fields), join.input);
      eq(await core.sha256(bytes(join.input)), join.fingerprint);
    }
    assert.notEqual(protocol.negative.join.relabelled.fingerprint, protocol.negative.join.expectedFingerprint);
    const commitment = protocol.log[1].wire.epochs.find((entry: {scope: string}) => entry.scope === "R").keyHash;
    for (const envelope of [protocol.envelope, protocol.selfChange.envelope, protocol.selfChange.phoneEnvelope]) {
      await signed(core, "key-envelope", envelope, admin);
      eq(core.domain("key-envelope", envelope.wire.header), envelope.hpke.info);
      await checkHpke(core, envelope.hpke);
      const expectedCommitment = envelope.wire.header.scope === "change" ? undefined : commitment;
      eq(await core.openEnvelope(envelope.wire, envelope.wire.header, admin,
        bytes(envelope.hpke.recipientPrivateKey), bytes(envelope.hpke.recipientPublicKey), expectedCommitment),
      envelope.hpke.plaintext);
    }
    const vector = protocol.envelope;
    const recipientPrivate = bytes(vector.hpke.recipientPrivateKey);
    const recipientPublic = bytes(vector.hpke.recipientPublicKey);
    const fresh = await core.sealEnvelope(vector.wire.header, r1, recipientPublic, bytes(protocol.signing.seed));
    eq(await core.openEnvelope(fresh, vector.wire.header, admin, recipientPrivate, recipientPublic, commitment),
      vector.hpke.plaintext);
    await assert.rejects(core.openEnvelope(protocol.negative.lowOrderEnc.envelope.wire, vector.wire.header,
      admin, recipientPrivate, recipientPublic, commitment));
    await assert.rejects(core.openEnvelope(fresh, vector.wire.header, emergency, recipientPrivate,
      recipientPublic, commitment));
    await assert.rejects(core.openEnvelope(fresh, { ...vector.wire.header, epoch: 2 }, admin,
      recipientPrivate, recipientPublic, commitment));
    const wrongKey = key(0);
    assert.notDeepEqual(wrongKey, r1);
    const uncommitted = await core.sealEnvelope(vector.wire.header, wrongKey, recipientPublic, bytes(protocol.signing.seed));
    await assert.rejects(core.openEnvelope(uncommitted, vector.wire.header, admin, recipientPrivate,
      recipientPublic, commitment), /Scope commitment mismatch/);
    const invalidCiphertext = bytes(fresh.ct);
    invalidCiphertext[0] = invalidCiphertext[0]! ^ 1;
    await assert.rejects(core.openEnvelope({ ...fresh, ct: base64url(invalidCiphertext) },
      vector.wire.header, admin, recipientPrivate, recipientPublic, commitment));

    const { result } = protocol.emergencyFind;
    await signed(core, "command-result", result, phone);
    eq(core.domain("command-result", result.wire.header), result.hpke.info);
    assert.equal(result.wire.enc, result.hpke.enc);
    assert.equal(result.wire.ct, result.hpke.ct);
    await checkHpke(core, result.hpke);
    eq(core.pad(result.body), result.hpke.plaintext);
    const { approval } = protocol.selfChange;
    await signed(core, "self-approval", approval, bytes(approval.signPub));
    eq(await core.sha256(core.domain("self-change", self.record.wire)), approval.wire.recordHash);
    eq(await core.sha256(core.domain("self-change-key", self.envelope.hpke.plaintext)), approval.wire.keyHash);
    for (const [purpose, value] of [["enroll", protocol.enrollment], ["pair-context", protocol.pairing]]) {
      eq(core.domain(purpose, value.fields), value.input);
      eq(await core.hmac(bytes(value.secret), bytes(value.input)), value.mac);
      const tag = bytes(value.mac);
      assert.equal(await core.hmacVerify(bytes(value.secret), bytes(value.input), tag), true);
      assert.equal(await core.hmacVerify(bytes(value.secret), bytes(value.input), tag.subarray(1)), false);
      tag[0] = tag[0]! ^ 1;
      assert.equal(await core.hmacVerify(bytes(value.secret), bytes(value.input), tag), false);
    }
    const { dedupe, dns, recovery } = protocol;
    eq(await core.hkdf(r1, key(0), bytes(dedupe.info), 32), dedupe.key);
    eq(await core.hmac(bytes(dedupe.key), bytes(dedupe.input)), dedupe.tag);
    for (const [use, info, output] of [["sign", recovery.signInfo, recovery.signingSeed],
      ["kem", recovery.kemInfo, recovery.kemIkm]]) {
      eq(core.domain("recovery", { householdId: recovery.householdId, use }), info);
      eq(await core.hkdf(bytes(recovery.seed), key(0), bytes(info), 32), output);
    }
    eq(await core.sha256(bytes(dns.hpke.recipientPublicKey)), dns.wire.header.ppdnsKeyId);
    assert.notEqual(dns.hpke.recipientPublicKey, protocol.envelope.hpke.recipientPublicKey);
    eq(core.domain("dns-config", dns.wire.header), dns.hpke.info);
    assert.equal(dns.wire.enc, dns.hpke.enc);
    assert.equal(dns.wire.ct, dns.hpke.ct);
    await checkHpke(core, dns.hpke);
    eq(await core.sha256(core.domain("dns-policy", core.parseCanonical(bytes(dns.hpke.plaintext)))), dns.policyDigest);
  });
}

test("negative vectors distinguish relaxed verifiers", () => {
  const negative = new Map<string, typeof primitives.ed25519>(
    primitives.negative.ed25519.map((row: { reason: string }) => [row.reason, row]));
  for (const reason of ["cofactored-equation-only", "identity-A-and-R", "x-zero-sign-bit",
    "valid-equation-small-order-R"]) {
    const { publicKey, message, signature } = negative.get(reason);
    assert(ed25519.verify(bytes(signature), bytes(message), bytes(publicKey), { zip215: true }), reason);
  }
  const malleated = bytes(negative.get("S-plus-L").signature);
  const order = ed25519.Point.Fn.ORDER;
  const scalar = malleated.subarray(32).reduceRight((n, b) => n * 256n + BigInt(b), 0n) % order;
  for (let i = 0; i < 32; i++) malleated[32 + i] = Number(scalar >> BigInt(8 * i) & 255n);
  const sig = primitives.ed25519;
  assert(ed25519.verify(malleated, bytes(sig.message), bytes(sig.publicKey), { zip215: true }));
});

async function signed(core: CryptoCore, purpose: string, fixture: { wire: any; signInput: string }, signer: ReturnType<typeof bytes>) {
  const { sig, ...unsigned } = fixture.wire;
  const message = core.domain(purpose, unsigned);
  eq(message, fixture.signInput);
  assert(await core.verify(signer, message, bytes(sig)), purpose);
}

async function checkHpke(core: CryptoCore, hpke: typeof primitives.hpke) {
  eq(await core.hpkeOpen(bytes(hpke.recipientPrivateKey), bytes(hpke.recipientPublicKey), bytes(hpke.info),
    bytes(hpke.enc), bytes(hpke.ct), bytes(hpke.aad)), hpke.plaintext);
}
