// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.admin.DevicePolicyManager
import android.content.ComponentName

/**
 * Grants [permission] to [pkg] by Device Owner policy, but only when the policy does not already
 * grant it. Each grant of a location permission makes Android's permission controller post its
 * "admin allowed location" heads-up notification again. A tap on it opens the location
 * permission page, so re-granting on every policy apply would cover the child's screen after
 * every sync.
 */
fun DevicePolicyManager.grantByPolicy(admin: ComponentName, pkg: String, permission: String): Boolean =
    getPermissionGrantState(admin, pkg, permission) == DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED ||
        setPermissionGrantState(admin, pkg, permission, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
