// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import java.security.MessageDigest
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * The parent PIN that opens the hidden maintenance screen.
 * Only a PBKDF2 hash travels in the QR code, never the PIN itself.
 * scripts/provisioning-qr.py uses the same parameters.
 */
object MaintenancePin {
    const val ITERATIONS = 120_000
    const val KEY_BITS = 256

    /** Phase 1 only: used when the QR code did not carry a PIN hash. The status screen warns about it. */
    const val DEFAULT_TEST_PIN = "000000"
    private const val DEFAULT_SALT_HEX = "706c61696e70686f6e652d74657374" // "plainphone-test"

    fun hash(pin: String, saltHex: String): String {
        val spec = PBEKeySpec(pin.toCharArray(), saltHex.hexToBytes(), ITERATIONS, KEY_BITS)
        val key = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        spec.clearPassword()
        return key.toHex()
    }

    fun verify(pin: String, config: PolicyConfig): Boolean {
        val salt = config.pinSaltHex ?: DEFAULT_SALT_HEX
        val expected = config.pinHashHex ?: hash(DEFAULT_TEST_PIN, DEFAULT_SALT_HEX)
        if (config.pinHashHex == null && config.pinSaltHex != null) return false
        val actual = runCatching { hash(pin, salt) }.getOrNull() ?: return false
        return MessageDigest.isEqual(actual.toByteArray(), expected.lowercase().toByteArray())
    }

    private fun String.hexToBytes(): ByteArray {
        require(length % 2 == 0) { "hex string must have even length" }
        return chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
}
