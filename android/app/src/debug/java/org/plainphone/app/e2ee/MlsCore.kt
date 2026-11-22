// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.e2ee

/**
 * E2EE phase 0 prototype (docs/e2ee-prototype.md): the binding to the OpenMLS core in
 * e2ee/mls-core. Test data only. This file is in the debug source set, so release builds do not
 * contain it, and the native library is packaged only with `-PplainphoneE2eePrototype=true`.
 * Nothing in the app calls it yet.
 *
 * The whole binding is one native function: a JSON request in, a JSON response out
 * (e2ee/mls-core/src/api.rs). The core holds the MLS state in memory; `export_state` returns
 * private keys in clear, so a real integration must encrypt it with an Android Keystore key and
 * keep it out of backups (gaps in docs/e2ee-prototype.md).
 */
object MlsCore {
    private var loaded = false

    /** Loads libplainphone_mls.so from the APK. False when this build has no prototype library. */
    @Synchronized
    fun load(): Boolean {
        if (!loaded) {
            loaded = try {
                System.loadLibrary("plainphone_mls")
                true
            } catch (_: UnsatisfiedLinkError) {
                false
            }
        }
        return loaded
    }

    /** JVM unit tests load a host build of the same library themselves, then call this. */
    @Synchronized
    internal fun markLoadedForTest() {
        loaded = true
    }

    /** Sends one request. The request bytes are zeroed afterwards; the response belongs to the caller. */
    fun request(json: String): String {
        check(loaded) { "the E2EE prototype library is not loaded" }
        val bytes = json.toByteArray(Charsets.UTF_8)
        try {
            return String(call(bytes), Charsets.UTF_8)
        } finally {
            bytes.fill(0)
        }
    }

    @JvmStatic
    private external fun call(request: ByteArray): ByteArray
}
