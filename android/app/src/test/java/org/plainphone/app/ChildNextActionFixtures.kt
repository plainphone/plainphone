// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import androidx.compose.runtime.Composable
import org.plainphone.app.light.BlockedActivity
import org.plainphone.app.light.BlockedScreen
import org.plainphone.app.ui.KeypadScreen

/** Synthetic fixtures shared by the screenshot and behaviour tests of UX package 3. */
object GuardFixture {
    @Composable
    fun screen(reason: BlockedActivity.Reason, onHome: () -> Unit = {}, onParent: () -> Unit = {}) =
        BlockedScreen(reason, appLabel = "Spotify", onHome = onHome, onReachParent = onParent, onEnterPin = {})

    @Composable
    fun timeUsedUp() = screen(BlockedActivity.Reason.TIME_USED_UP)

    @Composable
    fun notAllowed() = screen(BlockedActivity.Reason.NOT_ALLOWED)
}

object DialerFixture {
    @Composable
    fun keypad(onCall: (String) -> Unit = {}, onParents: () -> Unit = {}, onEmergency: () -> Unit = {}) =
        KeypadScreen(initial = "2012", onCall = onCall, onParents = onParents, onEmergency = onEmergency)
}
