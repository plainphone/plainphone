// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import org.plainphone.app.light.CalmScreen
import org.plainphone.app.ui.KeypadScreen

object GuardFixture {
    @Composable
    fun timeUsedUp() = CalmScreen(
        eyebrow = "Spotify",
        title = stringResource(R.string.blocked_time_title),
        body = stringResource(R.string.blocked_time_body),
        primary = stringResource(R.string.blocked_ok),
        onPrimary = {},
    )

    @Composable
    fun notAllowed() = CalmScreen(
        eyebrow = "Spotify",
        title = stringResource(R.string.blocked_not_allowed_title),
        body = stringResource(R.string.blocked_not_allowed_body),
        primary = stringResource(R.string.blocked_ok),
        onPrimary = {},
    )
}

object DialerFixture {
    @Composable
    fun keypad() = KeypadScreen(initial = "2012", onCall = {})
}
