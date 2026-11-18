// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.PhoneNumbers
import org.plainphone.app.telephony.SmsThread
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "en")
class NewMessageActionTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun newMessageOpensAnUnsavedNumberOnlyForUnrestrictedSelf() {
        val rules = mutableStateOf(ContactRules(false, emptyList(), PhoneNumbers.countryForIso("DK")))
        var destination: SmsThread? = null
        compose.setContent {
            PlainphoneTheme { NewMessageAction(rules.value) { destination = it } }
        }
        compose.onNodeWithText("New message").assertDoesNotExist()
        compose.runOnIdle { rules.value = rules.value.copy(selfProfile = true, enforced = true) }
        compose.onNodeWithText("New message").assertDoesNotExist()
        compose.runOnIdle { rules.value = rules.value.copy(enforced = false) }
        compose.onNodeWithText("New message").performClick()
        compose.onNodeWithText("Phone number").performTextInput("23456789")
        compose.onNodeWithText("Continue").performClick()
        compose.runOnIdle { assertEquals(SmsThread("+4523456789"), destination) }
    }
}
