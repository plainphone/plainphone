// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sync.crypto

import com.google.gson.JsonArray
import com.google.gson.JsonNull
import com.google.gson.JsonPrimitive
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.crypto.tink.subtle.Ed25519Verify
import org.bouncycastle.math.ec.rfc8032.Ed25519
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigInteger
import java.security.MessageDigest

class CryptoVectorsTest {
    private val core = CryptoCore()
    private val primitives = fixture("primitives")
    private val protocol = fixture("protocol")

    @Test fun primitivesAndStrictSignatures() {
        val encoding = primitives.obj("encoding")
        equal(encoding.text("expected"), core.canonical(encoding["input"]))
        val sha = primitives.obj("sha256")
        equal(sha.text("digest"), core.sha256(sha.bytes("input")))
        val mac = primitives.obj("hmacSha256")
        equal(mac.text("tag"), core.hmac(mac.bytes("key"), mac.bytes("input")))
        val hkdf = primitives.obj("hkdfSha256")
        equal(hkdf.text("okm"), core.hkdf(hkdf.bytes("ikm"), hkdf.bytes("salt"), hkdf.bytes("info"), hkdf["length"].asInt))
        val aes = primitives.obj("aesGcm")
        equal(aes.text("plaintext"), core.decrypt(aes.bytes("key"), aes.bytes("nonce"), aes.bytes("aad"), aes.bytes("ct")))
        equal(aes.text("ct"), core.encrypt(aes.bytes("key"), aes.bytes("nonce"), aes.bytes("aad"), aes.bytes("plaintext")))
        val corrupt = aes.bytes("ct").apply { this[lastIndex] = (this[lastIndex].toInt() xor 1).toByte() }
        assertThrows(IllegalArgumentException::class.java) {
            core.decrypt(aes.bytes("key"), aes.bytes("nonce"), aes.bytes("aad"), corrupt)
        }
        val sig = primitives.obj("ed25519")
        assertTrue(core.verify(sig.bytes("publicKey"), sig.bytes("message"), sig.bytes("signature")))
        equal(sig.text("signature"), core.sign(sig.bytes("seed"), sig.bytes("message")))
        val negatives = primitives.obj("negative")
        for (row in negatives.rows("ed25519")) {
            assertFalse(row.text("reason"), core.verify(row.bytes("publicKey"), row.bytes("message"), row.bytes("signature")))
        }
        for (row in negatives.rows("json")) {
            assertThrows(IllegalArgumentException::class.java) { core.parseCanonical(row.text("json").encodeToByteArray()) }
        }
        for (row in negatives.rows("base64url")) {
            assertThrows(IllegalArgumentException::class.java) { core.unbase64url(row.text("value")) }
        }
        hpke(primitives.obj("hpke"))
    }

    @Test fun scalarJsonAndPaddingBoundaries() {
        for (text in listOf("null", "true", "9007199254740991", "\"é\"")) {
            val bytes = text.encodeToByteArray()
            val value = core.parseCanonical(bytes)
            assertTrue(bytes.contentEquals(core.canonical(value)))
            assertEquals(value, core.unpad(core.pad(value)))
            val badPadding = core.pad(value).apply { this[lastIndex] = 1 }
            assertThrows(IllegalArgumentException::class.java) { core.unpad(badPadding) }
        }
    }

    @Test fun rejectsTamperedHpkeCiphertextWithNonemptyAad() {
        val row = primitives.obj("hpke")
        val aad = row.bytes("aad")
        assertTrue(aad.isNotEmpty())
        val ciphertext = row.bytes("ct").apply { this[0] = (this[0].toInt() xor 1).toByte() }
        assertThrows(IllegalArgumentException::class.java) {
            core.hpkeOpen(row.bytes("recipientPrivateKey"), row.bytes("recipientPublicKey"),
                row.bytes("info"), row.bytes("enc"), ciphertext, aad)
        }
    }

    @Test fun selfScopeRequiresDeviceGrantEvenForOwnerPrincipal() {
        assertFalse(hasSelfScope("phone", emptyList()))
        assertFalse(hasSelfScope("phone", listOf("another-phone")))
        assertTrue(hasSelfScope("phone", listOf("phone")))
    }

    @Test fun rejectsInvalidLogTypes() {
        val genesis = protocol.rows("log").first().obj("wire")
        val signer = protocol.obj("signing").bytes("publicKey")
        val invalidEpochs = JsonArray().apply { add("not an object") }
        for ((field, value) in listOf(
            "data" to JsonArray(),
            "epochs" to JsonObject(),
            "epochs" to invalidEpochs,
        )) {
            val post = genesis.deepCopy().apply { add(field, value) }
            assertThrows(IllegalArgumentException::class.java) { core.verifyLog(post, null, signer) }
        }
    }

    @Test fun protocolVectors() {
        val entries = protocol.rows("log")
        val admin = protocol.obj("signing").bytes("publicKey")
        val seed = protocol.obj("signing").bytes("seed")
        val phone = entries[1].obj("wire").obj("data").bytes("signPub")
        val emergency = entries[6].obj("wire").obj("data").bytes("signPub")
        var previous: CryptoCore.LogHead? = null
        for (entry in entries) {
            signed("log", entry, admin)
            val head = core.verifyLog(entry.obj("wire"), previous, admin)
            assertEquals(entry.text("head"), head.head)
            previous = head
        }
        val negative = protocol.obj("negative")
        val fork = negative.obj("fork")
        assertThrows(IllegalArgumentException::class.java) {
            core.verifyLog(fork.obj("entry").obj("wire"),
                CryptoCore.LogHead(entries[0].obj("wire").text("householdId"), 2, fork.text("acceptedHead")), admin)
        }
        val forkEntry = fork.obj("entry")
        signed("log", forkEntry, admin)
        val householdId = entries[0].obj("wire").text("householdId")
        val sharedHead = CryptoCore.LogHead(householdId, 1, entries[1].text("head"))
        val alternateHead = core.verifyLog(forkEntry.obj("wire"), sharedHead, admin)
        assertThrows(IllegalArgumentException::class.java) {
            core.verifyLog(entries[3].obj("wire"), alternateHead, admin)
        }
        val self = protocol.obj("selfChange")
        val find = protocol.obj("emergencyFind")
        for (row in listOf(protocol.obj("rules"), protocol.obj("householdLabel"), self.obj("baseRules"),
            self.obj("resultingRules"), self.obj("record"), find.obj("rules")) +
            protocol.rows("commands") + protocol.rows("padding")) record(row, admin)
        record(protocol.obj("report"), phone)
        record(protocol.obj("releaseAck"), phone)
        record(find.obj("command"), emergency)
        val sample = protocol.obj("rules")
        val sampleHeader = sample.obj("wire").obj("header")
        val sampleKey = sample.obj("encryption").bytes("key")
        val sealedRecord = core.sealRecord(sampleHeader, sample["body"], sampleKey, seed)
        assertEquals(sample["body"], core.openRecord(sealedRecord, sampleHeader, admin, sampleKey))

        fun revisionDigest(wire: JsonObject) = core.base64url(core.sha256(core.domain("rules-digest", wire)))
        val accepted = RulesRevision(sampleHeader["version"].asLong, revisionDigest(sample.obj("wire")))
        val revisedBody = JsonParser.parseString("""{"schema":1,"rules":{}}""")
        val revisedWire = core.sealRecord(sampleHeader, revisedBody, sampleKey, seed)
        assertEquals(revisedBody, core.openRecord(revisedWire, sampleHeader, admin, sampleKey))
        assertEquals(null, rulesRejection(sampleHeader, "admin", accepted.digest, accepted))
        // An in-memory header with a whole-number double is the same version as 1, as in TypeScript.
        val doubleOne = sampleHeader.deepCopy().apply { add("v", JsonPrimitive(1.0)) }
        assertEquals(null, rulesRejection(doubleOne, "admin", accepted.digest, accepted))
        for (v in listOf(null, JsonPrimitive("1"), JsonPrimitive(2), JsonPrimitive(1.5))) {
            val invalidHeader = sampleHeader.deepCopy().apply {
                if (v == null) remove("v") else add("v", v)
            }
            assertEquals("wrong-wire-version", rulesRejection(invalidHeader, "admin", accepted.digest, accepted))
        }
        for (invalidHeader in listOf(
            sampleHeader.deepCopy().apply { addProperty("recordId", "other") },
            sampleHeader.deepCopy().apply {
                add("recordId", JsonNull.INSTANCE)
                add("phoneId", JsonNull.INSTANCE)
            },
        )) {
            assertEquals("wrong-record-id", rulesRejection(invalidHeader, "admin", accepted.digest, accepted))
        }
        assertEquals("revision-conflict",
            rulesRejection(revisedWire.obj("header"), "admin", revisionDigest(revisedWire), accepted))
        for (row in negative.rows("rules")) {
            val role = row.text("role")
            val record = row.obj("record")
            signed("record", record, if (role == "admin") admin else emergency)
            val wire = record.obj("wire")
            val acceptedVersion = row["acceptedVersion"].asLong
            val acceptedState = if (acceptedVersion == 0L) null else RulesRevision(acceptedVersion, accepted.digest)
            assertEquals(row.text("reason"), rulesRejection(wire.obj("header"), role, revisionDigest(wire), acceptedState))
        }
        val selfRecord = self.obj("record")
        val selfHeader = selfRecord.obj("wire").obj("header")
        val selfBody = selfRecord.obj("body")
        val expectedBase = SelfBase(selfBody["baseRulesVersion"].asLong, selfBody.text("baseRulesDigest"), selfHeader["epoch"].asLong)
        equal(expectedBase.digest, core.sha256(core.domain("rules-digest", self.obj("baseRules").obj("wire"))))
        for (row in negative.rows("selfChange")) {
            val state = row.obj("state")
            val accepted = SelfBase(state["version"].asLong, state.text("digest"), state["epoch"].asLong)
            val consumed = row.getAsJsonArray("consumed").map(JsonElement::getAsString).toSet()
            assertEquals(row.text("reason"), selfBaseRejection(selfHeader.text("recordId"), expectedBase, accepted, consumed))
        }
        val owner = negative.obj("selfOwner")
        signed("log", owner.obj("admission"), admin)
        val admission = owner.obj("admission").obj("wire").obj("data")
        assertEquals(entries[0].obj("wire").obj("data").text("userId"), admission.text("userId"))
        assertEquals("other", admission.text("relationship"))
        assertEquals(owner["expectedAccess"].asBoolean,
            hasSelfScope(owner.text("phoneId"),
                admission.getAsJsonArray("selfPhoneIds").map(JsonElement::getAsString)))
        val relabelled = negative.obj("join")
        for (row in listOf(protocol.obj("join"), relabelled.obj("relabelled"))) {
            equal(row.text("input"), core.domain("join-device", row.obj("fields")))
            equal(row.text("fingerprint"), core.sha256(row.bytes("input")))
        }
        assertTrue(relabelled.text("expectedFingerprint") != relabelled.obj("relabelled").text("fingerprint"))
        val commitment = entries[1].obj("wire").rows("epochs").single { it.text("scope") == "R" }.text("keyHash")
        for (row in listOf(protocol.obj("envelope"), self.obj("envelope"), self.obj("phoneEnvelope"))) {
            signed("key-envelope", row, admin)
            val wire = row.obj("wire")
            val header = wire.obj("header")
            val crypto = row.obj("hpke")
            equal(crypto.text("info"), core.domain("key-envelope", header))
            hpke(crypto)
            equal(crypto.text("plaintext"), core.openEnvelope(wire, header, admin,
                crypto.bytes("recipientPrivateKey"), crypto.bytes("recipientPublicKey"),
                if (header.text("scope") == "change") null else commitment))
        }
        val keyVector = protocol.obj("envelope").obj("hpke")
        val header = protocol.obj("envelope").obj("wire").obj("header")
        val pk = keyVector.bytes("recipientPublicKey")
        val sk = keyVector.bytes("recipientPrivateKey")
        val fresh = core.sealEnvelope(header, keyVector.bytes("plaintext"), pk, seed)
        equal(keyVector.text("plaintext"), core.openEnvelope(fresh, header, admin, sk, pk, commitment))
        assertThrows(IllegalArgumentException::class.java) {
            core.openEnvelope(negative.obj("lowOrderEnc").obj("envelope").obj("wire"), header, admin, sk, pk, commitment)
        }
        assertThrows(IllegalArgumentException::class.java) {
            core.openEnvelope(fresh, header, emergency, sk, pk, commitment)
        }
        val wrongEpoch = header.deepCopy().apply { addProperty("epoch", 2) }
        assertThrows(IllegalArgumentException::class.java) {
            core.openEnvelope(fresh, wrongEpoch, admin, sk, pk, commitment)
        }
        val wrongKey = ByteArray(32)
        assertFalse(wrongKey.contentEquals(keyVector.bytes("plaintext")))
        val uncommitted = core.sealEnvelope(header, wrongKey, pk, seed)
        val mismatch = assertThrows(IllegalArgumentException::class.java) {
            core.openEnvelope(uncommitted, header, admin, sk, pk, commitment)
        }
        assertEquals("Scope commitment mismatch", mismatch.message)
        val corrupt = fresh.deepCopy().apply {
            val ct = bytes("ct").apply { this[0] = (this[0].toInt() xor 1).toByte() }
            addProperty("ct", core.base64url(ct))
        }
        assertThrows(IllegalArgumentException::class.java) {
            core.openEnvelope(corrupt, header, admin, sk, pk, commitment)
        }

        val result = find.obj("result")
        signed("command-result", result, phone)
        equal(result.obj("hpke").text("info"), core.domain("command-result", result.obj("wire").obj("header")))
        equal(result.obj("hpke").text("plaintext"), core.pad(result["body"]))
        hpke(result.obj("hpke"), result.obj("wire"))
        val approval = self.obj("approval")
        signed("self-approval", approval, approval.bytes("signPub"))
        equal(approval.obj("wire").text("recordHash"), core.sha256(core.domain("self-change", selfRecord.obj("wire"))))
        equal(approval.obj("wire").text("keyHash"), core.sha256(core.domain("self-change-key",
            self.obj("envelope").obj("hpke")["plaintext"])))
        for ((purpose, row) in listOf("enroll" to protocol.obj("enrollment"), "pair-context" to protocol.obj("pairing"))) {
            equal(row.text("input"), core.domain(purpose, row["fields"]))
            equal(row.text("mac"), core.hmac(row.bytes("secret"), row.bytes("input")))
            val tag = row.bytes("mac")
            assertTrue(core.hmacVerify(row.bytes("secret"), row.bytes("input"), tag))
            assertFalse(core.hmacVerify(row.bytes("secret"), row.bytes("input"), tag.copyOf(31)))
            tag[0] = (tag[0].toInt() xor 1).toByte()
            assertFalse(core.hmacVerify(row.bytes("secret"), row.bytes("input"), tag))
        }
        val dedupe = protocol.obj("dedupe")
        equal(dedupe.text("key"), core.hkdf(dedupe.bytes("rKey"), ByteArray(32), dedupe.bytes("info"), 32))
        equal(dedupe.text("tag"), core.hmac(dedupe.bytes("key"), dedupe.bytes("input")))
        val recovery = protocol.obj("recovery")
        for ((info, output) in listOf("signInfo" to "signingSeed", "kemInfo" to "kemIkm")) {
            equal(recovery.text(output), core.hkdf(recovery.bytes("seed"), ByteArray(32), recovery.bytes(info), 32))
        }
        val dns = protocol.obj("dns")
        val dnsHpke = dns.obj("hpke")
        equal(dnsHpke.text("info"), core.domain("dns-config", dns.obj("wire").obj("header")))
        equal(dns.obj("wire").obj("header").text("ppdnsKeyId"), core.sha256(dnsHpke.bytes("recipientPublicKey")))
        assertTrue(dnsHpke.text("recipientPublicKey") != keyVector.text("recipientPublicKey"))
        hpke(dnsHpke, dns.obj("wire"))
        equal(dns.text("policyDigest"), core.sha256(core.domain("dns-policy", core.parseCanonical(dnsHpke.bytes("plaintext")))))
    }

    @Test fun negativeVectorsDistinguishRelaxedVerifiers() {
        val negative = primitives.obj("negative").rows("ed25519").associateBy { it.text("reason") }
        for (reason in listOf("identity-A-and-R", "valid-equation-small-order-R")) {
            val row = negative.getValue(reason)
            Ed25519Verify(row.bytes("publicKey")).verify(row.bytes("signature"), row.bytes("message"))
        }
        val cofactored = negative.getValue("cofactored-equation-only")
        val message = cofactored.bytes("message")
        assertTrue(Ed25519.verify(cofactored.bytes("signature"), 0, cofactored.bytes("publicKey"), 0,
            message, 0, message.size))

        val malleated = negative.getValue("S-plus-L")
        val signature = malleated.bytes("signature")
        val order = BigInteger("1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed", 16)
        val reduced = BigInteger(1, signature.copyOfRange(32, 64).reversedArray()).mod(order)
        val normalized = signature.copyOfRange(0, 32) + ByteArray(32) { reduced.shiftRight(8 * it).toByte() }
        Ed25519Verify(malleated.bytes("publicKey")).verify(normalized, malleated.bytes("message"))

        // A verifier allowing the x=0 sign bit still hashes the original point bytes.
        // Its decoded R is the identity, so the equation reduces to S = k * a mod L.
        val signBit = negative.getValue("x-zero-sign-bit")
        val signedIdentity = signBit.bytes("signature").copyOfRange(0, 32)
        val identity = ByteArray(32).apply { this[0] = 1; this[31] = 0x80.toByte() }
        assertTrue(identity.contentEquals(signedIdentity))
        val secret = MessageDigest.getInstance("SHA-512").digest(primitives.obj("ed25519").bytes("seed"))
            .copyOfRange(0, 32)
        secret[0] = (secret[0].toInt() and 248).toByte()
        secret[31] = ((secret[31].toInt() and 63) or 64).toByte()
        val challengeInput = signedIdentity + signBit.bytes("publicKey") + signBit.bytes("message")
        val digest = MessageDigest.getInstance("SHA-512").digest(challengeInput)
        val expectedS = BigInteger(1, digest.reversedArray()).multiply(BigInteger(1, secret.reversedArray())).mod(order)
        val actualS = BigInteger(1, signBit.bytes("signature").copyOfRange(32, 64).reversedArray())
        assertEquals(expectedS, actualS)
    }

    private fun record(row: JsonObject, key: ByteArray) {
        signed("record", row, key)
        val wire = row.obj("wire")
        val encryption = row.obj("encryption")
        equal(encryption.text("aad"), core.domain("blob", wire.obj("header")))
        equal(encryption.text("plaintext"), core.pad(row["body"]))
        assertEquals(row["body"], core.openRecord(wire, wire.obj("header"), key, encryption.bytes("key")))
    }

    private fun signed(purpose: String, row: JsonObject, key: ByteArray) {
        val unsigned = row.obj("wire").deepCopy()
        val signature = core.unbase64url(unsigned.remove("sig").asString)
        val input = core.domain(purpose, unsigned)
        equal(row.text("signInput"), input)
        assertTrue(purpose, core.verify(key, input, signature))
    }

    private fun hpke(row: JsonObject, wire: JsonObject = row) {
        assertEquals(row.text("enc"), wire.text("enc"))
        assertEquals(row.text("ct"), wire.text("ct"))
        equal(row.text("plaintext"), core.hpkeOpen(row.bytes("recipientPrivateKey"), row.bytes("recipientPublicKey"),
            row.bytes("info"), row.bytes("enc"), row.bytes("ct"), row.bytes("aad")))
    }

    private fun fixture(name: String): JsonObject = requireNotNull(javaClass.getResourceAsStream("/$name.json"))
        .bufferedReader(Charsets.UTF_8).use { JsonParser.parseReader(it).asJsonObject }

    private fun equal(expected: String, actual: ByteArray) = assertEquals(expected, core.base64url(actual))
    private fun JsonObject.bytes(name: String) = core.unbase64url(text(name))
    private fun JsonObject.text(name: String) = get(name).asString
    private fun JsonObject.obj(name: String) = getAsJsonObject(name)
    private fun JsonObject.rows(name: String) = getAsJsonArray(name).map(JsonElement::getAsJsonObject)
}
