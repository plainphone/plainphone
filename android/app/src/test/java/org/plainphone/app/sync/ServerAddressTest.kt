// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerAddressTest {
    @Test fun acceptsTlsOrigin() {
        assertEquals("https://plainphone.example.org:8443",
            ServerAddress.normalize(" https://plainphone.example.org:8443/ ", debug = false))
    }

    @Test fun rejectsAmbiguousOrigins() {
        for (input in listOf("https://plainphone.example.org/path", "https://user@plainphone.example.org",
            "https://plainphone.example.org?", "https://plainphone.example.org/#", "https://plainphone.example.org:65536")) {
            assertNull(input, ServerAddress.normalize(input, debug = false))
        }
    }

    @Test fun permitsCleartextOnlyForLocalDebugServers() {
        assertEquals("http://localhost:8080", ServerAddress.normalize("http://localhost:8080", debug = true))
        assertEquals("http://plainphone-test.local:8080", ServerAddress.normalize("http://plainphone-test.local:8080", debug = true))
        assertNull(ServerAddress.normalize("http://localhost", debug = false))
        assertNull(ServerAddress.normalize("http://localhost.example.org", debug = true))
    }
}
