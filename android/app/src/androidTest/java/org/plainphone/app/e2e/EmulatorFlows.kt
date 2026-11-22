// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.e2e

import android.app.UiAutomation
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.provider.Telephony
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.concurrent.CopyOnWriteArrayList
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
import org.plainphone.app.R
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.home.HomeActivity
import org.plainphone.app.light.GuardService
import org.plainphone.app.light.LightLock
import org.plainphone.app.light.LightSetupActivity
import org.plainphone.app.light.Mode
import org.plainphone.app.sync.Sync
import org.plainphone.app.sync.SyncRunner
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.time.TrustedClock
import org.plainphone.app.ui.PairingActivity
import org.plainphone.app.ui.TelecomHandoff
import org.plainphone.app.ui.placeCall

private const val PLAYER = "org.plainphone.fixture"
private const val PLAYER_ACTIVITY = "$PLAYER/.PlayerActivity"
private const val MESSAGE = "I am at the test stop"
private const val REPLY = "Emulator parent reply"

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
        // Pairing also registers the 15-minute WorkManager sync, which could deliver the first
        // status and rules by itself. Wait for the sync the setup starts under its own reason.
        val setupSync = if (mode == Mode.LIGHT) "initial light setup" else "paired"
        val runs = CopyOnWriteArrayList<Pair<String, SyncRunner.Outcome>>()
        SyncRunner.runObserverForTest = { reason, outcome -> runs.add(reason to outcome) }
        try {
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
            await("the setup's own first sync ($setupSync), runs seen: $runs") {
                runs.any { (reason, outcome) -> reason == setupSync && outcome is SyncRunner.Outcome.Synced }
            }
        } finally {
            SyncRunner.runObserverForTest = null
        }
        val summary = parent("GET", phone, 200)
        assertFalse("setup must have paired the phone", summary.isNull("pairedAt"))
        assertFalse("setup must have uploaded the first status", summary.isNull("status"))
        assertEquals("setup must have saved the first rules", id, store.rules()?.phoneId)
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

    protected fun await(description: String, ready: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 40_000
        while (SystemClock.elapsedRealtime() < deadline) {
            if (ready()) return
            SystemClock.sleep(250)
        }
        throw AssertionError("Timed out waiting for $description")
    }

    protected fun text(label: String) = checkNotNull(device.wait(Until.findObject(By.text(label)), 15_000)) {
        "Missing visible text: $label"
    }

    protected fun hold(label: String) {
        val bounds = text(label).visibleBounds
        val point = "${bounds.centerX()} ${bounds.centerY()}"
        device.executeShellCommand("input swipe $point $point 3500")
    }

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
            val width = device.displayWidth
            val height = device.displayHeight
            device.swipe(width / 2, height * 3 / 4, width / 2, height / 4, 20)
            text(MESSAGE)
        }
        message.click()
        // The emulator modem loops SMS addressed to its own number back into Android.
        await("outbound quick message received via the emulator modem") { inboxContains(MESSAGE, parentNumber) }
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
