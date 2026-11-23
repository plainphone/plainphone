// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.billing

import android.content.Context

/** The `github` flavor (GitHub Releases, F-Droid): no app store, so no paid offers are shown. */
object Stores {
    const val available = false

    @Suppress("UNUSED_PARAMETER")
    fun billing(context: Context): StoreBilling? = null
}
