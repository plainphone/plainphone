// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sos

import android.Manifest
import android.app.role.RoleManager
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.plainphone.app.ConfigStore
import org.plainphone.app.Compat
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.contactPolicy
import org.plainphone.app.sync.AndroidSyncDevice
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.LocationReader
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.SyncStore

/** How long after pressing the button a call that could not start is retried before the child is told. */
internal const val CALL_RETRY_WINDOW_MS = 10 * 60_000L

internal enum class SosKind(val wire: String) { URGENT("urgent"), HELP("help") }

internal object SosDelivery {
    fun api(context: Context) = PlainphoneApi(ConfigStore(context).load().serverUrl, context)

    /**
     * Queues a report. With a [trigger] ("power", "clock", "code") it is a silent urgent SOS: no call,
     * nothing on the SOS screen, and [message] (only with "code") goes along (docs/sos.md).
     */
    fun enqueue(context: Context, phoneId: String, kind: SosKind, trigger: String? = null, message: String? = null): String {
        require(trigger == null || kind == SosKind.URGENT) { "a hidden SOS is urgent" }
        require((trigger == "code") == (message != null)) { "a message goes with a code word only" }
        val prefs = prefs(context)
        val cutoff = System.currentTimeMillis() - 30L * 86_400_000
        val prune = prefs.edit()
        prefs.all.forEach { (key, value) ->
            if (key.startsWith("time:") && value is Long && value <= cutoff) {
                val expired = key.removePrefix("time:")
                prune.remove(key).remove("status:$expired").remove("position:$expired").remove("sms-claim:$expired")
                    .remove("sms-names:$expired").remove("call-claim:$expired").remove("call-missed:$expired")
            }
        }
        val id = UUID.randomUUID().toString()
        prune.putLong("time:$id", System.currentTimeMillis()).apply()
        // A silent SOS never shows on the SOS screen.
        if (trigger == null) prefs.edit().putString("last:$phoneId", id).apply()
        val request = OneTimeWorkRequestBuilder<SosWorker>()
            .setInputData(
                workDataOf(
                    "id" to id, "phone" to phoneId, "kind" to kind.wire, "at" to System.currentTimeMillis(),
                    "trigger" to trigger, "message" to message,
                ),
            )
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(id, ExistingWorkPolicy.KEEP, request)
        return id
    }

    fun prefs(context: Context) = context.getSharedPreferences("plainphone_sos", Context.MODE_PRIVATE)
    fun smsNames(context: Context, id: String): List<String> =
        prefs(context).getStringSet("sms-names:$id", emptySet()).orEmpty().sorted()

    fun callMissed(context: Context, id: String) = prefs(context).getBoolean("call-missed:$id", false)
    fun status(context: Context, id: String): String? = prefs(context).getString("status:$id", null)
}

class SosWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val context = applicationContext
        val id = inputData.getString("id") ?: return@withContext Result.failure()
        val phone = inputData.getString("phone")
        val kind = inputData.getString("kind") ?: return@withContext Result.failure()
        val at = inputData.getLong("at", 0)
        val trigger = inputData.getString("trigger")
        val message = inputData.getString("message")?.takeIf { trigger == "code" }
        val sync = SyncStore(context)
        val rules = sync.rules()
        val sos = rules?.sos
        val token = sync.deviceToken()
        val prefs = SosDelivery.prefs(context)
        val key = "status:$id"
        if (phone == null || phone != sync.phoneId || token == null || sos == null || rules.release ||
            System.currentTimeMillis() - at >= 30L * 86_400_000
        ) {
            prefs.edit().putString(key, "failed").remove("position:$id").apply()
            return@withContext Result.failure()
        }
        val fix = if (runAttemptCount == 0 && System.currentTimeMillis() - at <= 120_000 &&
            rules.locationEnabled && rules.locationMode != "off"
        ) {
            runCatching {
                LocationReader(context).current(precise = true, timeoutMs = 2_000, notBeforeMs = at - 120_000)
            }.getOrNull()
        } else null
        val positionKey = "position:$id"
        if (fix != null) prefs.edit().putString(positionKey, JSONObject().put("lat", fix.lat).put("lon", fix.lon).toString()).commit()
        if (!rules.locationEnabled || rules.locationMode == "off") prefs.edit().remove(positionKey).commit()
        val location = prefs.getString(positionKey, null)?.let(::JSONObject)
        val payload = JSONObject().put("id", id).put("kind", kind).put("sentAt", Instant.ofEpochMilli(at).toString())
            .put("location", location).put("battery", AndroidSyncDevice(context).battery().first)
            .put("smsSubmitted", SosDelivery.status(context, id) == "sms")
            .put("trigger", trigger).put("message", message)
        // True while the required call to the parents is still outstanding and should be retried.
        // The claim is taken only once a call has actually started, so a call that could not start
        // (already in a call, no permission) is tried again instead of being skipped for good.
        suspend fun urgentCallOutstanding(): Boolean {
            // A silent SOS never calls: a ringing call would give the child away.
            if (kind != SosKind.URGENT.wire || trigger != null || sos.parents.isEmpty() || prefs.contains("call-claim:$id")) return false
            val started = withContext(Dispatchers.Main.immediate) {
                SyncStore(context).phoneId == phone &&
                    SosCalls.start(context, phone, sos.parents) { claimSosAction(prefs, "call-claim:$id", at) }
            }
            if (started) return false
            if (System.currentTimeMillis() - at < CALL_RETRY_WINDOW_MS) return true
            prefs.edit().putBoolean("call-missed:$id", true).apply()
            return false
        }

        try {
            // A retry only to place the call must not report again.
            if (SosDelivery.status(context, id) != "online") SosDelivery.api(context).reportSos(token, payload)
            prefs.edit().putString(key, "online").remove(positionKey).apply()
            return@withContext if (urgentCallOutstanding()) Result.retry() else Result.success()
        } catch (e: HttpError) {
            if (e.status in 400..499 && e.status != 404) {
                if (SosDelivery.status(context, id) != "sms") prefs.edit().putString(key, "failed").apply()
                prefs.edit().remove(positionKey).apply()
                return@withContext Result.failure()
            }
        } catch (_: java.io.IOException) {
            // Try the carrier when the server cannot be reached.
        }

        if (!prefs.contains("sms-claim:$id") && canSendSms(context)) {
            val text = sosSmsText(sos.name, kind, trigger, message, location?.let { it.getDouble("lat") to it.getDouble("lon") })
            val submitted = submitSosFallback(prefs, id, at, sos.parents) { number ->
                submitSosSms(context, number, text)
            }
            if (submitted.isNotEmpty()) {
                prefs.edit().putString(key, "sms").putStringSet("sms-names:$id", submitted.map { it.name }.toSet()).commit()
            }
        }
        when (SosDelivery.status(context, id)) {
            "sms" -> urgentCallOutstanding()
            null -> prefs.edit().putString(key, "pending").apply()
        }
        Result.retry()
    }
}


/**
 * The fallback SMS. A code word is sent as just its text (plus a map link when there is a position),
 * so it looks like any quick message; everything else is the usual SOS text.
 */
internal fun sosSmsText(name: String, kind: String, trigger: String?, message: String?, position: Pair<Double, Double>?): String {
    val link = position?.let { (lat, lon) -> "https://maps.google.com/?q=$lat,$lon" }
    if (trigger == "code" && message != null) return listOfNotNull(message, link).joinToString(" ")
    val description = when {
        trigger != null -> "akut (skjult SOS)"
        kind == "urgent" -> "akut"
        else -> "har brug for hjælp"
    }
    return "SOS fra $name: $description. Position: ${link ?: "ukendt"}. Sendt via Plainphone."
}

internal fun submitSosFallback(
    prefs: SharedPreferences,
    id: String,
    at: Long,
    parents: List<ApprovedContact>,
    send: (String) -> Boolean,
): List<ApprovedContact> {
    if (parents.isEmpty() || !claimSosAction(prefs, "sms-claim:$id", at)) return emptyList()
    return parents.distinctBy { it.number }.filter { send(it.number) }
}

@Synchronized
internal fun claimSosAction(prefs: SharedPreferences, key: String, at: Long): Boolean =
    !prefs.contains(key) && prefs.edit().putLong(key, at).commit()

internal fun canSendSms(context: Context): Boolean =
    context.getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_SMS) == true &&
        context.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED

internal fun submitSosSms(context: Context, number: String, text: String): Boolean {
    if (!canSendSms(context)) return false
    val rules = ContactPolicySources.get(context).rules()
    if (rules.contactFor(number) == null ||
        !context.contactPolicy().decide(rules, Channel.SMS, Direction.OUTGOING, number).allowed
    ) return false
    return runCatching {
        val sms = Compat.smsManager(context)
        val parts = sms.divideMessage(text)
        sms.sendMultipartTextMessage(number, null, parts, null, null)
    }.isSuccess
}
