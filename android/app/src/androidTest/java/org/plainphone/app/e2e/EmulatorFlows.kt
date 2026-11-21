// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.e2e

import android.app.UiAutomation
import android.content.Intent
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
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.plainphone.app.AndroidDeviceControls
import org.plainphone.app.ConfigStore
import org.plainphone.app.Lock
import org.plainphone.app.R
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.contactPolicy
import org.plainphone.app.home.HomeActivity
import org.plainphone.app.light.GuardService
import org.plainphone.app.light.LightLock
import org.plainphone.app.light.Mode
import org.plainphone.app.sos.QuickMessageDelivery
import org.plainphone.app.sos.SendState
import org.plainphone.app.sync.EnrollResult
import org.plainphone.app.sync.PairingController
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.Sync
import org.plainphone.app.sync.SyncRunner
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.time.TrustedClock

private const val PLAYER = "org.plainphone.fixture"
private const val PLAYER_ACTIVITY = "$PLAYER/.PlayerActivity"
private const val PARENT_NUMBER = "+12025550123"
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
        store.saveEnrollToken(response.getJSONObject("enrollment").getString("token"))
        val pairing = PairingController(store, PlainphoneApi(server, context), mapOf("model" to "Emulator"), mode)
        assertTrue("enrollment did not return a device token", pairing.enroll() is EnrollResult.Paired)
        sync()
        assertEquals(id, store.rules()?.phoneId)
        val summary = parent("GET", phone, 200)
        assertFalse("parent must see the enrollment", summary.isNull("pairedAt"))
        assertFalse("parent must see the first status upload", summary.isNull("status"))
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

    protected fun assertEmergencyPolicy() {
        val rules = ContactPolicySources.get(context).rules()
        assertTrue("the phone's call rules must be enforced", rules.enforced)
        val policy = context.contactPolicy()
        for (number in listOf("112", "911", "114")) {
            assertTrue("$number must pass the call policy", policy.decide(rules, Channel.CALL, Direction.OUTGOING, number).allowed)
        }
        assertFalse(policy.decide(rules, Channel.CALL, Direction.OUTGOING, "+12025550199").allowed)
    }
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
        assertEmergencyPolicy()

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

        parent("POST", "$phone/contacts", 200, JSONObject().put("name", "Test parent").put("number", PARENT_NUMBER))
        val contactId = parent("GET", "$phone/contacts", 200).getJSONArray("contacts")
            .getJSONObject(0).getString("id")
        parent("PUT", "$phone/contacts/$contactId/sos-parent", 204, JSONObject().put("enabled", true))
        parent("PUT", "$phone/sos", 204, JSONObject().put("quickMessagesEnabled", true))
        parent("POST", "$phone/quick-messages", 201, JSONObject().put("text", MESSAGE))
        sync()
        val message = checkNotNull(store.rules()?.sos).quickMessages.items.single { it.text == MESSAGE }
        assertEquals(0, request("GET", "/e2e/quick-message-requests", 200).getInt("count"))
        val key = checkNotNull(QuickMessageDelivery.send(context, message))
        await("quick message submitted to Android SMS") {
            QuickMessageDelivery.state(context, key) in listOf(SendState.SMS, SendState.FAILED, SendState.DELIVERED)
        }
        assertEquals(SendState.SMS, QuickMessageDelivery.state(context, key))
        assertEquals(1, request("GET", "/e2e/quick-message-requests", 200).getInt("count"))
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
        // Do not let instrumentation suspend the accessibility service under test.
        val automation = instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
        return automation.windows.any { window ->
            window.isInPictureInPictureMode && window.root?.packageName == PLAYER
        }
    }

    private fun setWallClock(instant: Instant) {
        val date = DateTimeFormatter.ofPattern("MMddHHmmyyyy.ss", java.util.Locale.ROOT)
            .withZone(ZoneOffset.UTC).format(instant)
        device.executeShellCommand("su 0 date -u $date")
    }
}

class IncomingSmsFlow : EmulatorFlow() {
    @Test fun approvedParentReplyReachesTheChildInbox() {
        await("approved parent's injected SMS in Android inbox") {
            context.contentResolver.query(
                Telephony.Sms.Inbox.CONTENT_URI, arrayOf(Telephony.Sms.ADDRESS),
                "${Telephony.Sms.BODY} = ?", arrayOf(REPLY), null,
            )?.use { it.moveToFirst() && it.getString(0) == PARENT_NUMBER } == true
        }
    }
}
