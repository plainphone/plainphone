// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import java.io.File
import java.io.IOException
import org.json.JSONException
import org.json.JSONObject

/**
 * What the server says the newest app release is (`GET /download/android/latest.json`).
 * [url] is where the APK itself is; [sha256] is the file's hex SHA-256 when the release has it.
 */
data class ReleaseInfo(val versionCode: Long, val versionName: String, val url: String, val sha256: String?) {
    companion object {
        /** Throws on anything malformed: a broken answer never leads to an install. */
        fun parse(text: String): ReleaseInfo {
            val j = JSONObject(text)
            val code = j.getLong("versionCode")
            require(code > 0) { "bad versionCode $code" }
            val url = j.getString("url")
            require(url.startsWith("https://")) { "APK url must be https" }
            val sha = j.optString("sha256", "").lowercase().takeIf { it.isNotEmpty() && it != "null" }
            require(sha == null || SHA256_HEX.matches(sha)) { "bad sha256" }
            return ReleaseInfo(code, j.optString("versionName", "").take(40), url, sha)
        }

        private val SHA256_HEX = Regex("^[0-9a-f]{64}$")
    }
}

/** The facts about an APK (installed or downloaded) that decide whether it may replace us. */
data class ApkInfo(val packageName: String, val versionCode: Long, val versionName: String, val certSha256: Set<String>)

/** The pure checks. An update must be ours, strictly newer and signed with exactly the same certificate(s). */
object UpdatePolicy {
    private val productionSigner = setOf("8868fc1677af4a3a6f6d3e858ce26df9b6ec1107359dbb3c23831b0ce0541215")

    sealed interface Verdict {
        data object Install : Verdict
        data class Refuse(val code: UpdateErrorCode, val why: String) : Verdict
    }

    fun check(installed: ApkInfo, candidate: ApkInfo): Verdict = when {
        candidate.packageName != installed.packageName ->
            Verdict.Refuse(UpdateErrorCode.METADATA_MISMATCH, "APK is ${candidate.packageName}, not ${installed.packageName}")
        // Never downgrade, and an equal version is nothing to do.
        candidate.versionCode <= installed.versionCode ->
            Verdict.Refuse(UpdateErrorCode.VERSION_NOT_NEWER, "APK is version ${candidate.versionCode}, installed is ${installed.versionCode}")
        installed.certSha256.isEmpty() || candidate.certSha256.isEmpty() ->
            Verdict.Refuse(UpdateErrorCode.SIGNATURE_MISMATCH, "signing certificate could not be read")
        candidate.certSha256 == productionSigner && installed.certSha256 != productionSigner ->
            Verdict.Refuse(
                UpdateErrorCode.SIGNATURE_MISMATCH,
                "This update is signed with the new Plainphone key. Set up the phone again to install it.",
            )
        candidate.certSha256 != installed.certSha256 ->
            Verdict.Refuse(UpdateErrorCode.SIGNATURE_MISMATCH, "APK is signed with another certificate")
        else -> Verdict.Install
    }

    /** True when the server's metadata says there is nothing newer, so nothing is downloaded. */
    fun isUpToDate(installed: ApkInfo, latest: ReleaseInfo?) = latest != null && latest.versionCode <= installed.versionCode
}

/** The phone-side effects of an update. [AndroidUpdateHost] is the real one; tests use a fake. */
interface UpdateHost {
    fun nowMs(): Long
    fun installed(): ApkInfo
    fun isDeviceOwner(): Boolean
    fun needsBatteryExemption(): Boolean
    fun promptBatteryExemption()
    /** A maintenance unlock is running: a parent works on the phone, leave it alone. */
    fun inMaintenance(): Boolean
    /** Unmetered network or charging: a background download is fine. */
    fun downloadAllowed(): Boolean
    /** The server's release metadata, or null when the server has none (older or self-hosted without it). */
    @Throws(IOException::class)
    fun fetchLatest(): ReleaseInfo?
    /** Where to download from when there is no metadata (the server's stable `/download/android`). */
    fun fallbackUrl(): String
    /**
     * Downloads [url] to a fresh file. Throws [IOException] on any network error, on a short file and
     * on a [sha256] mismatch; a partial file is deleted before it throws.
     */
    @Throws(IOException::class)
    fun download(url: String, sha256: String?): File
    /** Reads package name, version and signing certificates from an APK file; null if unreadable. */
    fun inspect(apk: File): ApkInfo?
    /** Installs [apk] silently (Device Owner). Blocking. Returns null on success, else why it failed. */
    fun install(apk: File): String?
    /** Light mode: tell the child (and so the parent) that a new version can be installed. */
    fun promptUpdate(latest: ReleaseInfo)
}

enum class UpdateErrorCode {
    BATTERY_EXEMPTION_MISSING, NETWORK, SIGNATURE_MISMATCH, VERSION_NOT_NEWER, METADATA_MISMATCH, INSTALL_FAILED, UNKNOWN;

    val wireName get() = name.lowercase()
}

internal class BatteryExemptionMissingException(message: String, cause: Throwable? = null) :
    IllegalStateException(message, cause)

internal class UpdateMetadataException(message: String) : IOException(message)

/** What the dashboard sees about updates (sent with the phone's status). */
data class UpdateReport(
    val state: String,
    val detail: String?,
    val checkedAtMs: Long?,
    val latestVersionName: String?,
    val promptedVersionCode: Long? = null,
    val errorCode: UpdateErrorCode? = null,
) {
    fun reconcileInstalled(installed: ApkInfo): UpdateReport {
        if (state != SelfUpdater.STATE_PROMPTED) return this
        val targetInstalled = promptedVersionCode?.let { installed.versionCode >= it }
            ?: (latestVersionName == installed.versionName)
        return if (targetInstalled) UpdateReport(SelfUpdater.STATE_UP_TO_DATE, null, checkedAtMs, installed.versionName)
        else this
    }

    fun toJson(): JSONObject = JSONObject()
        .put("state", state)
        .put("errorCode", errorCode?.wireName)
        .put("detail", detail?.take(200) ?: JSONObject.NULL)
        .put("checkedAt", checkedAtMs?.let { java.time.Instant.ofEpochMilli(it).toString() } ?: JSONObject.NULL)
        .put("latestVersion", latestVersionName?.take(40) ?: JSONObject.NULL)
}

/** Remembers the last outcome and when the last full check ran. */
interface UpdateStateStore {
    var installingVersionCode: Long
    var lastCheckMs: Long
    var report: UpdateReport?
    /** The parent's last "Update now" that was handled (rules `update.requestedAt`). */
    var handledRequestMs: Long
}

/**
 * Checks for a newer app and installs it. Strong mode: silently, as Device Owner, inside an
 * [InstallLease]. Light mode: a prompt. Every failure leaves the installed app and the lock as
 * they were; the next check tries again.
 */
class SelfUpdater(
    private val host: UpdateHost,
    private val store: UpdateStateStore,
) {
    sealed interface Outcome {
        data class Skipped(val why: String) : Outcome
        data class UpToDate(val versionCode: Long) : Outcome
        /** Newer version known, waiting for Wi-Fi or charging (or for the child in light mode). */
        data class Waiting(val why: String) : Outcome
        data class Refused(val why: String) : Outcome
        data class Failed(val why: String) : Outcome
        /** Only seen when the install did not restart the app (tests, or Android kept it running). */
        data class Installed(val versionCode: Long) : Outcome
    }

    /** [force]: the parent pressed "Update now", so any network is fine and the daily spacing is skipped. */
    fun run(force: Boolean): Outcome = synchronized(LOCK) { runLocked(force) }

    private fun runLocked(force: Boolean): Outcome {
        val now = host.nowMs()
        if (!force && now - store.lastCheckMs in 0 until CHECK_EVERY_MS) return Outcome.Skipped("checked recently")
        if (host.inMaintenance()) return Outcome.Skipped("maintenance unlock")

        if (force && host.needsBatteryExemption()) return batteryExemptionFailure(prompt = true, latest = null)
        if (!force && !host.downloadAllowed()) return Outcome.Skipped("waiting for Wi-Fi or charging")
        store.lastCheckMs = now
        val installed = host.installed()
        val latest = try {
            host.fetchLatest()
        } catch (e: Exception) {
            val code = when (e) {
                is UpdateMetadataException, is JSONException, is IllegalArgumentException -> UpdateErrorCode.METADATA_MISMATCH
                is IOException -> UpdateErrorCode.NETWORK
                else -> UpdateErrorCode.UNKNOWN
            }
            return failed(code, "release check failed: ${e.message ?: e.javaClass.simpleName}", latest = null)
        }
        if (UpdatePolicy.isUpToDate(installed, latest)) {
            store.report = UpdateReport(STATE_UP_TO_DATE, null, now, latest?.versionName)
            return Outcome.UpToDate(installed.versionCode)
        }
        if (!host.isDeviceOwner()) {
            // Light mode cannot install by itself. Without metadata it cannot know there is anything new.
            if (latest == null) return failed(UpdateErrorCode.METADATA_MISMATCH, "no release metadata on the server", latest = null)
            host.promptUpdate(latest)
            store.report = UpdateReport(STATE_PROMPTED, null, now, latest.versionName, latest.versionCode)
            return Outcome.Waiting("asked the user to update")
        }
        if (host.needsBatteryExemption()) return batteryExemptionFailure(force, latest)
        val apk = try {
            host.download(latest?.url ?: host.fallbackUrl(), latest?.sha256)
        } catch (e: Exception) {
            val code = when (e) {
                is UpdateMetadataException -> UpdateErrorCode.METADATA_MISMATCH
                is IOException -> UpdateErrorCode.NETWORK
                else -> UpdateErrorCode.UNKNOWN
            }
            return failed(code, "download failed: ${e.message ?: e.javaClass.simpleName}", latest)
        }
        try {
            val candidate = host.inspect(apk)
                ?: return failed(UpdateErrorCode.METADATA_MISMATCH, "downloaded file is not a readable APK", latest)
            if (latest != null && candidate.versionCode != latest.versionCode) {
                return failed(
                    UpdateErrorCode.METADATA_MISMATCH,
                    "APK is version ${candidate.versionCode}, release says ${latest.versionCode}", latest,
                )
            }
            when (val verdict = UpdatePolicy.check(installed, candidate)) {
                is UpdatePolicy.Verdict.Refuse -> {
                    // No metadata and the newest APK is what we run: that is simply up to date.
                    val state = if (candidate == installed) STATE_UP_TO_DATE else STATE_REFUSED
                    store.report = if (state == STATE_UP_TO_DATE) {
                        UpdateReport(state, null, now, candidate.versionName)
                    } else {
                        UpdateReport(state, verdict.why, now, candidate.versionName, errorCode = verdict.code)
                    }
                    return if (state == STATE_UP_TO_DATE) Outcome.UpToDate(installed.versionCode) else Outcome.Refused(verdict.why)
                }
                UpdatePolicy.Verdict.Install -> Unit
            }
            // Re-read after downloading, in case another installer changed the installed app.
            val current = host.installed()
            val verdict = UpdatePolicy.check(current, candidate)
            if (verdict is UpdatePolicy.Verdict.Refuse) {
                return failed(verdict.code, "installed app changed during the download: ${verdict.why}", latest)
            }
            if (host.inMaintenance()) return Outcome.Skipped("maintenance unlock")
            store.report = UpdateReport(STATE_INSTALLING, null, now, candidate.versionName)
            store.installingVersionCode = candidate.versionCode
            // On success Android usually kills this process; the next startup reconciles the version.
            val error = try {
                host.install(apk)
            } catch (_: BatteryExemptionMissingException) {
                return batteryExemptionFailure(force, latest)
            } catch (e: Exception) {
                e.message ?: e.javaClass.simpleName
            } finally {
                store.installingVersionCode = 0L
            }
            if (error != null) return failed(UpdateErrorCode.INSTALL_FAILED, "install failed: $error", latest)
            store.report = UpdateReport(STATE_UP_TO_DATE, null, now, candidate.versionName)
            return Outcome.Installed(candidate.versionCode)
        } finally {
            apk.delete()
        }
    }

    private fun batteryExemptionFailure(prompt: Boolean, latest: ReleaseInfo?): Outcome.Failed {
        if (prompt) host.promptBatteryExemption()
        return failed(UpdateErrorCode.BATTERY_EXEMPTION_MISSING, UpdateBatteryExemption.FIX, latest)
    }

    private fun failed(code: UpdateErrorCode, why: String, latest: ReleaseInfo?): Outcome.Failed {
        store.report = UpdateReport(STATE_FAILED, why, host.nowMs(), latest?.versionName, errorCode = code)
        return Outcome.Failed(why)
    }

    companion object {
        /** A full check about once a day; the periodic worker runs more often and skips until then. */
        const val CHECK_EVERY_MS = 24 * 60 * 60_000L
        const val STATE_UP_TO_DATE = "upToDate"
        const val STATE_INSTALLING = "installing"
        const val STATE_PROMPTED = "prompted"
        const val STATE_REFUSED = "refused"
        const val STATE_FAILED = "failed"
        private val LOCK = Any()
    }
}
