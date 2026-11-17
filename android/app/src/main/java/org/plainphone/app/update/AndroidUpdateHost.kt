// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.annotation.SuppressLint
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
        ?: error("cannot read our own package")

    override fun isDeviceOwner(): Boolean =
        context.getSystemService(android.app.admin.DevicePolicyManager::class.java)?.isDeviceOwnerApp(context.packageName) == true

    override fun inMaintenance() = Lock.isInMaintenanceWindow(context)

    override fun downloadAllowed(): Boolean {
        val metered = context.getSystemService(ConnectivityManager::class.java)?.isActiveNetworkMetered ?: true
        val charging = context.getSystemService(BatteryManager::class.java)?.isCharging ?: false
        return !metered || charging
    }

    override fun fetchLatest(): ReleaseInfo? {
        val conn = open("$serverUrl/download/android/latest", followRedirects = false)
        try {
            conn.setRequestProperty("Accept", "application/json")
            return when (val status = conn.responseCode) {
                200 -> ReleaseInfo.parse(conn.inputStream.bufferedReader().use { it.readText().take(MAX_METADATA) })
                404 -> null // older server, or a self-hoster's own build without metadata
                else -> throw IOException("release metadata: HTTP $status")
            }
        } finally {
            conn.disconnect()
        }
    }

    override fun fallbackUrl() = "$serverUrl/download/android"

    override fun download(url: String, sha256: String?): File {
        val dir = File(context.noBackupFilesDir, "update").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() } // leftovers of an interrupted run
        val part = File(dir, "plainphone.apk.part")
        val conn = open(url, followRedirects = true)
        try {
            if (conn.responseCode != 200) throw IOException("APK download: HTTP ${conn.responseCode}")
            if (!conn.url.toString().startsWith("https://")) throw IOException("APK download left https")
            val expected = conn.contentLengthLong
            if (expected > MAX_APK_BYTES) throw IOException("APK is too large ($expected bytes)")
            val digest = conn.inputStream.use { input -> part.outputStream().use { out -> copyVerified(input, out, expected) } }
            if (sha256 != null && digest != sha256) throw IOException("APK checksum does not match the release")
            return File(dir, "plainphone.apk").also { if (!part.renameTo(it)) throw IOException("could not store the APK") }
        } catch (e: IOException) {
            part.delete()
            throw e
        } finally {
            conn.disconnect()
        }
    }

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
        try {
            installer.openSession(sessionId).use { session ->
                session.openWrite("plainphone.apk", 0, apk.length()).use { out ->
                    apk.inputStream().use { it.copyTo(out) }
                    session.fsync(out)
                }
                session.commit(UpdateReceiver.statusIntent(context, sessionId).intentSender)
            }
        } catch (e: Exception) {
            UpdateReceiver.forget(sessionId)
            runCatching { installer.abandonSession(sessionId) }
            return "could not write the install session: ${e.message}"
        }
        // On success Android usually kills this process before the answer arrives.
        val result = waiter.await(INSTALL_TIMEOUT_MIN, TimeUnit.MINUTES)
        UpdateReceiver.forget(sessionId)
        return when {
            result == null -> "no answer from the installer within $INSTALL_TIMEOUT_MIN minutes"
            result.status == PackageInstaller.STATUS_SUCCESS -> null
            else -> "status ${result.status}: ${result.message ?: "no message"}"
        }
    }

    override fun promptUpdate(latest: ReleaseInfo) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.channel_updates), NotificationManager.IMPORTANCE_DEFAULT),
        )
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(Intent.ACTION_VIEW, Uri.parse(fallbackUrl())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
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

    @Suppress("DEPRECATION")
    private fun certFlags(): Int =
        if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_SIGNATURES
        else PackageManager.GET_SIGNATURES

    @SuppressLint("PackageManagerGetSignatures") // compared as a whole set, never "any one matches"
    private fun apkInfo(info: PackageInfo): ApkInfo? {
        val certs = signingCerts(info)
        return ApkInfo(info.packageName ?: return null, info.longVersionCode, info.versionName ?: "", certs)
    }

    @Suppress("DEPRECATION")
    private fun signingCerts(info: PackageInfo): Set<String> {
        // signingInfo is not filled for APK files on some Android versions; signatures is.
        val signing = info.signingInfo
        val sigs = signing?.apkContentsSigners?.takeIf { it.isNotEmpty() } ?: info.signatures
        return sigs.orEmpty().map { sha256Hex(it.toByteArray()) }.toSet()
    }

    companion object {
        const val CHANNEL = "updates"
        private const val NOTIFICATION_ID = 33
        const val MAX_APK_BYTES = 100L * 1024 * 1024
        private const val MAX_METADATA = 16 * 1024
        private const val INSTALL_TIMEOUT_MIN = 5L

        fun sha256Hex(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

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
