// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PairingQrTest {
    @Test fun matchesZxingModulesForKnownPairingUrl() {
        // Captured with ZXing 3.5.4 using its default error correction and MARGIN=0.
        val expected = checkNotNull(javaClass.getResourceAsStream("/qr/zxing-pairing-matrix.txt"))
            .bufferedReader().use { it.readLines() }
        val qr = encodePairingQr("https://plainphone.org/pair?code=K7MP-2345")
        val actual = List(qr.size) { y ->
            buildString(qr.size) {
                for (x in 0 until qr.size) append(if (qr.getModule(x, y)) '1' else '0')
            }
        }
        assertEquals(expected, actual)
    }
}
