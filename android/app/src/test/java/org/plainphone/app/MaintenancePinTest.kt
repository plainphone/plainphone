// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class MaintenancePinTest {
    private val salt = "00112233445566778899aabbccddeeff"

    @Test
    fun `hash matches the provisioning script (Python hashlib pbkdf2_hmac)`() {
        // python3 -c "import hashlib;print(hashlib.pbkdf2_hmac('sha256',b'123456',bytes.fromhex('0011..eeff'),120000,32).hex())"
        assertThat(MaintenancePin.hash("123456", salt))
            .isEqualTo("99b17387ba3d03187c4246371f9763757d6d27c0587d564fcbe5a5e326a94ac5")
    }

    @Test
    fun `configured PIN opens, other PINs do not`() {
        val config = PolicyConfig(pinHashHex = MaintenancePin.hash("4711", salt), pinSaltHex = salt)
        assertThat(MaintenancePin.verify("4711", config)).isTrue()
        assertThat(MaintenancePin.verify("0000", config)).isFalse()
        assertThat(MaintenancePin.verify(MaintenancePin.DEFAULT_TEST_PIN, config)).isFalse()
        assertThat(MaintenancePin.verify("", config)).isFalse()
    }

    @Test
    fun `default test PIN works only when no PIN was configured`() {
        assertThat(MaintenancePin.verify(MaintenancePin.DEFAULT_TEST_PIN, PolicyConfig())).isTrue()
        assertThat(PolicyConfig().usesDefaultPin).isTrue()
    }

    @Test
    fun `a salt without a hash never opens`() {
        val config = PolicyConfig(pinSaltHex = salt)
        assertThat(MaintenancePin.verify(MaintenancePin.DEFAULT_TEST_PIN, config)).isFalse()
    }
}
