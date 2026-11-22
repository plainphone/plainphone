// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.distribution

/**
 * A separate screen with an explicit yes, shown before a setup step opens Android's own screen or
 * permission dialog (Google Play's prominent disclosure, docs/play/play-edition.md). Only builds
 * whose [Distribution.disclosure] returns one show it. String resources.
 */
data class PermissionDisclosure(
    val title: Int,
    val body: Int,
    val agree: Int,
    val decline: Int,
    /**
     * What "Not now" leaves behind, with a way to read the disclosure again. Null when the step is
     * optional: "Not now" then skips it like the step's own skip button.
     */
    val declined: Int?,
    val readAgain: Int,
)
