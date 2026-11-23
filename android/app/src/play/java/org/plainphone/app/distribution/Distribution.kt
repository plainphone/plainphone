// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.distribution

import android.content.Context
import org.plainphone.app.R
import org.plainphone.app.light.LightSetup

/**
 * The `play` flavor: the Google Play edition (docs/play/play-edition.md). Light mode with the Child
 * profile only, updated by Google Play, with the disclosures and the notice Play's policies ask for.
 * The `github` flavor has its own copy in src/github.
 */
object Distribution {
    /** Sent as `distribution` in `PUT /device/status`, so the server does not ask for a device admin. */
    const val NAME = "play"

    /** Google Play updates the app; Play forbids any other way ("Device and Network Abuse"). */
    const val SELF_UPDATES = false

    /**
     * No device admin and no Device Owner: Play's review advises against device admin in a parental
     * control app (docs/play/policy-review.md#device-admin). The guard protects Plainphone's own
     * settings pages instead.
     */
    const val DEVICE_ADMIN = false

    /** Play allows monitoring only in apps made for parents and their children, so no Myself. */
    const val MYSELF_PROFILE = false

    /** Play's prominent disclosure for the accessibility service and for location in the background. */
    fun disclosure(step: LightSetup.Step): PermissionDisclosure? = when (step) {
        LightSetup.Step.GUARD -> PermissionDisclosure(
            title = R.string.disclosure_guard_title,
            body = R.string.disclosure_guard_body,
            agree = R.string.disclosure_guard_agree,
            decline = R.string.disclosure_not_now,
            declined = R.string.disclosure_guard_declined,
            readAgain = R.string.disclosure_read_again,
        )
        LightSetup.Step.LOCATION -> PermissionDisclosure(
            title = R.string.disclosure_location_title,
            body = R.string.disclosure_location_body,
            agree = R.string.disclosure_location_agree,
            decline = R.string.disclosure_not_now,
            declined = null,
            readAgain = R.string.disclosure_read_again,
        )
        else -> null
    }

    /** Shows or removes the notice that Plainphone looks after this phone. */
    fun onStateChanged(context: Context) = MonitoringNotice.update(context)
}
