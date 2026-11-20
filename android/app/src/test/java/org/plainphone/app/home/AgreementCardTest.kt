// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class AgreementCardTest {
    @Test
    fun `the home screen shows at most three lines and says when there are more`() {
        assertThat(homeAgreementPreview(listOf("a", "b"))).isEqualTo(listOf("a", "b") to false)
        assertThat(homeAgreementPreview(listOf("a", "b", "c"))).isEqualTo(listOf("a", "b", "c") to false)
        assertThat(homeAgreementPreview(listOf("a", "b", "c", "d"))).isEqualTo(listOf("a", "b", "c") to true)
    }
}
