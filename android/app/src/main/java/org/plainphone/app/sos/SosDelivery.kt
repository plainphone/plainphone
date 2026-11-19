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

internal enum class SosKind(val wire: String) { URGENT("urgent"), HELP("help") }

internal object SosDelivery {
    fun api(context: Context) = PlainphoneApi(ConfigStore(context).load().serverUrl, context)

    fun enqueue(context: Context, phoneId: String, kind: SosKind): String {
        val prefs = prefs(context)
        val cutoff = System.currentTimeMillis() - 30L * 86_400_000
        val prune = prefs.edit()
        prefs.all.forEach { (key, value) ->
            if (key.startsWith("time:") && value is Long && value <= cutoff) {
                val expired = key.removePrefix("time:")
                prune.remove(key).remove("status:$expired").remove("position:$expired").remove("sms-claim:$expired")
                    .remove("sms-names:$expired").remove("call-claim:$expired")
            }
        }
        val id = UUID.randomUUID().toString()
        prune.putLong("time:$id", System.currentTimeMillis()).apply()
        prefs.edit().putString("last:$phoneId", id).apply()
        val request = OneTimeWorkRequestBuilder<SosWorker>()
            .setInputData(workDataOf("id" to id, "phone" to phoneId, "kind" to kind.wire, "at" to System.currentTimeMillis()))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(id, ExistingWorkPolicy.KEEP, request)
        return id
    }

    fun prefs(context: Context) = context.getSharedPreferences("plainphone_sos", Context.MODE_PRIVATE)
    fun smsNames(context: Context, id: String): List<String> =
        prefs(context).getStringSet("sms-names:$id", emptySet()).orEmpty().sorted()

    fun status(context: Context, id: String): String? = prefs(context).getString("status:$id", null)
}

class SosWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val context = applicationContext
        val id = inputData.getString("id") ?: return@withContext Result.failure()
        val phone = inputData.getString("phone")
        val kind = inputData.getString("kind") ?: return@withContext Result.failure()
        val at = inputData.getLong("at", 0)
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
        suspend fun startUrgentCall() {
            if (kind != SosKind.URGENT.wire || sos.parents.isEmpty()) return
            withContext(Dispatchers.Main.immediate) {
                if (SyncStore(context).phoneId == phone && claimSosAction(prefs, "call-claim:$id", at)) {
                    SosCalls.start(context, phone, sos.parents)
                }
            }
        }

        try {
            SosDelivery.api(context).reportSos(token, payload)
            startUrgentCall()
            prefs.edit().putString(key, "online").remove(positionKey).apply()
            return@withContext Result.success()
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
            val description = if (kind == "urgent") "akut" else "har brug for hjælp"
            val position = location?.let { "https://maps.google.com/?q=${it.getDouble("lat")},${it.getDouble("lon")}" } ?: "ukendt"
            val text = "SOS fra ${sos.name}: $description. Position: $position. Sendt via Plainphone."
            val submitted = submitSosFallback(prefs, id, at, sos.parents) { number ->
                submitSosSms(context, number, text)
            }
            if (submitted.isNotEmpty()) {
                prefs.edit().putString(key, "sms").putStringSet("sms-names:$id", submitted.map { it.name }.toSet()).commit()
            }
        }
        when (SosDelivery.status(context, id)) {
            "sms" -> startUrgentCall()
            null -> prefs.edit().putString(key, "pending").apply()
        }
        Result.retry()
    }
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
private fun claimSosAction(prefs: SharedPreferences, key: String, at: Long): Boolean =
    !prefs.contains(key) && prefs.edit().putLong(key, at).commit()

private fun canSendSms(context: Context): Boolean =
    context.getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_SMS) == true &&
        context.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED

private fun submitSosSms(context: Context, number: String, text: String): Boolean {
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
