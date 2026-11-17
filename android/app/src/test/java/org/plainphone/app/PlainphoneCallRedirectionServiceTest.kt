// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Looper
import android.telecom.PhoneAccountHandle
import com.google.common.truth.Truth.assertThat
import java.lang.reflect.Proxy
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.LocalContactPolicySource
import org.plainphone.app.telephony.PlainphoneCallRedirectionService
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class PlainphoneCallRedirectionServiceTest {
    private val service = Robolectric.buildService(PlainphoneCallRedirectionService::class.java).create().get()

    /** Connect an in-process Telecom adapter to observe the actual framework response. */
    private fun placeCall(number: String): List<String> {
        val serviceName = "com.android.internal.telecom.ICallRedirectionService"
        val adapterType = Class.forName("com.android.internal.telecom.ICallRedirectionAdapter")
        val responses = mutableListOf<String>()
        val adapter = Proxy.newProxyInstance(adapterType.classLoader, arrayOf(adapterType)) { _, method, _ ->
            responses += method.name
            null
        }
        val binder = requireNotNull(service.onBind(Intent("android.telecom.CallRedirectionService")))
        val call = Class.forName(serviceName).getMethod(
            "placeCall", adapterType, Uri::class.java, PhoneAccountHandle::class.java, Boolean::class.javaPrimitiveType,
        )
        val account = PhoneAccountHandle(ComponentName(service, PlainphoneCallRedirectionService::class.java), "test")
        call.invoke(binder.queryLocalInterface(serviceName), adapter, Uri.fromParts("tel", number, null), account, false)
        shadowOf(Looper.getMainLooper()).idle()
        return responses
    }

    @Test
    fun `only an unapproved ordinary number is cancelled in strong mode`() {
        val dpm = service.getSystemService(DevicePolicyManager::class.java)
        assertThat(shadowOf(dpm).setDeviceOwner(PlainphoneAdminReceiver.component(service))).isTrue()
        LocalContactPolicySource(service).seedIfEmpty(listOf(ApprovedContact("Approved", "+12025550123")))

        assertThat(placeCall("112")).containsExactly("placeCallUnmodified")
        assertThat(placeCall("+12025550123")).containsExactly("placeCallUnmodified")
        assertThat(placeCall("+12025550124")).containsExactly("cancelCall")
    }

    @Test
    fun `a retained role after release does not cancel ordinary calls`() {
        val dpm = service.getSystemService(DevicePolicyManager::class.java)
        val admin = PlainphoneAdminReceiver.component(service)
        shadowOf(dpm).setActiveAdmin(admin)
        assertThat(shadowOf(dpm).setDeviceOwner(admin)).isTrue()
        assertThat(placeCall("+12025550124")).containsExactly("cancelCall")
        // Robolectric has no shadow for clearDeviceOwnerApp. Simulate losing ownership.
        shadowOf(dpm).setDeviceOwner(ComponentName("org.example.other", "Admin"))
        assertThat(dpm.isDeviceOwnerApp(service.packageName)).isFalse()
        assertThat(placeCall("+12025550124")).containsExactly("placeCallUnmodified")
    }
}
