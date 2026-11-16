// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.os.PersistableBundle
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PolicyConfigTest {

    @Test
    fun `no extras gives the defaults`() {
        assertThat(PolicyConfig.fromExtras(null)).isEqualTo(PolicyConfig.DEFAULT)
        assertThat(PolicyConfig.DEFAULT.dnsHost).isEqualTo("family.adguard-dns.com")
    }

    @Test
    fun `QR admin extras override the defaults`() {
        val extras = PersistableBundle().apply {
            putString(PolicyConfig.KEY_DNS_HOST, "child1.dns.plainphone.org")
            putString(PolicyConfig.KEY_ALLOWED, "com.spotify.music, dk.mobilepay.android")
            putString(PolicyConfig.KEY_FRP, "1111,2222")
            putString(PolicyConfig.KEY_PIN_HASH, "ab")
            putString(PolicyConfig.KEY_PIN_SALT, "cd")
            putInt(PolicyConfig.KEY_RELOCK, 10)
        }
        val config = PolicyConfig.fromExtras(extras)
        assertThat(config.dnsHost).isEqualTo("child1.dns.plainphone.org")
        assertThat(config.allowedPackages).containsAtLeast("com.spotify.music", "dk.mobilepay.android", "com.android.chrome")
        assertThat(config.frpAccountIds).containsExactly("1111", "2222")
        assertThat(config.relockMinutes).isEqualTo(10)
        assertThat(config.usesDefaultPin).isFalse()
    }

    @Test
    fun `invalid DNS host and silly relock values fall back safely`() {
        val extras = PersistableBundle().apply {
            putString(PolicyConfig.KEY_DNS_HOST, "not a host; rm -rf")
            putString(PolicyConfig.KEY_RELOCK, "100000")
        }
        val config = PolicyConfig.fromExtras(extras)
        assertThat(config.dnsHost).isEqualTo(PolicyConfig.DEFAULT_DNS_HOST)
        assertThat(config.relockMinutes).isEqualTo(24 * 60)
    }
}
