// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sync.crypto

import com.google.crypto.tink.InsecureSecretKeyAccess
import com.google.crypto.tink.hybrid.HpkeParameters
import com.google.crypto.tink.hybrid.HpkePrivateKey
import com.google.crypto.tink.hybrid.HpkePublicKey
import com.google.crypto.tink.hybrid.internal.HpkeContext
import com.google.crypto.tink.hybrid.internal.HpkeKemKeyFactory
import com.google.crypto.tink.hybrid.internal.HpkePrimitiveFactory
import com.google.crypto.tink.hybrid.subtle.HpkeDecrypt
import com.google.crypto.tink.hybrid.subtle.HpkeEncrypt
import com.google.crypto.tink.subtle.Ed25519Sign
import com.google.crypto.tink.subtle.Ed25519Verify
import com.google.crypto.tink.subtle.Hkdf
import com.google.crypto.tink.util.Bytes
import com.google.crypto.tink.util.SecretBytes
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive
import java.math.BigInteger
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.BadPaddingException
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class CryptoCore {
    data class HpkeCiphertext(val enc: ByteArray, val ct: ByteArray)
    data class LogHead(val householdId: String, val seq: Long, val head: String)

    fun canonical(value: JsonElement) = WireEncoding.canonical(value)
    fun parseCanonical(bytes: ByteArray) = WireEncoding.parseCanonical(bytes)
    fun base64url(bytes: ByteArray) = WireEncoding.base64url(bytes)
    fun unbase64url(value: String, length: Int? = null) = WireEncoding.unbase64url(value, length)
    fun pad(value: JsonElement) = WireEncoding.pad(value)
    fun unpad(bytes: ByteArray) = WireEncoding.unpad(bytes)

    fun domain(purpose: String, value: JsonElement): ByteArray = canonical(JsonArray().apply {
        add("plainphone")
        add(1)
        add(purpose)
        add(value)
    })

    fun sha256(input: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(input)
    fun hmac(key: ByteArray, input: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(key, "HmacSHA256"))
        doFinal(input)
    }

    fun hmacVerify(key: ByteArray, input: ByteArray, tag: ByteArray): Boolean =
        tag.size == 32 && MessageDigest.isEqual(hmac(key, input), tag)

    fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        require(length in 1..255 * 32)
        return Hkdf.computeHkdf("HmacSHA256", ikm, salt, info, length)
    }

    fun sign(seed: ByteArray, message: ByteArray): ByteArray {
        require(seed.size == 32)
        return Ed25519Sign(seed).sign(message)
    }

    fun verify(publicKey: ByteArray, message: ByteArray, signature: ByteArray): Boolean {
        if (publicKey.size != 32 || signature.size != 64 ||
            !canonicalNonSmallOrder(publicKey) || !canonicalNonSmallOrder(signature.copyOfRange(0, 32))) return false
        // Tink's pure Java verifier rejects S >= L and compares the encoded R
        // directly against [S]B - [k]A. The profile adds strict point checks.
        return try {
            Ed25519Verify(publicKey).verify(signature, message)
            true
        } catch (_: GeneralSecurityException) {
            false
        }
    }

    fun hpkeSeal(publicKey: ByteArray, info: ByteArray, plaintext: ByteArray): HpkeCiphertext {
        val sealed = HpkeEncrypt.create(hpkePublic(publicKey)).encrypt(plaintext, info)
        return HpkeCiphertext(sealed.copyOfRange(0, 32), sealed.copyOfRange(32, sealed.size))
    }

    fun hpkeOpen(privateKey: ByteArray, publicKey: ByteArray, info: ByteArray,
                 enc: ByteArray, ct: ByteArray): ByteArray {
        require(enc.size == 32 && ct.size >= 16)
        return try {
            HpkeDecrypt.create(hpkePrivate(privateKey, publicKey)).decrypt(enc + ct, info)
        } catch (e: GeneralSecurityException) {
            throw IllegalArgumentException("Invalid HPKE ciphertext or recipient key", e)
        }
    }

    // The protocol uses empty AAD. The RFC 9180 primitive fixture exercises nonempty AAD.
    internal fun hpkeOpen(privateKey: ByteArray, publicKey: ByteArray, info: ByteArray,
                          enc: ByteArray, ct: ByteArray, aad: ByteArray): ByteArray {
        if (aad.isEmpty()) return hpkeOpen(privateKey, publicKey, info, enc, ct)
        val context = HpkeContext.createRecipientContext(
            enc, HpkeKemKeyFactory.createPrivate(hpkePrivate(privateKey, publicKey)),
            HpkePrimitiveFactory.createKem(hpkeParameters.kemId),
            HpkePrimitiveFactory.createKdf(hpkeParameters.kdfId),
            HpkePrimitiveFactory.createAead(hpkeParameters.aeadId), info,
        )
        return context.open(ct, aad)
    }

    fun encrypt(key: ByteArray, nonce: ByteArray, aad: ByteArray, plaintext: ByteArray) =
        aes(Cipher.ENCRYPT_MODE, key, nonce, aad, plaintext)

    fun decrypt(key: ByteArray, nonce: ByteArray, aad: ByteArray, ciphertext: ByteArray) =
        try {
            aes(Cipher.DECRYPT_MODE, key, nonce, aad, ciphertext)
        } catch (e: BadPaddingException) {
            throw IllegalArgumentException("Invalid AES-GCM authentication tag", e)
        }

    private fun aes(mode: Int, key: ByteArray, nonce: ByteArray, aad: ByteArray, bytes: ByteArray): ByteArray {
        require(key.size == 32 && nonce.size == 12)
        return Cipher.getInstance("AES/GCM/NoPadding").run {
            init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
            updateAAD(aad)
            doFinal(bytes)
        }
    }

    fun signObject(purpose: String, body: JsonObject, seed: ByteArray): JsonObject {
        require(!body.has("sig"))
        return body.deepCopy().apply { addProperty("sig", base64url(sign(seed, domain(purpose, this)))) }
    }

    fun verifyObject(purpose: String, wire: JsonObject, signer: ByteArray) {
        val unsigned = wire.deepCopy()
        val sig = unbase64url(string(unsigned.remove("sig")), 64)
        require(verify(signer, domain(purpose, unsigned), sig)) { "Invalid signature" }
    }

    fun sealRecord(header: JsonObject, body: JsonElement, key: ByteArray, seed: ByteArray): JsonObject {
        val nonce = ByteArray(12).also(random::nextBytes)
        val ct = encrypt(key, nonce, domain("blob", header), pad(body))
        return signObject("record", JsonObject().apply {
            add("header", header)
            addProperty("nonce", base64url(nonce))
            addProperty("ct", base64url(ct))
        }, seed)
    }

    /** The caller supplies the full header and signer authorized by local state. */
    fun openRecord(wire: JsonObject, expected: JsonObject, signer: ByteArray, key: ByteArray): JsonElement {
        require(wire.keySet() == setOf("header", "nonce", "ct", "sig"))
        require(canonical(wire["header"]).contentEquals(canonical(expected))) { "Record context mismatch" }
        val ct = string(wire["ct"])
        require(ct.length <= ((WireEncoding.MAX_BUCKET + 16) * 4 + 2) / 3)
        verifyObject("record", wire, signer)
        return unpad(decrypt(key, unbase64url(string(wire["nonce"]), 12), domain("blob", expected), unbase64url(ct)))
    }

    fun sealEnvelope(header: JsonObject, key: ByteArray, recipient: ByteArray, seed: ByteArray): JsonObject {
        envelopeHeader(header)
        require(key.size == 32)
        val sealed = hpkeSeal(recipient, domain("key-envelope", header), key)
        return signObject("key-envelope", JsonObject().apply {
            add("header", header)
            addProperty("enc", base64url(sealed.enc))
            addProperty("ct", base64url(sealed.ct))
        }, seed)
    }

    /** Resolve both heads' permissions before providing expected context and signer. */
    fun openEnvelope(wire: JsonObject, expected: JsonObject, signer: ByteArray,
                     privateKey: ByteArray, publicKey: ByteArray, commitment: String? = null): ByteArray {
        require(wire.keySet() == setOf("header", "enc", "ct", "sig"))
        envelopeHeader(expected)
        require(canonical(wire["header"]).contentEquals(canonical(expected))) { "Envelope context mismatch" }
        val enc = unbase64url(string(wire["enc"]), 32)
        val ct = unbase64url(string(wire["ct"]), 48)
        verifyObject("key-envelope", wire, signer)
        val key = hpkeOpen(privateKey, publicKey, domain("key-envelope", expected), enc, ct)
        if (string(expected["scope"]) != "change") {
            val fields = JsonObject().apply {
                for (name in listOf("scope", "phoneId", "epoch")) add(name, expected[name])
                addProperty("key", base64url(key))
            }
            require(base64url(sha256(domain("scope-key", fields))) == commitment) { "Scope commitment mismatch" }
        }
        return key
    }

    fun signLog(post: JsonObject, seed: ByteArray) = signObject("log", post, seed)

    /** This checks chain linkage and signature. The caller applies roster transition rules. */
    fun verifyLog(post: JsonObject, previous: LogHead?, signer: ByteArray): LogHead {
        require(post.keySet() == setOf("v", "householdId", "seq", "prevHash", "type", "data", "epochs", "signerDeviceId", "sig"))
        val household = string(post["householdId"])
        val seq = number(post["seq"])
        val type = string(post["type"])
        require(number(post["v"]) == 1L && uuid.matches(household) && uuid.matches(string(post["signerDeviceId"])))
        if (previous == null) require(seq == 0L && post["prevHash"] == JsonNull.INSTANCE && type == "genesis")
        else require(seq == previous.seq + 1 && household == previous.householdId &&
            string(post["prevHash"]) == previous.head && type != "genesis")
        val data = post["data"] as? JsonObject ?: throw IllegalArgumentException("Expected a log data object")
        val epochs = post["epochs"] as? JsonArray ?: throw IllegalArgumentException("Expected a log epochs array")
        logPayload(type, data, epochs)
        if (previous == null) {
            require(data["deviceId"] == post["signerDeviceId"] && string(data["signPub"]) == base64url(signer))
        }
        verifyObject("log", post, signer)
        return LogHead(household, seq, base64url(sha256(domain("log-head", post))))
    }

    private fun logPayload(type: String, data: JsonObject, epochs: JsonArray) {
        require(data.keySet() == logFields[type]) { "Invalid log payload" }
        var previous = ""
        for (value in epochs) {
            val entry = value as? JsonObject ?: throw IllegalArgumentException("Expected a log epoch object")
            require(entry.keySet() == setOf("scope", "phoneId", "epoch", "keyHash"))
            val scope = string(entry["scope"])
            val phoneId = if (scope == "H") {
                require(entry["phoneId"] == JsonNull.INSTANCE)
                ""
            } else {
                require(scope == "R" || scope == "L")
                string(entry["phoneId"]).also { require(uuid.matches(it)) }
            }
            require(number(entry["epoch"]) > 0)
            unbase64url(string(entry["keyHash"]), 32)
            val order = scope + phoneId
            require(order > previous) { "Unordered or duplicate epochs" }
            previous = order
        }
    }

    private fun envelopeHeader(header: JsonObject) {
        val scope = string(header["scope"])
        val fields = setOf("v", "householdId", "phoneId", "scope", "epoch", "recipientDeviceId", "rosterHead", "signerDeviceId")
        require(header.keySet() == if (scope == "change") fields + "changeId" else fields)
        require(number(header["v"]) == 1L && number(header["epoch"]) > 0)
        require(scope in setOf("H", "R", "L", "change"))
        require(listOf("householdId", "recipientDeviceId", "signerDeviceId").all { uuid.matches(string(header[it])) })
        if (scope == "H") require(header["phoneId"] == JsonNull.INSTANCE)
        else require(uuid.matches(string(header["phoneId"])))
        if (scope == "change") require(uuid.matches(string(header["changeId"])))
        unbase64url(string(header["rosterHead"]), 32)
    }

    private fun string(value: JsonElement?): String {
        require(value is JsonPrimitive && value.isString)
        return value.asString
    }

    private fun number(value: JsonElement?): Long {
        require(value is JsonPrimitive && value.isNumber)
        return WireEncoding.parseInteger(value.asString)
    }

    private fun hpkePublic(key: ByteArray) = HpkePublicKey.create(hpkeParameters, Bytes.copyFrom(key), null)

    private fun hpkePrivate(privateKey: ByteArray, publicKey: ByteArray) =
        HpkePrivateKey.create(hpkePublic(publicKey), SecretBytes.copyFrom(privateKey, InsecureSecretKeyAccess.get()))

    private fun canonicalNonSmallOrder(encoded: ByteArray): Boolean {
        val coordinate = encoded.reversedArray()
        coordinate[0] = (coordinate[0].toInt() and 0x7f).toByte()
        val y = BigInteger(1, coordinate)
        return y < fieldPrime && y !in smallOrderY
    }

    private companion object {
        val random = SecureRandom()
        val uuid = Regex("[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}")
        val logFields = mapOf(
            "genesis" to setOf("deviceId", "userId", "signPub", "kemPub"),
            "device.add" to setOf("deviceId", "userId", "signPub", "kemPub", "role", "scope", "relationship", "selfPhoneIds"),
            "device.grant-self" to setOf("deviceId", "phoneId"),
            "device.remove" to setOf("deviceId"),
            "phone.add" to setOf("phoneId", "profile", "ownerUserId", "ownerPrincipalId", "deviceId", "signPub", "kemPub"),
            "phone.remove" to setOf("phoneId"),
            "keys.rotate" to emptySet(),
        )
        val hpkeParameters: HpkeParameters = HpkeParameters.builder()
            .setKemId(HpkeParameters.KemId.DHKEM_X25519_HKDF_SHA256)
            .setKdfId(HpkeParameters.KdfId.HKDF_SHA256)
            .setAeadId(HpkeParameters.AeadId.AES_256_GCM)
            .setVariant(HpkeParameters.Variant.NO_PREFIX)
            .build()
        val fieldPrime: BigInteger = BigInteger.ONE.shiftLeft(255).subtract(BigInteger.valueOf(19))
        // Distinct y coordinates of the eight Ed25519 torsion points, ignoring sign.
        val smallOrderY = setOf(
            BigInteger.ZERO, BigInteger.ONE, fieldPrime.subtract(BigInteger.ONE),
            BigInteger("7a03ac9277fdc74ec6cc392cfa53202a0f67100d760b3cba4fd84d3d706a17c7", 16),
            BigInteger("05fc536d880238b13933c6d305acdfd5f098eff289f4c345b027b2c28f95e826", 16),
        )
    }
}
