// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.e2ee

import com.google.common.truth.Truth.assertThat
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import java.util.Base64
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.junit.Assume.assumeTrue
import org.junit.BeforeClass
import org.junit.Test

/**
 * The Kotlin → JNI → Rust path of the E2EE prototype on the host JVM. It needs a host build of
 * the core (`cargo build --release --lib --features jni` in e2ee/mls-core), passed with
 * `-PplainphoneMlsHostLib=<path to libplainphone_mls.so>`, and is skipped without it, so the
 * normal unit test run is unchanged. CI runs it in the e2ee-prototype job.
 */
class MlsCoreJniTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadLibrary() {
            val path = System.getProperty("plainphone.mlsHostLib").orEmpty()
            assumeTrue("set -PplainphoneMlsHostLib to run the JNI test", path.isNotEmpty() && File(path).isFile)
            System.load(path)
            MlsCore.markLoadedForTest()
        }
    }

    private val b64 = Base64.getUrlEncoder().withoutPadding()
    private val unb64 = Base64.getUrlDecoder()

    private fun call(json: String): JsonObject = JsonParser.parseString(MlsCore.request(json)).asJsonObject

    private fun ok(json: String): JsonObject {
        val r = call(json)
        assertThat(r["ok"].asBoolean).isTrue()
        return r
    }

    /** A synthetic device whose household-log key signs its MLS leaf key (the binding). */
    private inner class Device(val id: String, val role: String, seed: Byte) {
        private val log = Ed25519PrivateKeyParameters(ByteArray(32) { seed })
        val handle: Long
        val mlsSignPub: String

        init {
            val r = ok("""{"op":"new_client","deviceId":"$id"}""")
            handle = r["handle"].asLong
            mlsSignPub = r["mlsSignPub"].asString
        }

        fun entry(): String {
            val input = unb64.decode(ok("""{"op":"binding_input","deviceId":"$id","mlsSignPub":"$mlsSignPub"}""")["input"].asString)
            val signer = Ed25519Signer().apply { init(true, log); update(input, 0, input.size) }
            val logPub = b64.encodeToString(log.generatePublicKey().encoded)
            val binding = b64.encodeToString(signer.generateSignature())
            return """{"deviceId":"$id","role":"$role","logSignPub":"$logPub","mlsSignPub":"$mlsSignPub","binding":"$binding"}"""
        }
    }

    @Test
    fun selftestRunsThroughJni() {
        ok("""{"op":"selftest"}""")
    }

    @Test
    fun parentAndChildExchangeTextsThroughJni() {
        val parent = Device("jni-parent", "admin", 1)
        val child = Device("jni-child", "child", 2)
        val roster = "[${parent.entry()},${child.entry()}]"
        for (d in listOf(parent, child)) ok("""{"op":"set_roster","handle":${d.handle},"version":1,"roster":$roster}""")
        val kp = ok("""{"op":"key_packages","handle":${child.handle},"count":1}""")["keyPackages"].asJsonArray[0].asString
        val gid = ok("""{"op":"create_group","handle":${parent.handle}}""")["groupId"].asString
        val add = ok("""{"op":"add_members","handle":${parent.handle},"groupId":"$gid","keyPackages":["$kp"]}""")
        ok("""{"op":"merge_pending","handle":${parent.handle},"groupId":"$gid"}""")
        val joined = ok("""{"op":"process","handle":${child.handle},"message":"${add["welcome"].asString}"}""")
        assertThat(joined["kind"].asString).isEqualTo("joined")

        // Non-ASCII text crosses JNI as UTF-8 both ways.
        val text = "SYNTH hej fra far æøå ✓"
        val m = ok("""{"op":"encrypt","handle":${parent.handle},"groupId":"$gid","messageId":"jni-1","text":"$text"}""")
        val read = ok("""{"op":"process","handle":${child.handle},"message":"${m["message"].asString}"}""")
        assertThat(read["text"].asString).isEqualTo(text)
        assertThat(read["sender"].asString).isEqualTo("jni-parent")
        assertThat(ok("""{"op":"process","handle":${child.handle},"message":"${m["message"].asString}"}""")["kind"].asString)
            .isEqualTo("duplicate")
    }

    @Test
    fun errorsComeBackAsJsonNotExceptions() {
        val r = call("""{"op":"no_such_op"}""")
        assertThat(r["ok"].asBoolean).isFalse()
        assertThat(r["error"].asString).isEqualTo("bad_request")
        assertThat(call("not json")["ok"].asBoolean).isFalse()
    }
}
