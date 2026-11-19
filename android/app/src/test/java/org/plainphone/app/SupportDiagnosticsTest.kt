// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SupportDiagnosticsTest {
    @Test
    fun exportsOnlyTechnicalFieldsAndKnownPolicyNames() {
        val details = JSONObject(SupportDiagnostics.format(
            "0.1.8", "13", false, listOf("private DNS", "extra users and profiles: private", "private"),
        ))
        assertEquals(setOf("appVersion", "androidVersion", "mode", "failedPolicies"), details.keys().asSequence().toSet())
        assertEquals("0.1.8", details.getString("appVersion"))
        assertEquals("13", details.getString("androidVersion"))
        assertEquals("strong", details.getString("mode"))
        val policies = details.getJSONArray("failedPolicies")
        assertEquals(listOf("private DNS", "extra users and profiles", "other"), List(policies.length(), policies::getString))
        assertTrue(SupportDiagnostics.version("13-private") == null)
    }
}
