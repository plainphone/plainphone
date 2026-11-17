// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import java.io.File
import java.io.IOException
import org.json.JSONObject

/**
 * What the server says the newest app release is (`GET /download/android/latest`).
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
    sealed interface Verdict {
        data object Install : Verdict
        data class Refuse(val why: String) : Verdict
    }

    fun check(installed: ApkInfo, candidate: ApkInfo): Verdict = when {
        candidate.packageName != installed.packageName ->
            Verdict.Refuse("APK is ${candidate.packageName}, not ${installed.packageName}")
        // Never downgrade, and an equal version is nothing to do.
        candidate.versionCode <= installed.versionCode ->
            Verdict.Refuse("APK is version ${candidate.versionCode}, installed is ${installed.versionCode}")
        installed.certSha256.isEmpty() || candidate.certSha256.isEmpty() ->
            Verdict.Refuse("signing certificate could not be read")
        candidate.certSha256 != installed.certSha256 -> Verdict.Refuse("APK is signed with another certificate")
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

/** What the dashboard sees about updates (sent with the phone's status). */
data class UpdateReport(val state: String, val detail: String?, val checkedAtMs: Long?, val latestVersionName: String?) {
    fun toJson(): JSONObject = JSONObject()
        .put("state", state)
        .put("detail", detail?.take(200) ?: JSONObject.NULL)
        .put("checkedAt", checkedAtMs?.let { java.time.Instant.ofEpochMilli(it).toString() } ?: JSONObject.NULL)
        .put("latestVersion", latestVersionName?.take(40) ?: JSONObject.NULL)
}

/** Remembers the last outcome and when the last full check ran. */
interface UpdateStateStore {
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
    private val lease: InstallLease,
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
        if (!force && now - store.lastCheckMs < CHECK_EVERY_MS) return Outcome.Skipped("checked recently")
        if (host.inMaintenance()) return Outcome.Skipped("maintenance unlock")

        val installed = host.installed()
        val latest = try {
            host.fetchLatest()
        } catch (e: Exception) {
            return failed("release check failed: ${e.message ?: e.javaClass.simpleName}", latest = null)
        }
        if (UpdatePolicy.isUpToDate(installed, latest)) {
            store.lastCheckMs = now
            store.report = UpdateReport(STATE_UP_TO_DATE, null, now, latest?.versionName)
            return Outcome.UpToDate(installed.versionCode)
        }
        if (!host.isDeviceOwner()) {
            // Light mode cannot install by itself. Without metadata it cannot know there is anything new.
            if (latest == null) return failed("no release metadata on the server", latest = null)
            host.promptUpdate(latest)
            store.lastCheckMs = now
            store.report = UpdateReport(STATE_PROMPTED, null, now, latest.versionName)
            return Outcome.Waiting("asked the user to update")
        }
        if (!force && !host.downloadAllowed()) {
            // Not marked as checked: the next periodic run tries again once on Wi-Fi or charging.
            store.report = UpdateReport(STATE_AVAILABLE, "waiting for Wi-Fi or charging", now, latest?.versionName)
            return Outcome.Waiting("waiting for Wi-Fi or charging")
        }

        val apk = try {
            host.download(latest?.url ?: host.fallbackUrl(), latest?.sha256)
        } catch (e: Exception) {
            return failed("download failed: ${e.message ?: e.javaClass.simpleName}", latest)
        }
        try {
            val candidate = host.inspect(apk) ?: return failed("downloaded file is not a readable APK", latest)
            if (latest != null && candidate.versionCode != latest.versionCode) {
                return failed("APK is version ${candidate.versionCode}, release says ${latest.versionCode}", latest)
            }
            when (val verdict = UpdatePolicy.check(installed, candidate)) {
                is UpdatePolicy.Verdict.Refuse -> {
                    store.lastCheckMs = now
                    // No metadata and the newest APK is what we run: that is simply up to date.
                    val state = if (candidate.versionCode == installed.versionCode) STATE_UP_TO_DATE else STATE_REFUSED
                    store.report = UpdateReport(state, verdict.why.takeIf { state == STATE_REFUSED }, now, candidate.versionName)
                    return if (state == STATE_UP_TO_DATE) Outcome.UpToDate(installed.versionCode) else Outcome.Refused(verdict.why)
                }
                UpdatePolicy.Verdict.Install -> Unit
            }
            store.report = UpdateReport(STATE_INSTALLING, null, now, candidate.versionName)
            // On success Android replaces the app and usually kills this process inside install();
            // the lease is then invalid (new versionCode) and MY_PACKAGE_REPLACED applies the lock.
            val error = lease.hold(LEASE_HOLDER) { host.install(apk) }
            if (error != null) return failed("install failed: $error", latest)
            store.lastCheckMs = now
            store.report = UpdateReport(STATE_UP_TO_DATE, null, now, candidate.versionName)
            return Outcome.Installed(candidate.versionCode)
        } finally {
            apk.delete()
        }
    }

    private fun failed(why: String, latest: ReleaseInfo?): Outcome.Failed {
        store.report = UpdateReport(STATE_FAILED, why, host.nowMs(), latest?.versionName)
        return Outcome.Failed(why)
    }

    companion object {
        /** A full check about once a day; the periodic worker runs more often and skips until then. */
        const val CHECK_EVERY_MS = 20 * 60 * 60_000L
        const val LEASE_HOLDER = "self-update"
        const val STATE_UP_TO_DATE = "upToDate"
        const val STATE_AVAILABLE = "available"
        const val STATE_INSTALLING = "installing"
        const val STATE_PROMPTED = "prompted"
        const val STATE_REFUSED = "refused"
        const val STATE_FAILED = "failed"
        private val LOCK = Any()
    }
}
