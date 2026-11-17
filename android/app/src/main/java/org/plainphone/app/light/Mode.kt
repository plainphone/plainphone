// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.app.admin.DevicePolicyManager
import android.content.Context

/**
 * One APK, two modes (docs/light-mode.md). Provisioned by QR as Device Owner it is strong mode;
 * installed as an ordinary app on a phone already in use it is light mode. Nothing to configure:
 * the mode follows from what Android granted.
 */
object Mode {
    const val STRONG = "strong"
    const val LIGHT = "light"

    fun isStrong(context: Context): Boolean =
        context.getSystemService(DevicePolicyManager::class.java)?.isDeviceOwnerApp(context.packageName) == true

    fun isLight(context: Context): Boolean = !isStrong(context)

    fun name(context: Context): String = if (isStrong(context)) STRONG else LIGHT
}
