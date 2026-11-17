// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import org.plainphone.app.ConfigStore

/** The server side of attestation (server/openapi.yaml, `/device/attestation`). Faked in tests. */
interface AttestationApi {
    fun challenge(token: String): String
    /** Returns the server's verdict (`verified`, `unlocked`, ...). */
    fun submit(token: String, challenge: String, chain: List<ByteArray>): String
}

/** Makes a hardware-backed key for [challenge] and returns its certificate chain (DER, leaf first). */
fun interface KeyAttester {
    fun attest(challenge: ByteArray): List<ByteArray>
}

/** Where the last run is remembered. */
interface AttestationStore {
    var attestedAtMs: Long
    var retrySoon: Boolean
    var state: String?
}

/**
 * Hardware key attestation of the boot state (#23). Once a day (and right after pairing) the phone
 * asks the server for a challenge, makes a key in its TEE with that challenge, and sends the
 * certificate chain. The server alone decides what it means; the phone only remembers the verdict
 * for its status screen. No serial number or IMEI is attested. Never touches the lock.
 */
class AttestationRunner(
    private val api: AttestationApi,
    private val attester: KeyAttester,
    private val store: AttestationStore,
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    /** Returns the server's verdict when it ran, null when it was not due or failed. */
    fun runIfDue(token: String): String? {
        val now = nowMs()
        // Also back off after failures: a phone without attestation should not retry every minute.
        val interval = if (store.retrySoon) RETRY_MS else EVERY_MS
        if (now - store.attestedAtMs in 0 until interval) return null
        store.attestedAtMs = now
        store.retrySoon = false
        return try {
            val challenge = api.challenge(token)
            val challengeBytes = Base64.getUrlDecoder().decode(challenge)
            val chain = runCatching { attester.attest(challengeBytes) }.getOrElse {
                Log.w(TAG, "key attestation unavailable: ${it.javaClass.simpleName}")
                emptyList()
            }
            // A keystore without a certificate path cannot prove a hardware-backed key.
            val evidence = chain.takeIf { it.size >= 2 }.orEmpty()
            api.submit(token, challenge, evidence).also { store.state = it }
        } catch (e: Exception) {
            store.retrySoon = e is IOException && (e !is HttpError || e.status >= 500 || e.status == 429)
            Log.w(TAG, "attestation failed: ${e.javaClass.simpleName}: ${e.message}")
            null
        }
    }

    companion object {
        private const val TAG = "Plainphone"
        const val RETRY_MS = 60 * 60_000L
        const val EVERY_MS = 24 * 60 * 60_000L

        fun forContext(context: Context): AttestationRunner {
            val app = context.applicationContext
            return AttestationRunner(AttestationHttp(ConfigStore(app).load().serverUrl), KeystoreAttester(), PrefsAttestationStore(app))
        }

        /** The last verdict, for the status screen. */
        fun lastState(context: Context): String? = PrefsAttestationStore(context.applicationContext).state
    }
}

class PrefsAttestationStore(context: Context) : AttestationStore {
    private val prefs = context.getSharedPreferences("plainphone_attestation", Context.MODE_PRIVATE)
    override var attestedAtMs: Long
        get() = prefs.getLong("at", 0L)
        set(v) = prefs.edit().putLong("at", v).apply()
    override var retrySoon: Boolean
        get() = prefs.getBoolean("retrySoon", false)
        set(v) = prefs.edit().putBoolean("retrySoon", v).apply()
    override var state: String?
        get() = prefs.getString("state", null)
        set(v) = prefs.edit().putString("state", v).apply()
}

/** AndroidKeyStore: an EC key with an attestation challenge. The key is deleted straight after. */
class KeystoreAttester : KeyAttester {
    override fun attest(challenge: ByteArray): List<ByteArray> {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        try {
            val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            gen.initialize(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .setAttestationChallenge(challenge)
                    .build(),
            )
            gen.generateKeyPair()
            return ks.getCertificateChain(ALIAS)?.map { it.encoded } ?: error("no certificate chain")
        } finally {
            runCatching { ks.deleteEntry(ALIAS) }
        }
    }

    private companion object {
        const val ALIAS = "plainphone-attestation"
    }
}

/** Plain HTTP, like [PlainphoneApi]; never follows redirects with the token. */
class AttestationHttp(baseUrl: String) : AttestationApi {
    private val base = baseUrl.trimEnd('/') + "/api/device/attestation"

    private fun call(method: String, url: String, token: String, body: JSONObject?): Pair<Int, String> {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = conn.responseCode
            val text = (if (status >= 400) conn.errorStream else conn.inputStream)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return status to text
        } finally {
            conn.disconnect()
        }
    }

    override fun challenge(token: String): String {
        val (status, text) = call("POST", "$base/challenge", token, JSONObject())
        if (status != 200) throw HttpError(status, text)
        return JSONObject(text).getString("challenge")
    }

    override fun submit(token: String, challenge: String, chain: List<ByteArray>): String {
        val arr = JSONArray()
        chain.take(10).forEach { arr.put(Base64.getEncoder().encodeToString(it)) }
        val (status, text) = call("PUT", base, token, JSONObject().put("challenge", challenge).put("chain", arr))
        if (status != 200) throw HttpError(status, text)
        return JSONObject(text).getString("state")
    }
}
