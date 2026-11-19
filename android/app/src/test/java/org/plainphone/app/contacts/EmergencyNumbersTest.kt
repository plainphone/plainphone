// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.Manifest
import android.app.Application
import android.app.admin.DevicePolicyManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.IntentFilter
import android.content.pm.PackageManager
import org.plainphone.app.AndroidDeviceControls
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.telecom.TelecomManager
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Instant
import org.plainphone.app.FakeDevice
import org.plainphone.app.MemoryHiddenStore
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.PolicyApplier
import org.plainphone.app.PolicyConfig
import org.plainphone.app.light.LightSetup
import org.plainphone.app.light.LightPlan
import org.plainphone.app.light.Mode
import org.plainphone.app.sync.EffectivePolicy
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.plainphone.app.ui.placeCall
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/** Runs the Android wiring (TelephonyManager) under Robolectric. */
@RunWith(RobolectricTestRunner::class)
class EmergencyNumbersTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun `112, 911 and 114 are emergency numbers on any phone`() {
        val check = EmergencyNumbers.forContext(context)
        for (n in listOf("112", "911", "114", "tel:112", " 112 ")) assertThat(check.isEmergency(n)).isTrue()
    }

    @Test
    fun `the phone app hands 112 to Android Telecom`() {
        shadowOf(ApplicationProvider.getApplicationContext<Application>()).grantPermissions(Manifest.permission.CALL_PHONE)
        val telecom = shadowOf(context.getSystemService(TelecomManager::class.java))
        telecom.setCallPhonePermission(true)

        assertThat(placeCall(context, "112")).isNull()
        assertThat(telecom.onlyOutgoingCall.address.toString()).isEqualTo("tel:112")
    }

    @Test
    fun `the emergency dialer fallback opens the emergency number in the keypad`() {
        val launches = mutableListOf<Intent>()
        val withoutSystemDialer = object : ContextWrapper(context) {
            override fun startActivity(intent: Intent) {
                launches.add(intent)
                if (launches.size == 1) throw ActivityNotFoundException()
            }
        }
        org.plainphone.app.sos.openEmergencyDialer(withoutSystemDialer)
        assertThat(launches).hasSize(2)
        assertThat(launches.first().action).isEqualTo("com.android.phone.EmergencyDialer.DIAL")
        val intent = launches.last()
        assertThat(intent.action).isEqualTo(Intent.ACTION_DIAL)
        assertThat(intent.data?.schemeSpecificPart).isEqualTo("112")
        assertThat(EmergencyNumbers.forContext(context).isEmergency(intent.data!!.schemeSpecificPart)).isTrue()
    }

    @Test fun `strong mode can call 112 and an approved parent during school and after the time limit`() =
        checkCallsDuringRestrictions(strong = true)

    @Test fun `light mode can call 112 and an approved parent during school and after the time limit`() =
        checkCallsDuringRestrictions(strong = false)

    private fun checkCallsDuringRestrictions(strong: Boolean) {
        if (strong) {
            val admin = shadowOf(context.getSystemService(DevicePolicyManager::class.java))
            assertThat(admin.setDeviceOwner(PlainphoneAdminReceiver.component(context))).isTrue()
        } else {
            context.getSharedPreferences("plainphone_light_setup", Context.MODE_PRIVATE)
                .edit().putBoolean("complete", true).apply()
            assertThat(LightSetup.isComplete(context)).isTrue()
        }
        assertThat(Mode.isStrong(context)).isEqualTo(strong)
        shadowOf(ApplicationProvider.getApplicationContext<Application>()).grantPermissions(Manifest.permission.CALL_PHONE)
        val telecom = shadowOf(context.getSystemService(TelecomManager::class.java))
        telecom.setCallPhonePermission(true)
        val own = context.packageName
        // The system's emergency dialer, resolved the way the SOS screen opens it.
        val emergencyPackage = "com.example.emergencydialer"
        val emergencyActivity = ComponentName(emergencyPackage, "$emergencyPackage.Dial")
        shadowOf(context.packageManager).addActivityIfNotPresent(emergencyActivity)
        shadowOf(context.packageManager).addIntentFilterForActivity(
            emergencyActivity,
            IntentFilter(org.plainphone.app.sos.EMERGENCY_DIALER_ACTION).apply { addCategory(Intent.CATEGORY_DEFAULT) },
        )
        val core = AndroidDeviceControls(context).corePackages()
        assertThat(core).contains(emergencyPackage)
        val game = "com.game"
        val school = """[{"id":"school","kind":"school","days":[1,2,3,4,5,6,7],"start":"06:00","end":"19:00","allowedPackages":[]}]"""
        val now = Instant.parse("2026-11-19T12:00:00Z")
        for (schedule in listOf(school, "[]")) {
            val body = org.json.JSONObject(rulesJson(allowed = listOf(game), schedules = schedule, timezone = "UTC"))
                .put("lightContactRestriction", true).toString()
            SyncStore(context).saveRules("test", body, now.toEpochMilli())
            val config = EffectivePolicy.merge(PolicyConfig(), ServerRules.parse(body), now, timeBlocked = setOf(game))
            assertThat(config.server?.windowActive).isEqualTo(schedule == school)
            assertThat(config.timeBlocked).contains(game)
            if (strong) {
                val device = FakeDevice(launchable = mutableSetOf(own, game, emergencyPackage), core = core)
                PolicyApplier(device, MemoryHiddenStore(), sdkInt = 35).apply(config)
                assertThat(device.hidden).doesNotContain(own)
                assertThat(device.suspended).doesNotContain(own)
                assertThat(device.hidden).doesNotContain(emergencyPackage)
                assertThat(device.suspended).doesNotContain(emergencyPackage)
            } else {
                val plan = LightPlan.build(setOf(own, game, emergencyPackage), core, config.allowedPackages, own,
                    telephony = emptySet(), timeBlocked = config.timeBlocked, installing = null)
                assertThat(plan.why(own)).isNull()
                assertThat(plan.why(emergencyPackage)).isNull()
                assertThat(plan.why(game)).isNotNull()
            }
            val contacts = ContactPolicySources.get(context).rules()
            assertThat(contacts.enforced).isTrue()
            assertThat(context.contactPolicy().decide(contacts, Channel.SMS, Direction.OUTGOING, "+4512345678").allowed).isTrue()
            // The SOS screen's own path to the emergency dialer, not just the policy that should allow it.
            val launched = mutableListOf<String?>()
            val sosScreen = object : ContextWrapper(context) {
                override fun startActivity(intent: Intent) {
                    launched.add(packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName)
                }
            }
            org.plainphone.app.sos.openEmergencyDialer(sosScreen)
            assertThat(launched).containsExactly(emergencyPackage)
            assertThat(placeCall(context, "112")).isNull()
            assertThat(placeCall(context, "+4512345678")).isNull()
        }
        assertThat(telecom.allOutgoingCalls.map { it.address.schemeSpecificPart })
            .containsExactly("112", "+4512345678", "112", "+4512345678").inOrder()
    }

    @Test
    fun `ordinary numbers are not`() {
        val check = EmergencyNumbers.forContext(context)
        for (n in listOf("+4512345678", "1813", "", "abc")) assertThat(check.isEmergency(n)).isFalse()
    }
}
