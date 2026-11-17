// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import java.time.Instant
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PolicyConfig
import org.robolectric.RobolectricTestRunner

/** #20: the parents' Google account IDs travel in the rules document. Robolectric for org.json. */
@RunWith(RobolectricTestRunner::class)
class ResetProtectionRulesTest {
    private fun withIds(ids: String) =
        rulesJson().replace("\"pollSeconds\":60", "\"resetProtection\":{\"accountIds\":$ids},\"pollSeconds\":60")

    @Test
    fun `account IDs are parsed, and anything that is not a number is dropped`() {
        val r = ServerRules.parse(withIds("""["118000000000000000001","mum@example.org",""]"""))
        assertThat(r.frpAccountIds).containsExactly("118000000000000000001")
    }

    @Test
    fun `an old server without the field means no accounts`() {
        assertThat(ServerRules.parse(rulesJson()).frpAccountIds).isEmpty()
    }

    @Test
    fun `the dashboard's accounts join the QR code's, and removing them changes the fingerprint`() {
        val qr = PolicyConfig(frpAccountIds = setOf("42"))
        val now = Instant.parse("2027-01-04T11:00:00Z")
        val on = EffectivePolicy.merge(qr, ServerRules.parse(withIds("""["7"]""")), now)
        assertThat(on.frpAccountIds).containsExactly("42", "7")
        val off = EffectivePolicy.merge(qr, ServerRules.parse(withIds("[]")), now)
        assertThat(off.frpAccountIds).containsExactly("42")
        assertThat(EffectivePolicy.fingerprint(on)).isNotEqualTo(EffectivePolicy.fingerprint(off))
    }
}
