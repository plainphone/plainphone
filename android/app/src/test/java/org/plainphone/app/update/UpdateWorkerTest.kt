// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.app.Application
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class UpdateWorkerTest {
    @Test
    fun `each startup step can fail without stopping the other step or the update check`() {
        for (failedStep in listOf("recover", "reconcile")) {
            val steps = mutableListOf<String>()
            val failure = IllegalStateException(failedStep)
            fun step(name: String) {
                steps += name
                if (name == failedStep) throw failure
            }

            val result = runUpdateCheck(
                recoverInstall = { step("recover") },
                reconcileOnStart = { step("reconcile") },
                checkForUpdate = { step("update"); "result" },
            )
            assertThat(steps).containsExactly("recover", "reconcile", "update").inOrder()
            assertThat(result).isEqualTo("result")
            assertThat(ShadowLog.getLogsForTag("Plainphone").map { it.throwable }).contains(failure)
        }
    }
}
