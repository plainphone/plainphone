// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.e2e

import android.app.Notification
import android.app.NotificationManager
import android.app.UiAutomation
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.os.UserManager
import android.provider.Settings
import android.provider.Telephony
import android.telecom.TelecomManager
import android.telephony.TelephonyManager
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import androidx.work.WorkManager
import androidx.work.WorkQuery
import java.net.HttpURLConnection
import java.net.URL
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
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
import org.plainphone.app.catalog.InstallWindow
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.PhoneNumbers
import org.plainphone.app.contacts.TelephonyLog
import org.plainphone.app.home.HomeActivity
import org.plainphone.app.light.BlockedActivity
import org.plainphone.app.light.EmergencyOpenings
import org.plainphone.app.light.EmergencyRules
import org.plainphone.app.light.EmergencyStart
import org.plainphone.app.light.GuardService
import org.plainphone.app.light.LightLock
import org.plainphone.app.light.LightPlan
import org.plainphone.app.light.LightSetupActivity
import org.plainphone.app.light.Mode
import org.plainphone.app.provisioning.BootloaderWarning
import org.plainphone.app.sync.Sync
import org.plainphone.app.sync.SyncRunner
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.SyncWorker
import org.plainphone.app.telephony.CallManager
import org.plainphone.app.time.TimeGuard
import org.plainphone.app.time.TrustedClock
import org.plainphone.app.ui.PairingActivity
import org.plainphone.app.ui.TelecomHandoff
import org.plainphone.app.ui.placeCall

private const val PLAYER = "org.plainphone.fixture"
private const val PLAYER_ACTIVITY = "$PLAYER/.PlayerActivity"
private const val MESSAGE = "I am at the test stop"
private const val REPLY = "Emulator parent reply"

// Fictional North American numbers (555-01xx), one per check, so each blocked-log entry is its own.
private const val KEYPAD_STRANGER = "+12025550101"
private const val DIALLED_STRANGER = "+12025550102"
private const val TEXTING_STRANGER = "+12025550188"
private const val CALLING_STRANGER = "+12025550177"
private const val STRANGER_TEXT = "Emulator stranger text"
private const val FORMAT_CONTACT = "Format test contact"
// Saved with spaces and the country code; the modem delivers the text from the national number
// (the emulator's SIM is a US SIM), as a network may.
private const val FORMAT_CONTACT_SAVED = "+1 202 555 0123"
private const val FORMAT_CONTACT_SENDER = "2025550123"
private const val FORMAT_CONTACT_TEXT = "Emulator contact text"

// The app catalog exists for Danish phones only, so the light-mode phone lives in Copenhagen.
private const val LIGHT_ZONE = "Europe/Copenhagen"
private const val CATALOG_APP = "com.danskebank.mobilebank3.dk"
// An opening is only ever counted, never used to launch anything: no such app is installed.
private const val OPENING_APP = "org.plainphone.e2e.opening"
private const val DATE_JUMP_DAYS = 35L

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

    protected fun enroll(mode: String, timezone: String = "UTC") {
        assertEquals(mode, Mode.name(context))
        val config = ConfigStore(context)
        config.save(config.load().copy(serverUrl = server))
        val response = parent("POST", "/phones/enroll", 201, JSONObject()
            .put("name", "Emulator $mode").put("profile", "child").put("mode", mode)
            .put("timezone", timezone).put("language", "en").put("filterMethod", "privateDns"))
        val id = response.getJSONObject("phone").getString("id")
        phone = "/phones/$id"
        // Begin at the setup screen's existing pending-QR entry point. The fixture uses HTTP
        // on the emulator loopback, whereas the public setup link parser requires HTTPS.
        store.saveEnrollToken(response.getJSONObject("enrollment").getString("token"))
        // Pairing also registers the 15-minute WorkManager sync, which could deliver the first
        // status and rules by itself. Wait for the sync the setup starts under its own reason.
        val setupSync = if (mode == Mode.LIGHT) "initial light setup" else "paired"
        // Record every run from here on, before anything can pair the phone.
        val runs = CopyOnWriteArrayList<Pair<String, SyncRunner.Outcome>>()
        SyncRunner.runObserverForTest = { reason, outcome -> runs.add(reason to outcome) }
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
            await({ "the setup's own first sync ($setupSync), runs seen: $runs, sync work: ${syncWork()}" }) {
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

    protected fun await(description: String, ready: () -> Boolean) = await({ description }, ready = ready)

    protected fun await(description: () -> String, timeoutMs: Long = 40_000, ready: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
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
                "$kind ${work.state} attempts=${work.runAttemptCount} stopReason=${work.stopReason}"
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

    protected fun inboxHasBody(body: String): Boolean =
        context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI, arrayOf(Telephony.Sms._ID), "${Telephony.Sms.BODY} = ?", arrayOf(body), null,
        )?.use { it.count > 0 } == true

    /**
     * Has the host run `adb emu <args>` (an SMS or a call from [args]' number) and asserts the console
     * accepted it. The modem then delivers it to Android like a network would.
     */
    protected fun emulatorConsole(vararg args: String) {
        val output = request("POST", "/e2e/console", 200, JSONObject().put("args", JSONArray(args.toList())))
            .getString("output")
        assertEquals("adb emu ${args.joinToString(" ")}", "OK", output.trim())
    }

    /** Whether the blocked log (what the maintenance screen lists) has this call or text. */
    protected fun isBlocked(channel: Channel, direction: Direction, number: String): Boolean {
        val country = ContactPolicySources.get(context).rules().country
        return TelephonyLog(context).blocked().any {
            it.channel == channel && it.direction == direction && PhoneNumbers.same(it.number, number, country)
        }
    }

    protected fun notifications(): List<Notification> =
        context.getSystemService(NotificationManager::class.java).activeNotifications.map { it.notification }

    protected fun Notification.title(): String? = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()

    protected fun Notification.text(): String? = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
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
        await({ "outbound quick message received via the emulator modem (parent $parentNumber, SIM ${simNumber()})" }) {
            inboxContains(MESSAGE, parentNumber)
        }
        assertEquals(1, request("GET", "/e2e/quick-message-requests", 200).getInt("count"))
        // A separate reply, only once the child has observed the modem loopback.
        emulatorConsole("sms", "send", parentNumber, REPLY)
        await("approved parent's injected SMS in Android inbox") { inboxContains(REPLY, parentNumber) }

        assertTimeForced()
        assertKeypadRefusesStranger()
        assertCallFromAnotherAppEnded()
        assertTextsReachTheInboxOnlyFromContacts()
        assertNonUrgentCallOpensNoCallBackWindow()
    }

    /**
     * T1 and T2: what Device Owner policy guarantees for the clock. Android 11+ forces automatic time
     * and time zone, and Android's time detectors, which Settings → Date & time goes through, refuse
     * changes under `DISALLOW_CONFIG_DATE_TIME`. Android 10 can only require automatic time; the same
     * restriction greys out the time zone in Settings.
     */
    private fun assertTimeForced() {
        val resolver = context.contentResolver
        val users = context.getSystemService(UserManager::class.java)
        assertTrue("date and time settings must be restricted", users.hasUserRestriction(UserManager.DISALLOW_CONFIG_DATE_TIME))
        // The harness turned automatic time off before enrollment.
        assertEquals("automatic time", 1, Settings.Global.getInt(resolver, Settings.Global.AUTO_TIME))
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = ComponentName(context, PlainphoneAdminReceiver::class.java)
        if (Build.VERSION.SDK_INT >= 30) {
            assertTrue("automatic time must be forced", dpm.getAutoTimeEnabled(admin))
            assertTrue("automatic time zone must be forced", dpm.getAutoTimeZoneEnabled(admin))
            assertEquals("automatic time zone", 1, Settings.Global.getInt(resolver, Settings.Global.AUTO_TIME_ZONE))
            // The shell holds MANAGE_TIME_AND_ZONE_DETECTION, so only the restriction can refuse these.
            for (detector in listOf("time_detector", "time_zone_detector")) {
                val attempt = device.executeShellCommand("cmd $detector set_auto_detection_enabled false")
                assertFalse("$detector did not reach its policy check: $attempt", "xception" in attempt)
                assertEquals(
                    "$detector must keep automatic detection on", "true",
                    device.executeShellCommand("cmd $detector is_auto_detection_enabled").trim(),
                )
            }
            val wall = System.currentTimeMillis()
            val manual = device.executeShellCommand(
                "cmd time_detector suggest_manual_time --elapsed_realtime ${SystemClock.elapsedRealtime()} " +
                    "--unix_epoch_time ${wall + 2 * 3_600_000L}",
            )
            assertFalse("manual time was not suggested: $manual", "xception" in manual || "Error" in manual)
            assertTrue("a manual time must be refused", System.currentTimeMillis() - wall < 60_000)
            val zone = device.executeShellCommand("getprop persist.sys.timezone").trim()
            val other = if (zone == "Pacific/Kiritimati") "Pacific/Chatham" else "Pacific/Kiritimati"
            val manualZone = device.executeShellCommand("cmd time_zone_detector suggest_manual_time_zone --zone_id $other")
            assertFalse("manual time zone was not suggested: $manualZone", "xception" in manualZone || "Error" in manualZone)
            assertEquals("a manual time zone must be refused", zone, device.executeShellCommand("getprop persist.sys.timezone").trim())
        } else {
            @Suppress("DEPRECATION")
            assertTrue("automatic time must be required", dpm.autoTimeRequired)
        }
        // A privileged shell writes the raw settings (a child has no shell: adb is off). Android may refuse
        // the write under DISALLOW_CONFIG_DATE_TIME or take it; the value right after it says which, and
        // either way Plainphone's lock check, which runs at least every 15 minutes, must leave them forced.
        val rawWrites = listOfNotNull(Settings.Global.AUTO_TIME, Settings.Global.AUTO_TIME_ZONE.takeIf { Build.VERSION.SDK_INT >= 30 })
        for (key in rawWrites) {
            val reply = device.executeShellCommand("settings put global $key 0").trim()
            val after = Settings.Global.getInt(resolver, key, -1)
            Log.i("PlainphoneE2E", "raw write $key=0 ${if (after == 0) "accepted" else "refused, still $after"} $reply")
        }
        Lock.applyNow(context, "emulator time check")
        assertEquals("automatic time must stay forced", 1, Settings.Global.getInt(resolver, Settings.Global.AUTO_TIME))
        if (Build.VERSION.SDK_INT >= 30) {
            assertEquals("automatic time zone must stay forced", 1, Settings.Global.getInt(resolver, Settings.Global.AUTO_TIME_ZONE))
        }
    }

    /** C4: the keypad, opened the way a tel: link in another app opens it, refuses a number that is not approved. */
    private fun assertKeypadRefusesStranger() {
        val handedToTelecom = CopyOnWriteArrayList<Uri>()
        TelecomHandoff.interceptForTest = { handedToTelecom.add(it) }
        try {
            context.startActivity(
                Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", KEYPAD_STRANGER, null))
                    .setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            checkNotNull(device.wait(Until.findObject(By.desc(context.getString(R.string.action_call_plain))), 15_000)) {
                "Missing the keypad's call button"
            }.click()
            text(context.getString(R.string.call_not_allowed))
        } finally {
            TelecomHandoff.interceptForTest = null
        }
        assertEquals("nothing may reach Telecom", emptyList<Uri>(), handedToTelecom.toList())
        assertTrue("the refused call must be in the blocked log", isBlocked(Channel.CALL, Direction.OUTGOING, KEYPAD_STRANGER))
        device.pressBack()
    }

    /**
     * C5: a call another app places through Telecom (the maker's dialer, a contact card) is ended. The
     * shell stands in for that app: it holds CALL_PHONE, and Telecom treats its ACTION_CALL like any app's.
     */
    private fun assertCallFromAnotherAppEnded() {
        val telecom = context.getSystemService(TelecomManager::class.java)
        val started = device.executeShellCommand("am start -a android.intent.action.CALL -d tel:$DIALLED_STRANGER")
        assertFalse("Could not start the other app's call: $started", "Error" in started)
        await("the other app's call to a stranger ended and logged") {
            isBlocked(Channel.CALL, Direction.OUTGOING, DIALLED_STRANGER)
        }
        await("the Call not allowed notification") {
            notifications().any {
                // For this call: the text names the number, which Telecom may hand over formatted.
                it.title() == context.getString(R.string.call_blocked_title) &&
                    it.text().orEmpty().filter(Char::isDigit).contains(DIALLED_STRANGER.filter(Char::isDigit))
            }
        }
        await("no call left in Telecom") { CallManager.state.value.isEmpty() && !telecom.isInCall }
    }

    /**
     * C8 and C17: texts arrive from the emulated modem. A stranger's text is dropped without a notification
     * and logged; an approved contact's text matches although the number is written differently.
     */
    private fun assertTextsReachTheInboxOnlyFromContacts() {
        // The national number only expands to +1 202 555 0123 on a US phone.
        assertEquals("emulator SIM country", "us", context.getSystemService(TelephonyManager::class.java).simCountryIso)
        parent("POST", "$phone/contacts", 200, JSONObject().put("name", FORMAT_CONTACT).put("number", FORMAT_CONTACT_SAVED))
        sync()
        emulatorConsole("sms", "send", TEXTING_STRANGER, STRANGER_TEXT)
        emulatorConsole("sms", "send", FORMAT_CONTACT_SENDER, FORMAT_CONTACT_TEXT)
        await("the stranger's text in the blocked log") { isBlocked(Channel.SMS, Direction.INCOMING, TEXTING_STRANGER) }
        // The receiver logs a stranger's text instead of storing it, so after the log entry nothing more can come.
        assertFalse("the stranger's text must not reach the inbox", inboxHasBody(STRANGER_TEXT))
        assertFalse("the stranger's text must not notify", notifications().any { it.text() == STRANGER_TEXT })
        await("the contact's text from the national number in the inbox") { inboxHasBody(FORMAT_CONTACT_TEXT) }
        // Named in the notification only when the number matched the saved contact.
        await("a notification naming the contact") {
            notifications().any { it.title() == FORMAT_CONTACT && it.text() == FORMAT_CONTACT_TEXT }
        }
    }

    /**
     * C19, and C1 after it. 114 (Danish police, not urgent) can always be called, but it never opens
     * the call-back window that lets anyone call after an emergency call. The emulated modem answers an
     * outgoing call about a second after dialling, so whether the hang-up comes before that is not
     * controlled here; for 114 neither may open the window. A stranger's call is then still rejected.
     */
    private fun assertNonUrgentCallOpensNoCallBackWindow() {
        val telecom = context.getSystemService(TelecomManager::class.java)
        // Plainphone, not Android, must be what lets 114 through here: no emergency call is placed.
        @Suppress("MissingPermission")
        val androidEmergency = context.getSystemService(TelephonyManager::class.java).isEmergencyNumber("114")
        assertFalse("Android treats 114 as an emergency number on this emulator", androidEmergency)
        assertNull("114 must reach Telecom", placeCall(context, "114"))
        await("the 114 call in Plainphone's call service") { CallManager.state.value.any { it.number == "114" } }
        val state = CallManager.state.value.first { it.number == "114" }.state
        instrumentation.runOnMainSync { CallManager.hangUp() }
        Log.i("PlainphoneE2E", "hung up 114 in call state $state")
        await("the 114 call ended") { CallManager.state.value.isEmpty() && !telecom.isInCall }
        assertNull("114 must not open the call-back window", TelephonyLog(context).sinceLastEmergencyMs())

        emulatorConsole("gsm", "call", CALLING_STRANGER)
        await("the stranger's call rejected and logged") { isBlocked(Channel.CALL, Direction.INCOMING, CALLING_STRANGER) }
        await("no call left in Telecom") { CallManager.state.value.isEmpty() && !telecom.isInCall }
    }
}

class LightModeFlow : EmulatorFlow() {
    @Test fun stopAppsAndPipAndKeepSchoolTimeAfterWallClockChange() {
        enroll(Mode.LIGHT, LIGHT_ZONE)
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
        val zone = ZoneId.of(LIGHT_ZONE)
        // Minutes and Play windows count per day, openings per month: none of that may start over
        // because the real day ends during the test. InstallWindow counts in the system time zone.
        awaitClearOfMidnight(zone, ZoneId.systemDefault())

        // L-T3: use up a one-minute limit; the date jump below must not give the minute back.
        device.executeShellCommand("appops set ${context.packageName} GET_USAGE_STATS allow")
        assertTrue("Plainphone needs usage access to count minutes", TimeGuard.hasUsageAccess(context))
        parent("PUT", "$phone/time-limits/apps/$PLAYER", 200, JSONObject().put("minutes", 1))
        sync()
        launchPlayer()
        await({ "the player's minute used up (${TimeGuard.snapshot(context)?.evaluation?.usedMs})" }, timeoutMs = 150_000) {
            PLAYER in TimeGuard.blockedNow(context)
        }
        Lock.applyNow(context, "emulator time limit")
        launchPlayer()
        assertPlayerStopped(LightPlan.Why.TIME_USED_UP)

        // L-T7: five Play windows a day, then no sixth.
        parent("POST", "$phone/catalog", 200, JSONObject().put("packageName", CATALOG_APP))
        sync()
        assertTrue("catalog app offered for install", checkNotNull(store.rules()).toInstall.any { it.packageName == CATALOG_APP })
        repeat(InstallWindow.MAX_PER_DAY) { window ->
            assertEquals("Play window ${window + 1}", InstallWindow.OpenResult.OPENED, InstallWindow.openForParent(context, CATALOG_APP))
            InstallWindow.close(context, "emulator end-to-end", CATALOG_APP)
            awaitInstallRecovery()
        }
        assertEquals("a sixth Play window", InstallWindow.OpenResult.DAILY_LIMIT, InstallWindow.openForParent(context, CATALOG_APP))

        // L-T6: use the month's only emergency opening. Openings exist on Self phones only; this Child
        // phone counts one through the same store and trusted clock with a Self rule of one a month.
        val openings = EmergencyOpenings.of(context)
        val oneAMonth = EmergencyRules(enabled = true, allowance = 1, minutes = 1, usedMonth = null, usedCount = 0)
        fun openingsLeft() = openings.offer(BlockedActivity.Reason.NOT_ALLOWED, selfProfile = true, oneAMonth, zone)
        assertEquals("openings before", 1, openingsLeft())
        val opening = openings.start(
            OPENING_APP, BlockedActivity.Reason.NOT_ALLOWED, selfProfile = true, oneAMonth, zone, context.packageName,
        )
        assertTrue("opening: $opening", opening is EmergencyStart.Started)
        assertEquals("openings after", 0, openingsLeft())

        val local = trusted.now().earliest.atZone(zone)
        val minute = local.hour * 60 + local.minute
        fun minuteAt(offset: Int) = Math.floorMod(minute + offset, 1440)
        parent("POST", "$phone/schedules", 200, JSONObject().put("kind", "school")
            .put("days", JSONArray((1..7).toList()))
            .put("startMinute", minuteAt(-30)).put("endMinute", minuteAt(30))
            .put("allowedPackages", JSONArray()))
        sync()

        val before = trusted.now().earliest
        val elapsed = SystemClock.elapsedRealtime()
        try {
            // Into another day and another month on the phone's own clock.
            setWallClock(before.plus(Duration.ofDays(DATE_JUMP_DAYS)))
            val moved = trusted.now()
            assertTrue("wall clock did not move", moved.wall.epochSecond - before.epochSecond > (DATE_JUMP_DAYS - 1) * 86_400)
            assertTrue("trusted clock followed the wrong wall clock", moved.earliest.epochSecond - before.epochSecond in 0..60)
            assertTrue("school schedule is no longer active", Lock.effectiveConfig(context).server?.windowActive == true)
            Lock.applyNow(context, "emulator wall-clock change")
            launchPlayer()
            assertPlayerStopped(LightPlan.Why.NOT_ALLOWED)
            // School time also blocks the player now, so the plan lists it as not allowed. The lock's
            // time-limit result, which the plan is built from, must still have it.
            assertTrue(
                "the used minute must still count (${TimeGuard.snapshot(context)?.evaluation?.usedMs})",
                PLAYER in Lock.effectiveConfig(context).timeBlocked,
            )
            assertEquals("no new Play window", InstallWindow.OpenResult.DAILY_LIMIT, InstallWindow.openForParent(context, CATALOG_APP))
            assertEquals("no new opening", 0, openingsLeft())
        } finally {
            setWallClock(before.plusMillis(SystemClock.elapsedRealtime() - elapsed))
        }
    }

    /**
     * Waits, only when the test starts in the last minutes of a day, until the trusted time has passed
     * midnight in each of [zones], so nothing counted per day or month starts over mid-test.
     */
    private fun awaitClearOfMidnight(vararg zones: ZoneId) {
        val margin = Duration.ofMinutes(10)
        fun clear(): Boolean {
            val now = TrustedClock.of(context).now().instant
            return zones.all { zone ->
                val nextMidnight = now.atZone(zone).toLocalDate().plusDays(1).atStartOfDay(zone).toInstant()
                Duration.between(now, nextMidnight) > margin
            }
        }
        await({ "the trusted time clear of midnight in $zones" }, timeoutMs = margin.toMillis() + 60_000) { clear() }
    }

    /** InstallWindow.close puts the lock back on a single background thread; this waits until it has. */
    private fun awaitInstallRecovery() {
        val done = CountDownLatch(1)
        Lock.recoverInstallAsync(context, "emulator end-to-end") { done.countDown() }
        assertTrue("install restriction recovery", done.await(40, TimeUnit.SECONDS))
    }

    private fun assertPlayerStopped(why: LightPlan.Why = LightPlan.Why.NOT_ALLOWED) {
        assertEquals("Player must be in the light-mode block plan", why, LightLock.plan(context).why(PLAYER))
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
