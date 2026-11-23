// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.distribution

import android.content.Context
import org.plainphone.app.light.LightSetup

/**
 * The `github` flavor: GitHub Releases and F-Droid, the whole app (both modes, both profiles, the
 * self-updater). The `play` flavor has its own copy in src/play (docs/play/play-edition.md).
 */
object Distribution {
    /** Checks `/download/android/latest.json`; installs a newer APK in strong mode and offers it in light mode. */
    const val SELF_UPDATES = true

    /** Setup offers Myself (an adult's own phone) next to Child. */
    const val MYSELF_PROFILE = true

    /** No separate disclosure screens: the setup step's own text explains the permission. */
    @Suppress("UNUSED_PARAMETER")
    fun disclosure(step: LightSetup.Step): PermissionDisclosure? = null

    /** Something that decides whether Plainphone looks after the phone has changed. Nothing to do here. */
    @Suppress("UNUSED_PARAMETER")
    fun onStateChanged(context: Context) {}
}
