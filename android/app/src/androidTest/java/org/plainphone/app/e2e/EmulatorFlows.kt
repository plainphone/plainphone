// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.e2e

import android.app.UiAutomation
import android.app.admin.DeviceAdminReceiver
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.provider.Telephony
import android.view.InputDevice
import android.view.MotionEvent
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import androidx.work.WorkManager
import androidx.work.WorkQuery
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.plainphone.app.AndroidDeviceControls
import org.plainphone.app.ConfigStore
import org.plainphone.app.Lock
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.R
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.home.HomeActivity
import org.plainphone.app.light.GuardService
import org.plainphone.app.light.LightLock
import org.plainphone.app.light.LightSetupActivity
import org.plainphone.app.light.Mode
import org.plainphone.app.provisioning.BootloaderWarning
import org.plainphone.app.sync.Sync
import org.plainphone.app.sync.SyncRunner
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.SyncWorker
import org.plainphone.app.time.TrustedClock
import org.plainphone.app.ui.PairingActivity
import org.plainphone.app.ui.TelecomHandoff
import org.plainphone.app.ui.placeCall

private const val PLAYER = "org.plainphone.fixture"
private const val PLAYER_ACTIVITY = "$PLAYER/.PlayerActivity"
private const val MESSAGE = "I am at the test stop"
private const val REPLY = "Emulator parent reply"

/** One sync run seen during setup, with the phone id of the rules saved when it finished. */
private data class SetupRun(val reason: String, val outcome: SyncRunner.Outcome, val rulesPhoneId: String?)

abstract class EmulatorFlow {
    protected val instrumentation = InstrumentationRegistry.getInstrumentation()
    protected val context = instrumentation.targetContext
    protected val device = Configurator.getInstance().run {
        setUiAutomationFlags(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
        UiDevice.getInstance(instrumentation)
    }
    protected val store = SyncStore(context)
    private val arguments = InstrumentationRegistry.getArguments()
    private val server = "http://10.0.2.2:${checkNotNull(arguments.getString("port"))}"
    protected val parentNumber get() = checkNotNull(arguments.getString("parentNumber"))
    protected lateinit var phone: String

    protected fun enroll(mode: String) {
        assertEquals(mode, Mode.name(context))
        awaitServer()
        val config = ConfigStore(context)
        config.save(config.load().copy(serverUrl = server))
        val response = parent("POST", "/phones/enroll", 201, JSONObject()
            .put("name", "Emulator $mode").put("profile", "child").put("mode", mode)
            .put("timezone", "UTC").put("language", "en").put("filterMethod", "privateDns"))
        val id = response.getJSONObject("phone").getString("id")
        phone = "/phones/$id"
        // Begin at the setup screen's existing pending-QR entry point. The fixture uses HTTP
        // on the emulator loopback, whereas the public setup link parser requires HTTPS.
        store.saveEnrollToken(response.getJSONObject("enrollment").getString("token"))
        // Wait for the real condition: a finished sync that left this phone's rules saved. Not
        // for a reason label. Device Owner setup may apply the rules in the pairing screen's own
        // "setup finished" sync, and the queued "paired" sync shares one KEEP slot with every
        // other immediate sync, so it can run under another reason or after the rules are in
        // (#236). Each run is recorded with the rules' phone id as that run left them.
        val runs = CopyOnWriteArrayList<SetupRun>()
        SyncRunner.runObserverForTest = { reason, outcome -> runs.add(SetupRun(reason, outcome, store.rules()?.phoneId)) }
        try {
            if (mode == Mode.STRONG) awaitFirstDeviceOwnerLock()
            val setup = if (mode == Mode.LIGHT) LightSetupActivity.intent(context) else PairingActivity.setupIntent(context)
            context.startActivity(setup.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            if (mode == Mode.LIGHT) {
                text(context.getString(R.string.setup_child)).click()
                text(context.getString(R.string.setup_continue)).click()
                val fields = checkNotNull(device.wait(Until.findObjects(By.clazz("android.widget.EditText")), 15_000))
                assertEquals("The enrollment confirmation needs two PIN fields", 2, fields.size)
                fields.forEach { it.text = "924681" }
                text(context.getString(R.string.light_confirm_link_action)).click()
            }
            // Built at the timeout: the runs and the work as they are then, not when the wait began.
            await({ "a setup sync that saved this phone's rules ($id), runs seen: $runs, sync work: ${syncWork()}" }) {
                runs.any { it.outcome is SyncRunner.Outcome.Synced && it.rulesPhoneId == id }
            }
        } finally {
            SyncRunner.runObserverForTest = null
        }
        val summary = parent("GET", phone, 200)
        assertFalse("setup must have paired the phone", summary.isNull("pairedAt"))
        assertFalse("setup must have uploaded the first status", summary.isNull("status"))
        assertEquals("setup must have saved the first rules", id, store.rules()?.phoneId)
    }

    /**
     * Without the PIN, the pairing screen opens only in the hour after the first lock
     * (PairingController.allowedWithoutPin). `dpm set-device-owner` starts that lock through
     * the admin-enabled broadcast, but `am instrument` force-stops the app before it finishes.
     * Replay that broadcast, as a provisioned phone runs it, and wait for the lock it applies.
     * If the original broadcast won the race and already applied the lock, the window is open
     * and there is nothing to replay.
     */
    private fun awaitFirstDeviceOwnerLock() {
        if (Lock.firstAppliedAtMs(context) == null) {
            // Android 10 and 11 hold the first lock until the unlocked-bootloader warning is confirmed.
            BootloaderWarning.acknowledge(context)
            PlainphoneAdminReceiver().onEnabled(context, Intent(DeviceAdminReceiver.ACTION_DEVICE_ADMIN_ENABLED))
            await("the first Device Owner lock, which opens the setup window") { Lock.firstAppliedAtMs(context) != null }
        }
        assertTrue("the setup must be able to pair without the PIN", PairingActivity.canPairWithoutPin(context))
    }

    protected fun sync() {
        val outcome = Sync.runner(context).run("emulator end-to-end")
        assertTrue("sync outcome: ${outcome.javaClass.simpleName}", outcome is SyncRunner.Outcome.Synced)
    }

    protected fun allowPlayer(allowed: Boolean) {
        parent("PUT", "$phone/apps/$PLAYER", 200, JSONObject().put("allowed", allowed))
        sync()
        assertEquals(allowed, PLAYER in checkNotNull(store.rules()).allowedApps)
    }

    protected fun parent(method: String, path: String, expected: Int, body: JSONObject? = null): JSONObject =
        request(method, "/api$path", expected, body)

    protected fun request(method: String, path: String, expected: Int, body: JSONObject? = null): JSONObject {
        val connection = URL("$server$path").openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 5_000
            connection.readTimeout = 10_000
            connection.requestMethod = method
            connection.setRequestProperty("Authorization", "Bearer ${checkNotNull(arguments.getString("parentToken"))}")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            assertEquals("$method $path", expected, connection.responseCode)
            if (expected == 204) return JSONObject()
            return connection.inputStream.bufferedReader().use { JSONObject(it.readText()) }
        } finally {
            connection.disconnect()
        }
    }

    /**
     * The harness has checked the server on the host, but a snapshot-restored guest can still be
     * bringing its network up (run 45015815784: ConnectException on the first request).
     */
    private fun awaitServer() {
        var last: Exception? = null
        await({ "the test server at $server from the emulator, last error: $last" }) {
            try {
                val connection = URL("$server/api/health").openConnection() as HttpURLConnection
                try {
                    connection.connectTimeout = 2_000
                    connection.readTimeout = 5_000
                    connection.responseCode == 200
                } finally {
                    connection.disconnect()
                }
            } catch (e: IOException) {
                last = e
                false
            }
        }
    }

    protected fun await(description: String, ready: () -> Boolean) = await({ description }, ready)

    protected fun await(description: () -> String, ready: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 40_000
        while (SystemClock.elapsedRealtime() < deadline) {
            if (ready()) return
            SystemClock.sleep(250)
        }
        throw AssertionError("Timed out waiting for ${description()}")
    }

    /** Every SyncWorker request: state, attempts and WorkManager's stop reason (7: connectivity lost). */
    private fun syncWork(): String = runCatching {
        WorkManager.getInstance(context)
            .getWorkInfos(WorkQuery.fromTags(listOf(SyncWorker::class.java.name)))
            .get(5, TimeUnit.SECONDS)
            .map { work ->
                val kind = if (work.periodicityInfo != null) "periodic" else "once"
                "$kind ${work.state} attempts=${work.runAttemptCount} stopReason=${work.stopReason} " +
                    "delayMs=${work.initialDelayMillis}"
            }.toString()
    }.getOrElse { "unavailable (${it.javaClass.simpleName})" }

    protected fun text(label: String) = checkNotNull(device.wait(Until.findObject(By.text(label)), 15_000)) {
        "Missing visible text: $label"
    }

    protected fun hold(label: String) {
        val bounds = text(label).visibleBounds
        val point = "${bounds.centerX()} ${bounds.centerY()}"
        device.executeShellCommand("input swipe $point $point 3500")
    }

    /**
     * Drags the screen and holds still before lifting. A quick swipe leaves a fling running, and
     * a scrolling screen spends the next tap on stopping it instead of on the button under it.
     */
    protected fun scrollWithoutFling(fromY: Int, toY: Int) {
        val x = device.displayWidth / 2f
        val downAt = SystemClock.uptimeMillis()
        fun inject(action: Int, y: Int) {
            val event = MotionEvent.obtain(downAt, SystemClock.uptimeMillis(), action, x, y.toFloat(), 0)
            event.source = InputDevice.SOURCE_TOUCHSCREEN
            try {
                check(instrumentation.uiAutomation.injectInputEvent(event, true)) { "Could not inject $event" }
            } finally {
                event.recycle()
            }
        }
        inject(MotionEvent.ACTION_DOWN, fromY)
        for (step in 1..20) inject(MotionEvent.ACTION_MOVE, fromY + (toY - fromY) * step / 20)
        // Part of the gesture: the velocity tracker reads a finger at rest for this long as stopped.
        SystemClock.sleep(200)
        inject(MotionEvent.ACTION_MOVE, toY)
        inject(MotionEvent.ACTION_UP, toY)
    }

    /** How often the phone asked the test gateway to send a quick message, for a failure message. */
    protected fun gatewayRequests(): String =
        runCatching { request("GET", "/e2e/quick-message-requests", 200).getInt("count").toString() }
            .getOrElse { "unavailable (${it.javaClass.simpleName})" }

    /** The modem's voice registration as Android sees it: an SMS sent out of service is dropped. */
    @Suppress("MissingPermission")
    protected fun voiceService(): String = runCatching {
        when (val state = context.getSystemService(android.telephony.TelephonyManager::class.java)?.serviceState?.state) {
            android.telephony.ServiceState.STATE_IN_SERVICE -> "in service"
            android.telephony.ServiceState.STATE_OUT_OF_SERVICE -> "out of service"
            android.telephony.ServiceState.STATE_EMERGENCY_ONLY -> "emergency only"
            android.telephony.ServiceState.STATE_POWER_OFF -> "radio off"
            else -> "unknown ($state)"
        }
    }.getOrElse { "unreadable: ${it.javaClass.simpleName}" }

    protected fun launchPlayer() {
        val result = device.executeShellCommand("am start -W -n $PLAYER_ACTIVITY")
        assertTrue("Could not start player: $result", "Status: ok" in result)
    }

    protected fun assertEmergencyDialing() {
        assertTrue("the phone's call rules must be enforced", ContactPolicySources.get(context).rules().enforced)
        val handedToTelecom = CopyOnWriteArrayList<Uri>()
        val emergencyNumbers = listOf("112", "911", "114")
        // The public placeCall, with only its final Telecom hand-off recorded: this test must
        // never place a real emergency call.
        TelecomHandoff.interceptForTest = { handedToTelecom.add(it) }
        try {
            for (number in emergencyNumbers) {
                assertNull("$number must reach the Telecom hand-off", placeCall(context, number))
            }
            assertEquals(context.getString(R.string.call_not_allowed), placeCall(context, "+12025550199"))
        } finally {
            TelecomHandoff.interceptForTest = null
        }
        assertEquals(emergencyNumbers.map { Uri.fromParts("tel", it, null) }, handedToTelecom.toList())
    }

    /** The emulator SIM's own number as Android read it (the default SMS app may read it). */
    @Suppress("DEPRECATION", "MissingPermission")
    protected fun simNumber(): String = runCatching {
        context.getSystemService(android.telephony.TelephonyManager::class.java)?.line1Number
    }.getOrElse { "unreadable: ${it.javaClass.simpleName}" } ?: "unknown"

    protected fun inboxContains(body: String, sender: String): Boolean =
        context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI, arrayOf(Telephony.Sms.ADDRESS),
            "${Telephony.Sms.BODY} = ?", arrayOf(body), null,
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                if (cursor.getString(0).removePrefix("+") == sender.removePrefix("+")) return true
            }
            false
        } == true
}

class DeviceOwnerFlow : EmulatorFlow() {
    @Test fun enrollApplyRulesAndSendSos() {
        enroll(Mode.STRONG)
        val controls = AndroidDeviceControls(context)
        assertTrue("unknown app must be hidden on first sync", controls.isHidden(PLAYER))
        allowPlayer(true)
        assertFalse("allowed app must be visible to Android", controls.isHidden(PLAYER))
        launchPlayer()
        text("Enter picture-in-picture")
        allowPlayer(false)
        assertTrue("revoked app must be hidden again", controls.isHidden(PLAYER))
        assertEmergencyDialing()

        context.startActivity(Intent(context, HomeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        if (store.enrollmentAccount() != null) {
            checkNotNull(device.wait(Until.findObject(By.res("android:id/button1")), 15_000)) {
                "Missing enrollment account confirmation"
            }.click()
        }
        text(context.getString(R.string.sos_title)).click()
        hold(context.getString(R.string.sos_urgent))
        await("one SOS in the parent API") {
            parent("GET", "$phone/sos", 200).getJSONArray("events").length() > 0
        }
        val events = parent("GET", "$phone/sos", 200).getJSONArray("events")
        assertEquals(1, events.length())
        val event = events.getJSONObject(0)
        assertEquals("urgent", event.getString("kind"))
        parent("POST", "$phone/sos/${event.getString("id")}/seen", 200, JSONObject())
        assertFalse(parent("GET", "$phone/sos", 200).getJSONArray("events").getJSONObject(0).isNull("seenAt"))
        hold(context.getString(R.string.sos_emergency))
        await("Android emergency keypad") {
            device.executeShellCommand("dumpsys activity activities").lineSequence()
                .any { "ResumedActivity" in it && "EmergencyDialer" in it }
        }
        device.pressBack()

        parent("POST", "$phone/contacts", 200, JSONObject().put("name", "Test parent").put("number", parentNumber))
        val contactId = parent("GET", "$phone/contacts", 200).getJSONArray("contacts")
            .getJSONObject(0).getString("id")
        parent("PUT", "$phone/contacts/$contactId/sos-parent", 204, JSONObject().put("enabled", true))
        parent("PUT", "$phone/sos", 204, JSONObject().put("quickMessagesEnabled", true))
        parent("POST", "$phone/quick-messages", 201, JSONObject().put("text", MESSAGE))
        sync()
        assertEquals(0, request("GET", "/e2e/quick-message-requests", 200).getInt("count"))
        assertFalse("fixture SMS must not already be in the inbox", inboxContains(MESSAGE, parentNumber))
        assertFalse("fixture reply must not already be in the inbox", inboxContains(REPLY, parentNumber))
        // Reopen SOS to load the new rules, then scroll to the child's message button.
        text(context.getString(R.string.sos_back)).click()
        text(context.getString(R.string.sos_title)).click()
        val message = device.wait(Until.findObject(By.text(MESSAGE)), 1_000) ?: run {
            val height = device.displayHeight
            scrollWithoutFling(height * 3 / 4, height / 4)
            text(MESSAGE)
        }
        message.click()
        // The emulator modem loops SMS addressed to its own number back into Android.
        await({
            "outbound quick message received via the emulator modem (parent $parentNumber, SIM ${simNumber()}, " +
                "gateway requests: ${gatewayRequests()}, voice service: ${voiceService()})"
        }) {
            inboxContains(MESSAGE, parentNumber)
        }
        assertEquals(1, request("GET", "/e2e/quick-message-requests", 200).getInt("count"))
        request("POST", "/e2e/sms-observed", 204)
        await("approved parent's injected SMS in Android inbox") { inboxContains(REPLY, parentNumber) }
    }
}

class LightModeFlow : EmulatorFlow() {
    @Test fun stopAppsAndPipAndKeepSchoolTimeAfterWallClockChange() {
        enroll(Mode.LIGHT)
        // Register after am instrument has restarted the app process.
        device.executeShellCommand("settings put secure enabled_accessibility_services ${context.packageName}/.light.GuardService")
        device.executeShellCommand("settings put secure accessibility_enabled 1")
        await("Plainphone accessibility guard") { GuardService.isConnected }
        launchPlayer()
        assertPlayerStopped()
        allowPlayer(true)
        launchPlayer()
        text("Enter picture-in-picture").click()
        await("fixture entering PiP") { isPlayerInPip() }
        allowPlayer(false)
        await("fixture leaving PiP") { !isPlayerInPip() }

        allowPlayer(true)
        launchPlayer()
        text("Enter picture-in-picture")
        device.pressHome()
        val trusted = TrustedClock.of(context)
        val utc = trusted.now().earliest.atZone(ZoneOffset.UTC)
        val minute = utc.hour * 60 + utc.minute
        fun minuteAt(offset: Int) = Math.floorMod(minute + offset, 1440)
        parent("POST", "$phone/schedules", 200, JSONObject().put("kind", "school")
            .put("days", JSONArray((1..7).toList()))
            .put("startMinute", minuteAt(-30)).put("endMinute", minuteAt(30))
            .put("allowedPackages", JSONArray()))
        sync()

        val before = trusted.now().earliest
        val elapsed = SystemClock.elapsedRealtime()
        try {
            setWallClock(before.plusSeconds(12 * 3600L))
            val moved = trusted.now()
            assertTrue("wall clock did not move", moved.wall.epochSecond - before.epochSecond > 11 * 3600)
            assertTrue("trusted clock followed the wrong wall clock", moved.earliest.epochSecond - before.epochSecond in 0..60)
            assertTrue("school schedule is no longer active", Lock.effectiveConfig(context).server?.windowActive == true)
            Lock.applyNow(context, "emulator wall-clock change")
            launchPlayer()
            assertPlayerStopped()
        } finally {
            setWallClock(before.plusMillis(SystemClock.elapsedRealtime() - elapsed))
        }
    }

    private fun assertPlayerStopped() {
        assertTrue("Player must be in the light-mode block plan", PLAYER in LightLock.plan(context).blocked)
        await("blocked player leaving the foreground") {
            val resumed = device.executeShellCommand("dumpsys activity activities").lineSequence()
                .filter { "ResumedActivity" in it }.toList()
            resumed.isNotEmpty() && resumed.none { PLAYER in it }
        }
    }

    private fun isPlayerInPip(): Boolean {
        val stacks = device.executeShellCommand("am stack list")
        check("mWindowingMode=" in stacks) { "Android did not return task stacks: $stacks" }
        // Each root task's configuration and the activities that belong to it are one block.
        return stacks.split(Regex("(?m)(?=^Stack id=|^RootTask id=)"))
            .any { "mWindowingMode=pinned" in it && ": $PLAYER/" in it }
    }

    private fun setWallClock(instant: Instant) {
        val date = DateTimeFormatter.ofPattern("MMddHHmmyyyy.ss", java.util.Locale.ROOT)
            .withZone(ZoneOffset.UTC).format(instant)
        device.executeShellCommand("su 0 date -u $date")
    }
}
