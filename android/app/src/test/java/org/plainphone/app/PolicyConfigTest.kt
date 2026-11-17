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

    @Test
    fun `country code and approved contacts come from the QR code`() {
        val extras = PersistableBundle().apply {
            putString(PolicyConfig.KEY_COUNTRY, "+45")
            putString(PolicyConfig.KEY_CONTACTS, "Mum=+4512345678;Dad=87654321")
        }
        val config = PolicyConfig.fromExtras(extras)
        assertThat(config.countryCallingCode).isEqualTo("45")
        assertThat(config.seedContacts.map { it.name }).containsExactly("Mum", "Dad").inOrder()
    }

    @Test
    fun `a bad country code is ignored`() {
        val extras = PersistableBundle().apply { putString(PolicyConfig.KEY_COUNTRY, "DK") }
        assertThat(PolicyConfig.fromExtras(extras).countryCallingCode).isNull()
    }

    @Test
    fun `a dashboard QR code's extras give the PIN and the enrollment token, defaults for the rest`() {
        // What web/src/lib/provisioning.ts puts in the admin extras for the hosted service.
        val extras = PersistableBundle().apply {
            putString(PolicyConfig.KEY_PIN_HASH, "99b17387ba3d03187c4246371f9763757d6d27c0587d564fcbe5a5e326a94ac5")
            putString(PolicyConfig.KEY_PIN_SALT, "00112233445566778899aabbccddeeff")
            putString(PolicyConfig.KEY_ENROLL, "pp_e_3q2-7wEvR1q8aZ0sLx9Ywg")
            putString(PolicyConfig.KEY_COUNTRY, "45")
        }
        val config = PolicyConfig.fromExtras(extras)
        assertThat(config.enrollToken).isEqualTo("pp_e_3q2-7wEvR1q8aZ0sLx9Ywg")
        assertThat(config.serverUrl).isEqualTo("https://app.plainphone.org")
        assertThat(config.dnsHost).isEqualTo("family.adguard-dns.com")
        assertThat(config.relockMinutes).isEqualTo(30)
        assertThat(MaintenancePin.verify("123456", config)).isTrue()
    }

    @Test
    fun `a malformed enrollment token is ignored and never stored with the config`() {
        val bad = PersistableBundle().apply { putString(PolicyConfig.KEY_ENROLL, "not a token") }
        assertThat(PolicyConfig.fromExtras(bad).enrollToken).isNull()

        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.app.Application>()
        val good = PolicyConfig.fromExtras(PersistableBundle().apply { putString(PolicyConfig.KEY_ENROLL, "pp_e_3q2-7wEvR1q8aZ0sLx9Ywg") })
        ConfigStore(context).save(good)
        assertThat(ConfigStore(context).load().enrollToken).isNull()
        val raw = context.getSharedPreferences("plainphone_config", 0).all.values.joinToString()
        assertThat(raw).doesNotContain("pp_e_")
    }
}
