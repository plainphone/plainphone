// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.R
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.EditableContactPolicySource
import org.plainphone.app.telephony.RecentDials
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The keypad is a screen of its own, outside the phone app's tabs. A call it refuses must still tell
 * the child why, and the message must stay until the number changes: it is the only answer they get.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CallRefusalTest {
    @get:Rule val compose = createEmptyComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val dialled = mutableListOf<Uri>()

    @Before
    fun enforceRulesWithoutContacts() {
        ContactPolicySources.override = {
            object : EditableContactPolicySource {
                override fun rules() = ContactRules(enforced = true, contacts = emptyList(), country = null)
                override fun add(contact: ApprovedContact) = Result.failure<ApprovedContact>(UnsupportedOperationException())
                override fun remove(number: String) = Unit
            }
        }
        TelecomHandoff.interceptForTest = { dialled += it }
        RecentDials.clear()
    }

    @After
    fun reset() {
        ContactPolicySources.override = null
        TelecomHandoff.interceptForTest = null
    }

    /** A test dial never reaches Telecom, so it must not count as a recent dial (#273). */
    @Test
    @SuppressLint("MissingPermission")
    fun `a call swallowed by the test hook is not remembered as dialled`() {
        TelecomHandoff.submit(context, Uri.fromParts("tel", "+12025550101", null))
        assertThat(dialled).hasSize(1)
        assertThat(RecentDials.wasJustDialled("+12025550101", null)).isFalse()
    }

    @Test
    fun `the keypad opened by a tel link says why a stranger cannot be called`() {
        val dial = Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", "+12025550101", null))
        Robolectric.buildActivity(PhoneActivity::class.java, dial).setup().use {
            compose.onNodeWithContentDescription(context.getString(R.string.action_call_plain)).performClick()
            compose.onNodeWithText(context.getString(R.string.call_not_allowed)).assertIsDisplayed()
            assertThat(dialled).isEmpty()
            // Still there later: not a message that times out before the child has read it.
            compose.mainClock.advanceTimeBy(30_000)
            compose.onNodeWithText(context.getString(R.string.call_not_allowed)).assertIsDisplayed()
            // A new digit is a new number: the old answer no longer applies.
            compose.onNodeWithText("1").performClick()
            compose.onNodeWithText(context.getString(R.string.call_not_allowed)).assertDoesNotExist()
        }
    }
}
