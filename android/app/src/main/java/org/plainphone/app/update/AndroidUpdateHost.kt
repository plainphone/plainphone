// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import org.plainphone.app.Compat
import org.plainphone.app.ConfigStore
import org.plainphone.app.Lock
import org.plainphone.app.R

/** Real phone effects for [SelfUpdater]. Blocking: call it from a worker thread. */
class AndroidUpdateHost(context: Context) : UpdateHost {
    private val context = context.applicationContext
    private val pm = this.context.packageManager
    private val serverUrl get() = ConfigStore(context).load().serverUrl.trimEnd('/')

    override fun nowMs() = System.currentTimeMillis()

    override fun installed(): ApkInfo = apkInfo(Compat.packageInfo(pm, context.packageName, certFlags()))

    override fun isDeviceOwner(): Boolean =
        context.getSystemService(android.app.admin.DevicePolicyManager::class.java)?.isDeviceOwnerApp(context.packageName) == true

    override fun inMaintenance() = Lock.isInMaintenanceWindow(context)

    override fun downloadAllowed(): Boolean {
        val metered = context.getSystemService(ConnectivityManager::class.java)?.isActiveNetworkMetered ?: true
        val charging = context.getSystemService(BatteryManager::class.java)?.isCharging ?: false
        return !metered || charging
    }

    override fun fetchLatest(): ReleaseInfo? {
        val conn = open("$serverUrl/download/android/latest.json", followRedirects = false)
        try {
            conn.setRequestProperty("Accept", "application/json")
            return when (val status = conn.responseCode) {
                200 -> ReleaseInfo.parse(conn.inputStream.use { stream ->
                    val out = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(1024)
                    while (true) {
                        val count = stream.read(buffer)
                        if (count == -1) break
                        if (out.size() + count > MAX_METADATA) throw IOException("release metadata is too large")
                        out.write(buffer, 0, count)
                    }
                    out.toString(Charsets.UTF_8.name())
                })
                404 -> null // older server, or a self-hoster's own build without metadata
                else -> throw IOException("release metadata: HTTP $status")
            }
        } finally {
            conn.disconnect()
        }
    }

    override fun fallbackUrl() = "$serverUrl/download/android"

    override fun download(url: String, sha256: String?): File =
        downloadApk(File(context.noBackupFilesDir, "update"), sha256) { open(url, followRedirects = true) }

    override fun inspect(apk: File): ApkInfo? = runCatching {
        @Suppress("DEPRECATION")
        val info = pm.getPackageArchiveInfo(apk.path, certFlags())
        info?.let(::apkInfo)
    }.getOrNull()

    override fun install(apk: File): String? {
        val installer = pm.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val sessionId = try {
            installer.createSession(params)
        } catch (e: SecurityException) {
            return "Android refused the install session: ${e.message}"
        }
        val waiter = UpdateReceiver.expect(sessionId)
        var succeeded = false
        try {
            installer.openSession(sessionId).use { session ->
                session.openWrite("plainphone.apk", 0, apk.length()).use { out ->
                    apk.inputStream().use { it.copyTo(out) }
                    session.fsync(out)
                }
                InstallLease.android(context).bindSession(sessionId)
                session.commit(UpdateReceiver.statusIntent(context, sessionId).intentSender)
            }
            // On success Android usually kills this process before the answer arrives.
            val result = waiter.await(INSTALL_TIMEOUT_MIN, TimeUnit.MINUTES)
                ?: return "no answer from the installer within $INSTALL_TIMEOUT_MIN minutes"
            succeeded = result.status == PackageInstaller.STATUS_SUCCESS
            return if (succeeded) null else "status ${result.status}: ${result.message ?: "no message"}"
        } finally {
            UpdateReceiver.forget(sessionId)
            if (!succeeded) runCatching { installer.abandonSession(sessionId) }
        }
    }

    override fun promptUpdate(latest: ReleaseInfo) {
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.channel_updates), NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(Intent.ACTION_VIEW, Uri.parse(latest.url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = android.app.Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_plainphone)
            .setContentTitle(context.getString(R.string.update_prompt_title))
            .setContentText(context.getString(R.string.update_prompt_text, latest.versionName))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { nm.notify(NOTIFICATION_ID, notification) } // no POST_NOTIFICATIONS grant: the status still says so
    }

    fun clearUpdatePrompt() {
        context.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
    }

    private fun open(url: String, followRedirects: Boolean): HttpURLConnection {
        require(url.startsWith("https://")) { "only https" }
        return (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            useCaches = false
            instanceFollowRedirects = followRedirects
            setRequestProperty("User-Agent", "plainphone-app")
        }
    }

    private fun certFlags() = PackageManager.GET_SIGNING_CERTIFICATES

    private fun apkInfo(info: PackageInfo): ApkInfo {
        val certs = info.signingInfo?.apkContentsSigners.orEmpty().map { sha256Hex(it.toByteArray()) }.toSet()
        return ApkInfo(info.packageName, info.longVersionCode, info.versionName ?: "", certs)
    }

    companion object {
        const val CHANNEL = "updates"
        private const val NOTIFICATION_ID = 33
        const val MAX_APK_BYTES = 100L * 1024 * 1024
        private const val MAX_METADATA = 16 * 1024
        private const val INSTALL_TIMEOUT_MIN = 5L

        fun sha256Hex(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

        internal fun downloadApk(dir: File, sha256: String?, connect: () -> HttpURLConnection): File {
            dir.mkdirs()
            dir.listFiles()?.forEach { it.delete() } // leftovers of an interrupted run
            val part = File(dir, "plainphone.apk.part")
            val conn = connect()
            try {
                val status = conn.responseCode
                if (status != 200) throw IOException("APK download: HTTP $status")
                if (conn.url.protocol != "https") throw IOException("APK download left https")
                val expected = conn.contentLengthLong
                if (expected > MAX_APK_BYTES) throw IOException("APK is too large ($expected bytes)")
                val digest = conn.inputStream.use { input ->
                    part.outputStream().use { out -> copyVerified(input, out, expected) }
                }
                if (sha256 != null && digest != sha256) throw IOException("APK checksum does not match the release")
                return File(dir, "plainphone.apk").also { if (!part.renameTo(it)) throw IOException("could not store the APK") }
            } finally {
                part.delete()
                conn.disconnect()
            }
        }

        /**
         * Copies [input] to [out], returning the hex SHA-256. Throws when the stream ends before
         * [expected] bytes (-1: unknown) or grows past [MAX_APK_BYTES]: an interrupted download is never used.
         */
        fun copyVerified(input: InputStream, out: OutputStream, expected: Long): String {
            val digest = MessageDigest.getInstance("SHA-256")
            val buf = ByteArray(64 * 1024)
            var total = 0L
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                total += n
                if (total > MAX_APK_BYTES) throw IOException("APK is too large")
                digest.update(buf, 0, n)
                out.write(buf, 0, n)
            }
            if (expected >= 0 && total != expected) throw IOException("download stopped after $total of $expected bytes")
            if (total == 0L) throw IOException("empty download")
            return digest.digest().joinToString("") { "%02x".format(it) }
        }
    }
}
