// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.graphics.Bitmap
import android.net.Uri
import android.telecom.Call
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.inbox.FamilyThread
import org.plainphone.app.inbox.InboxEntry
import org.plainphone.app.inbox.InboxOffer
import org.plainphone.app.sos.SendState
import org.plainphone.app.sync.InboxMessage
import org.plainphone.app.sync.QuickMessage
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.plainphone.app.telephony.CallManager
import org.plainphone.app.telephony.CallUi
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowContentResolver

/**
 * Every screen of the Phone and Messages apps in light, dark, large text (200 %) and the five
 * languages, rendered as the whole app with a Child phone's synced rules. Synthetic fixtures only.
 * PNGs land in `app/build/screenshots/phone-messages/`; the redesign's before and after are in
 * docs/screenshots/phone-messages-redesign/.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xhdpi")
class PhoneMessagesScreenshotTest(private val screen: String, private val variant: String) {
    @get:Rule
    val compose = createComposeRule()

    private val provider = FixtureProvider()

    @After
    fun close() = provider.db.close()

    private fun show(waitFor: String? = null, content: @Composable () -> Unit) {
        val v = VARIANTS.getValue(variant)
        RuntimeEnvironment.setQualifiers("+${v.language}-${if (v.dark) "night" else "notnight"}")
        compose.setContent {
            val d = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(d.density, v.fontScale)) {
                PlainphoneTheme { Surface(color = MaterialTheme.colorScheme.background) { content() } }
            }
        }
        if (waitFor != null) {
            compose.waitUntil(10_000) { compose.onAllNodes(hasText(waitFor, substring = true)).fetchSemanticsNodes().isNotEmpty() }
        }
        compose.waitForIdle()
        val dir = File("build/screenshots/phone-messages").apply { mkdirs() }
        File(dir, "$screen-$variant.png").outputStream().use {
            check(compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it))
        }
    }

    /** A strong-mode Child phone: Device Owner, Plainphone holds the phone and SMS roles, synced rules. */
    private fun childPhone(inbox: Boolean = false) {
        val app = RuntimeEnvironment.getApplication()
        for (authority in listOf("sms", "mms", "mms-sms", "call_log")) {
            ShadowContentResolver.registerProviderInternal(authority, provider)
        }
        shadowOf(app).grantPermissions(Manifest.permission.READ_CALL_LOG, Manifest.permission.CALL_PHONE)
        shadowOf(app.getSystemService(DevicePolicyManager::class.java))
            .setDeviceOwner(ComponentName(app, PlainphoneAdminReceiver::class.java))
        app.getSystemService(RoleManager::class.java)?.let {
            shadowOf(it).addHeldRole(RoleManager.ROLE_DIALER)
            shadowOf(it).addHeldRole(RoleManager.ROLE_SMS)
        }
        val people = JSONArray()
        CONTACTS.forEach { (name, number) -> people.put(JSONObject().put("name", name).put("number", number)) }
        val rules = JSONObject(rulesJson(contacts = people.toString()))
        val parents = JSONArray().put(people.get(0)).put(people.get(1))
        rules.put("sos", JSONObject().put("name", "Sam").put("parents", parents))
        if (inbox) {
            rules.put("inbox", JSONObject().put("enabled", true).put("quickMessages", true).put("checkIns", true).put("latest", "r2"))
            val thread = JSONObject().put("recipients", JSONArray().put("Alex").put("Robin")).put(
                "messages",
                JSONArray().put(
                    InboxMessage("c1", true, "quick", "Pick me up", NOW - 5_400_000, delivered = 2).toJson(),
                ).put(InboxMessage("r2", false, "reply", "On my way", NOW - 5_100_000, author = "Robin").toJson()),
            )
            app.getSharedPreferences("plainphone_family_inbox", android.content.Context.MODE_PRIVATE).edit()
                .putString("thread", thread.toString()).putString("latest", "r2").commit()
        }
        SyncStore(app).saveRules("test", rules.toString(), 1_800_000_000_000L)
    }

    private val quick = listOf(
        QuickMessage("a", "Pick me up", meansSos = false),
        QuickMessage("b", "I'm okay", meansSos = false),
        QuickMessage("c", "Call me", meansSos = false),
    )

    /** Every state a message can be in; synthetic fixtures. */
    private val familyEntries = listOf(
        InboxEntry("1", true, "Pick me up", NOW - 7_200_000, "quick", SendState.DELIVERED),
        InboxEntry("2", false, "On my way", NOW - 7_000_000, "reply", author = "Robin"),
        InboxEntry("3", true, "I'm home", NOW - 3_600_000, "checkin", SendState.SMS),
        InboxEntry("4", true, "Call me", NOW - 600_000, "quick", SendState.FAILED),
        InboxEntry("5", true, "I'm okay", NOW - 60_000, "quick", SendState.SENDING),
    )

    @Test
    fun capture() {
        childPhone(inbox = screen == "messages-family")
        when (screen) {
            "contacts" -> show("Alex") { PhoneApp(Route(Tab.CONTACTS), 0) }
            "recents" -> show("Robin") { PhoneApp(Route(Tab.RECENTS), 0) }
            "keypad" -> show { PhoneApp(Route(Tab.KEYPAD), 0) }
            "messages" -> show("Robin") { PhoneApp(Route(Tab.MESSAGES), 0) }
            "messages-family" -> show("On my way") { PhoneApp(Route(Tab.MESSAGES), 0) }
            "family" -> show {
                FamilyThread(familyEntries, InboxOffer(quick, checkIns = true), listOf("Alex", "Robin"), {}, { true }, { true })
            }
            "family-empty" -> show { FamilyThread(emptyList(), InboxOffer(emptyList(), checkIns = true), emptyList(), {}, { true }, { true }) }
            "conversation" -> show("see you") { PhoneApp(Route(Tab.MESSAGES, "+4520000001"), 0) }
            "conversation-unknown" -> show("prize") { PhoneApp(Route(Tab.MESSAGES, "+4529999999"), 0) }
            "incoming" -> show { InCallScreen(CallUi(1, "Alex", "+4520000001", Call.STATE_RINGING, true, null), CallManager.Audio()) }
            "in-call" -> show {
                InCallScreen(CallUi(1, "Alex", "+4520000001", Call.STATE_ACTIVE, false, null), CallManager.Audio(muted = true))
            }
        }
    }

    /** Messages, threads and calls for the fixtures, at times relative to now. */
    class FixtureProvider : ContentProvider() {
        val db: SQLiteDatabase = SQLiteDatabase.create(null).apply {
            execSQL("CREATE TABLE threads (_id INTEGER PRIMARY KEY, date INTEGER, recipient_ids TEXT, read INTEGER, message_count INTEGER, snippet TEXT, has_attachment INTEGER)")
            execSQL("INSERT INTO threads VALUES (7, ${NOW - 120_000}, '1', 0, 4, 'Yes, see you at 18', 0), (8, ${NOW - 3_600_000}, '2', 1, 1, 'Dinner at 18', 0), (9, ${NOW - 86_400_000}, '3', 1, 1, 'You have won a prize, click here', 0)")
            execSQL("CREATE TABLE addresses (_id INTEGER PRIMARY KEY, address TEXT)")
            execSQL("INSERT INTO addresses VALUES (1, '+4520000001'), (2, '+4520000002'), (3, '+4529999999')")
            execSQL("CREATE TABLE sms (_id INTEGER PRIMARY KEY, thread_id INTEGER, address TEXT, date INTEGER, type INTEGER, read INTEGER, body TEXT)")
            execSQL(
                "INSERT INTO sms VALUES " +
                    "(1, 7, '+4520000001', ${NOW - 900_000}, 1, 1, 'Training is moved to 17.30'), " +
                    "(2, 7, '+4520000001', ${NOW - 600_000}, 2, 1, 'Okay. Can you pick me up after?'), " +
                    "(3, 7, '+4520000001', ${NOW - 300_000}, 5, 1, 'I will wait by the gate'), " +
                    "(4, 7, '+4520000001', ${NOW - 120_000}, 1, 0, 'Yes, see you at 18'), " +
                    "(5, 8, '+4520000002', ${NOW - 3_600_000}, 1, 1, 'Dinner at 18'), " +
                    "(6, 9, '+4529999999', ${NOW - 86_400_000}, 1, 1, 'You have won a prize, click here')",
            )
            execSQL("CREATE TABLE mms (_id INTEGER PRIMARY KEY, thread_id INTEGER, date INTEGER, msg_box INTEGER)")
            execSQL("CREATE TABLE calls (_id INTEGER PRIMARY KEY, number TEXT, type INTEGER, date INTEGER, duration INTEGER, new INTEGER DEFAULT 0)")
            execSQL(
                "INSERT INTO calls VALUES (1, '+4520000002', 3, ${NOW - 1_200_000}, 0, 1), (2, '+4520000001', 2, ${NOW - 7_200_000}, 95, 0), " +
                    "(3, '+4520000001', 1, ${NOW - 90_000_000}, 320, 0), (4, '+4529999999', 3, ${NOW - 100_000_000}, 0, 0)",
            )
        }

        override fun onCreate() = true
        override fun getType(uri: Uri): String? = null
        override fun insert(uri: Uri, values: ContentValues?): Uri? = null
        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
        override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0

        override fun query(
            uri: Uri, projection: Array<out String>?, selection: String?,
            selectionArgs: Array<out String>?, sortOrder: String?,
        ): Cursor? {
            if (uri.lastPathSegment == "threadID") {
                val id = when (uri.getQueryParameter("recipient")) {
                    "+4520000001" -> 7
                    "+4520000002" -> 8
                    else -> 9
                }
                return android.database.MatrixCursor(arrayOf("_id")).apply { addRow(arrayOf(id)) }
            }
            val table = when (uri.authority) {
                "sms", "mms" -> requireNotNull(uri.authority)
                "call_log" -> "calls"
                else -> if (uri.lastPathSegment == "conversations") "threads" else "addresses"
            }
            val order = if (table == "threads") "date DESC" else sortOrder?.substringBefore(" LIMIT")
            return db.query(table, projection, selection, selectionArgs, null, null, order)
        }
    }

    data class Variant(val language: String, val dark: Boolean, val fontScale: Float)

    companion object {
        /** "Now" for the fixtures; the screens show times relative to the clock, so no date is fixed. */
        val NOW: Long = System.currentTimeMillis()

        val CONTACTS = listOf("Alex" to "+4520000001", "Robin" to "+4520000002", "Kim" to "+4520000003")

        val VARIANTS = mapOf(
            "en-light" to Variant("en", false, 1f),
            "en-dark" to Variant("en", true, 1f),
            "en-large" to Variant("en", false, 2f),
            "da-light" to Variant("da", false, 1f),
            "sv-light" to Variant("sv", false, 1f),
            "nb-dark" to Variant("nb", true, 1f),
            "de-large" to Variant("de", true, 2f),
        )

        val SCREENS = listOf(
            "contacts", "recents", "keypad", "messages", "messages-family", "conversation", "conversation-unknown",
            "family", "family-empty", "incoming", "in-call",
        )

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}")
        fun params(): List<Array<Any>> = SCREENS.flatMap { s -> VARIANTS.keys.map { arrayOf<Any>(s, it) } }
    }
}
