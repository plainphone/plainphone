// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.reachability

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.telephony.TelephonyManager
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.ConfigStore
import org.plainphone.app.FakeDevice
import org.plainphone.app.MemoryHiddenStore
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.PolicyApplier
import org.plainphone.app.PolicyConfig
import org.plainphone.app.ServerOverlay
import org.plainphone.app.TelephonyApps
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactPolicy
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.EmergencyNumbers
import org.plainphone.app.contacts.Helplines
import org.plainphone.app.contacts.PhoneNumbers
import org.plainphone.app.contacts.contactPolicy
import org.plainphone.app.inbox.FamilyInbox
import org.plainphone.app.light.LightPlan
import org.plainphone.app.light.LightSetup
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * The invariant of docs/always-reachable.md: in every mode and state, 112 and the local emergency
 * numbers, the parents and the help lines can be called, ring through and be messaged.
 *
 * Nothing here lists the states by hand. The states come from the rules document itself: every
 * boolean in it is flipped both ways, every schedule kind is switched on, and the extreme
 * combinations are added. A rule that blocks the three groups in any of them fails the build. The
 * tripwire tests at the end fail when a new rule field appears, so the author has to look at it.
 */
@RunWith(RobolectricTestRunner::class)
class AlwaysReachableTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    /** Local emergency numbers as the authorities publish them, independent of the app's own table. */
    private val localEmergencyNumbers = mapOf(
        "dk" to listOf("112", "114"),
        "se" to listOf("112"),
        "no" to listOf("112", "110", "113"),
        "de" to listOf("112", "110"),
        "gb" to listOf("112", "999"),
        "us" to listOf("911"),
    )

    // --- The groups that must always be reachable ---------------------------------------------

    private class Check(val name: String, val channel: Channel, val direction: Direction, val number: String, val rings: Boolean)

    /** Everything that must be allowed, for the given rules. Parents are the ones the parent marked, or every contact. */
    private fun mustReach(rules: ContactRules, parents: List<ApprovedContact>): List<Check> = buildList {
        for (n in localEmergencyNumbers.getValue(country)) for (channel in Channel.entries) {
            add(Check("emergency $n", channel, Direction.OUTGOING, n, rings = false))
        }
        for (p in parents) for (channel in Channel.entries) for (direction in Direction.entries) {
            add(Check("parent ${p.name}", channel, direction, p.number, rings = channel == Channel.CALL && direction == Direction.INCOMING))
        }
        for (line in rules.help.lines) {
            line.phone?.let { add(Check("help line ${line.name} (call)", Channel.CALL, Direction.OUTGOING, it, rings = false)) }
            line.sms?.let { add(Check("help line ${line.name} (text)", Channel.SMS, Direction.OUTGOING, it, rings = false)) }
        }
    }

    /** What this state blocks, as readable lines. Empty means the invariant holds. */
    private fun violations(label: String, rules: ContactRules, parents: List<ApprovedContact>): List<String> {
        val policy = context.contactPolicy()
        return emergencyCallBack(rules, label) + helpLineReplies(rules, label) + mustReach(rules, parents).mapNotNull { c ->
            val d = policy.decide(rules, c.channel, c.direction, c.number)
            when {
                !d.allowed -> "$label: ${c.name} ${c.channel}/${c.direction} blocked: $d"
                c.rings && !policy.ringsAtBedtime(rules, c.number) -> "$label: ${c.name} does not ring"
                else -> null
            }
        }
    }

    /** Five minutes after a call to 112 the service can call back from any number, and the phone must ring. */
    private fun emergencyCallBack(rules: ContactRules, label: String): List<String> {
        val policy = ContactPolicy(EmergencyNumbers.forContext(context)) { 5 * 60_000L }
        val number = "+4500000000"
        val d = policy.decide(rules, Channel.CALL, Direction.INCOMING, number)
        return when {
            !d.allowed -> listOf("$label: the emergency call-back is blocked: $d")
            !policy.ringsAtBedtime(rules, number) -> listOf("$label: the emergency call-back does not ring")
            else -> emptyList()
        }
    }

    /** A help line that answers a call (replyOnly in the catalog) rings shortly after the child called it. */
    private fun helpLineReplies(rules: ContactRules, label: String): List<String> {
        val policy = context.contactPolicy()
        val justCalled = rules.copy(replyAgeMs = { _, _ -> 1_000L })
        return rules.help.lines.mapNotNull { line ->
            val number = line.phone?.takeIf { justCalled.replyHelpContact(it, Channel.CALL) != null } ?: return@mapNotNull null
            val d = policy.decide(justCalled, Channel.CALL, Direction.INCOMING, number)
            when {
                !d.allowed -> "$label: the reply from help line ${line.name} is blocked: $d"
                !policy.ringsAtBedtime(justCalled, number) -> "$label: the reply from help line ${line.name} does not ring"
                else -> null
            }
        }
    }

    // --- The rules document, with every state --------------------------------------------------

    private val dad = """{"name":"Dad","number":"+4587654321"}"""
    private val mum = """{"name":"Mum","number":"+4512345678"}"""

    /** A phone with everything on: parents marked, inbox, quick messages, limits, open mode, PIN approval, updates. */
    private fun maxRules(profile: String = "child", schedules: String = "[]"): JSONObject {
        val json = JSONObject(rulesJson(contacts = "[$mum,$dad]", schedules = schedules, timeLimits = """{"total":{"minutes":0},"apps":[],"bonuses":[]}"""))
        json.put("profile", profile)
        if (profile == "child") {
            json.put("sos", JSONObject("""{"name":"Alex","parents":[$dad],"quickMessages":{"enabled":true,"suggest":true,"items":[{"id":"q1","text":"I am safe","meansSos":false}]},"hidden":{"power":true,"presses":4,"clock":true,"feedback":true}}"""))
            json.put("inbox", JSONObject("""{"enabled":true,"quickMessages":true,"checkIns":true}"""))
        }
        json.put("silentBedtime", true).put("pinApprovalEnabled", true).put("askMoreTimeEnabled", true)
            .put("limitWarningEnabled", true).put("suggestDeviceContacts", true).put("lightContactRestriction", true)
            .put("selfScheduleContacts", true).put("release", false)
        json.getJSONObject("apps").put("open", true).put("blocked", JSONArray(listOf("com.example.game")))
        json.put("appUpdates", JSONObject("""{"automatic":true,"requestedAt":"2026-11-16T12:00:00Z"}"""))
        return json
    }

    /** A schedule that is on at every moment of every day, so the tests never depend on today's date. */
    private fun allDay(kind: String) =
        """{"id":"$kind-1","kind":"$kind","days":[1,2,3,4,5,6,7],"start":"00:00","end":"00:00","allowedPackages":[]}"""

    private fun booleanPaths(json: JSONObject, prefix: List<String> = emptyList()): List<List<String>> =
        json.keys().asSequence().toList().flatMap { key ->
            when (val value = json.get(key)) {
                is Boolean -> listOf(prefix + key)
                is JSONObject -> booleanPaths(value, prefix + key)
                else -> emptyList()
            }
        }

    private fun JSONObject.setPath(path: List<String>, value: Boolean) {
        var o = this
        for (key in path.dropLast(1)) o = o.getJSONObject(key)
        o.put(path.last(), value)
    }

    private fun JSONObject.copyJson() = JSONObject(toString())

    /** Every state the tests run: label to rules JSON. */
    private fun states(profile: String): Map<String, JSONObject> = buildMap {
        val schedules = "[${allDay("school")},${allDay("bedtime")}]"
        val base = maxRules(profile, schedules)
        put("everything on", base)
        for (kind in listOf("school", "bedtime")) put("only $kind time all day", maxRules(profile, "[${allDay(kind)}]"))
        put("no schedule", maxRules(profile))
        for (path in booleanPaths(base)) for (value in listOf(true, false)) {
            put("${path.joinToString(".")}=$value", base.copyJson().apply { setPath(path, value) })
        }
        for (value in listOf(true, false)) {
            put("all switches $value", base.copyJson().apply { for (path in booleanPaths(this)) setPath(path, value) })
        }
        put("selfScheduleContacts null", base.copyJson().put("selfScheduleContacts", JSONObject.NULL))
        put("no time limits", base.copyJson().apply { remove("timeLimits") })
        put("daily cap used up and an app limit used up", base.copyJson().put("timeLimits",
            JSONObject("""{"total":{"minutes":0},"apps":[{"packageName":"com.example.game","minutes":0}],"bonuses":[]}""")))
        put("released", base.copyJson().put("release", true))
        put("no sos block", base.copyJson().apply { remove("sos"); remove("inbox") })
        if (profile == "child") put("no parents marked", base.copyJson().apply { getJSONObject("sos").put("parents", JSONArray()) })
        // Modes (docs/modes.md): a mode that opens no contact group and no app, all day, quiet or not.
        for (quiet in listOf(false, true)) put("modes: a mode with no group all day, quiet=$quiet", withModes(base, quiet))
        put("modes: the parent's stored group is Others", withModes(base, quiet = false, dadGroup = "others"))
        put("modes: the parent is missing from the list", withModes(base, quiet = false).apply {
            put("contacts", JSONArray("[${JSONObject(mum).put("group", "others")}]"))
        })
        if (profile == "child") {
            put("modes, no parents marked", withModes(base, quiet = false).apply { getJSONObject("sos").put("parents", JSONArray()) })
        }
        put("modes: a broken modes block", base.copyJson().put("modes", JSONObject("""{"enabled":true,"list":"broken"}""")))
    }

    /** [json] with modes on and one mode, on all day, that opens no contact group and allows no app. */
    private fun withModes(json: JSONObject, quiet: Boolean, dadGroup: String = "family"): JSONObject = json.copyJson().apply {
        put("contacts", JSONArray("[${JSONObject(mum).put("group", "others")},${JSONObject(dad).put("group", dadGroup)}]"))
        put("modes", JSONObject(
            """{"enabled":true,"defaultModeId":"free","list":[
              {"id":"free","preset":"free","name":null,"allApps":true,"allowedPackages":[],"contactGroups":["family","friends","others"],"quiet":false},
              {"id":"closed","preset":"custom","name":"Closed","allApps":false,"allowedPackages":[],"contactGroups":[],"quiet":$quiet}],
             "slots":[{"id":"m1","modeId":"closed","days":[1,2,3,4,5,6,7],"start":"00:00","end":"00:00"}]}""",
        ))
    }

    private fun parentsOf(json: JSONObject): List<ApprovedContact> {
        // With no parent marked, every contact is a parent: the phone cannot tell them apart.
        val marked = json.optJSONObject("sos")?.getJSONArray("parents")
        val list = if (marked != null && marked.length() > 0) marked else json.getJSONArray("contacts")
        return List(list.length()) { ApprovedContact(list.getJSONObject(it).getString("name"), list.getJSONObject(it).getString("number")) }
    }

    private fun pairedPhone(strong: Boolean) {
        ConfigStore(context).save(PolicyConfig(countryCallingCode = PhoneNumbers.COUNTRIES.getValue(country).callingCode))
        if (strong) {
            val dpm = context.getSystemService(DevicePolicyManager::class.java)
            assertThat(shadowOf(dpm).setDeviceOwner(PlainphoneAdminReceiver.component(context))).isTrue()
        } else {
            LightSetup.markComplete(context)
        }
    }

    /** The country the phone is in (its QR code country), which decides the local emergency numbers. */
    private var country = "dk"

    private fun runStates(strong: Boolean, profile: String, only: Set<String>? = null) {
        pairedPhone(strong)
        val found = mutableListOf<String>()
        var count = 0
        for ((label, json) in states(profile)) {
            if (only != null && label !in only) continue
            SyncStore(context).saveRules("etag-$count", json.toString(), 0L)
            val rules = ContactPolicySources.get(context).rules()
            val mode = (if (strong) "strong" else "light") + "/" + profile
            // Keeps the bedtime ring check from passing vacuously: in the baseline the phone is silent.
            if (label == "everything on") assertWithMessage("$mode: silent bedtime is reached").that(rules.silentBedtime).isTrue()
            found += violations("$mode, $label", rules, parentsOf(json))
            // The family inbox stays on for a child phone that is not released, whatever else is on.
            val inbox = json.optJSONObject("inbox")
            if (profile == "child" && inbox != null && !json.optBoolean("release") && inbox.optBoolean("enabled")) {
                if (FamilyInbox.offer(context) == null) found += "$mode, $label: the family inbox is not offered"
            }
            count++
        }
        assertThat(count).isGreaterThan(if (only == null) 30 else 0)
        assertThat(found).isEmpty()
    }

    @Test
    fun `the local emergency numbers of every country work through the real call policy in the harshest states`() {
        val harsh = setOf("everything on", "all switches true", "all switches false", "released", "daily cap used up and an app limit used up")
        for (iso in localEmergencyNumbers.keys) {
            country = iso
            runStates(strong = true, profile = "child", only = harsh)
            runStates(strong = false, profile = "child", only = harsh)
        }
    }

    @Test
    fun `strong mode child phone reaches 112, the parents and the help lines in every state`() = runStates(strong = true, profile = "child")

    @Test
    fun `light mode child phone reaches 112, the parents and the help lines in every state`() = runStates(strong = false, profile = "child")

    @Test
    fun `strong mode myself phone reaches 112, the contacts and the help lines in every state`() = runStates(strong = true, profile = "self")

    @Test
    fun `light mode myself phone reaches 112, the contacts and the help lines in every state`() = runStates(strong = false, profile = "self")

    @Test
    fun `the check can fail, so a phone whose parents are missing from the list is caught`() {
        pairedPhone(strong = true)
        val json = maxRules().put("contacts", JSONArray())
        SyncStore(context).saveRules("e", json.toString(), 0L)
        val rules = ContactPolicySources.get(context).rules()
        assertThat(violations("control", rules, parentsOf(maxRules()))).isNotEmpty()
    }

    @Test
    fun `the modes states really narrow the list, so their checks are not vacuous`() {
        pairedPhone(strong = true)
        SyncStore(context).saveRules("e", withModes(maxRules(), quiet = false).toString(), 0L)
        val rules = ContactPolicySources.get(context).rules()
        val policy = context.contactPolicy()
        // Mum is in Others, which the mode does not open; Dad is the parent.
        assertThat(policy.decide(rules, Channel.CALL, Direction.INCOMING, "+4512345678").allowed).isFalse()
        assertThat(policy.decide(rules, Channel.CALL, Direction.INCOMING, "+4587654321").allowed).isTrue()
    }

    @Test
    fun `the help line directory is not empty, so the help line checks are not vacuous`() {
        pairedPhone(strong = true)
        SyncStore(context).saveRules("e", maxRules().toString(), 0L)
        val rules = ContactPolicySources.get(context).rules()
        assertThat(rules.help.lines).isNotEmpty()
        val catalog = File("../../server/catalog/helplines")
        // Every country in the catalog is covered by a direct check, not only the phone's own country.
        for (file in catalog.listFiles { f -> f.extension == "json" }.orEmpty()) {
            val iso = file.nameWithoutExtension
            val country = PhoneNumbers.countryForIso(iso)
            val directory = Helplines.forCountry(context, country)
            assertThat(directory.lines).isNotEmpty()
            val policy = ContactPolicy(EmergencyNumbers.forContext(context))
            val forCountry = rules.copy(country = country, help = directory)
            for (line in directory.lines) line.phone?.let {
                assertThat(policy.decide(forCountry, Channel.CALL, Direction.OUTGOING, it).allowed).isTrue()
            }
        }
    }

    // --- 112 and the local numbers in every locale ---------------------------------------------

    @Test
    fun `the local emergency numbers of every supported locale work with the SIM of that country`() {
        val tm = context.getSystemService(TelephonyManager::class.java)
        for ((iso, numbers) in localEmergencyNumbers) {
            shadowOf(tm).setSimCountryIso(iso)
            val check = EmergencyNumbers.forContext(context)
            for (n in numbers) assertThat(check.isEmergency(n)).isTrue()
        }
    }

    @Test
    fun `the local emergency numbers work when the phone cannot tell its country`() {
        // No SIM, no network, no QR country: Android's own list may be empty. Fail open for emergencies.
        val check = EmergencyNumbers.forContext(context)
        for ((_, numbers) in localEmergencyNumbers) for (n in numbers) assertThat(check.isEmergency(n)).isTrue()
    }

    @Test
    fun `a known country that is not listed adds no local numbers, only an unknown country adds them all`() {
        assertThat(EmergencyNumbers.localFor(listOf("fi"))).isEmpty()
        assertThat(EmergencyNumbers.localFor(listOf("fi", "no"))).containsExactly("110", "112", "113")
        assertThat(EmergencyNumbers.localFor(emptyList())).containsAtLeast("113", "999", "911")
    }

    @Test
    fun `112 is an emergency number even when the config or the telephony lookups throw`() {
        val broken = object : android.content.ContextWrapper(context) {
            override fun getSystemService(name: String): Any = throw IllegalStateException("vendor bug")
            override fun getSharedPreferences(name: String?, mode: Int): android.content.SharedPreferences =
                throw ClassCastException("corrupt pref")
        }
        val check = EmergencyNumbers.forContext(broken)
        for (n in EmergencyNumbers.ALWAYS) assertThat(check.isEmergency(n)).isTrue()
        // A local number still counts when the lookup fails.
        assertThat(check.isEmergency("999")).isTrue()
    }

    @Test
    fun `an ordinary number is not an emergency number whatever the country`() {
        val check = EmergencyNumbers.forContext(context)
        for (n in listOf("+4512345678", "1813", "12345678", "115", "100")) assertThat(check.isEmergency(n)).isFalse()
    }

    // --- Apps: the phone and Messages are never hidden, suspended or closed --------------------

    private val own = "org.plainphone.app"
    private val systemDialer = "com.maker.dialer"
    private val core = setOf("com.maker.messages", "com.maker.camera")
    private val launchable = setOf(own, systemDialer, "com.maker.extra.dialer") + core +
        setOf("com.example.game", "com.example.video", "com.example.browser")
    private val callApps = setOf(own, systemDialer) + core

    /** The worst app rules the phone can be given: each hostile field alone and all of them at once. */
    private fun hostileConfigs(): Map<String, PolicyConfig> {
        val everything = launchable
        val base = PolicyConfig(allowedPackages = emptySet(), server = ServerOverlay(windowActive = true, quietBedtime = true))
        return mapOf(
            "school time or bedtime allows nothing" to base,
            "no window, nothing allowed" to base.copy(server = ServerOverlay()),
            "every app used up for today" to base.copy(timeBlocked = everything),
            "open mode blocks everything" to base.copy(openBlocked = everything),
            "update window holds every app back" to base.copy(updatingApps = true, heldBack = everything),
            "install window open" to base.copy(installing = "com.example.game"),
            "all at once" to base.copy(timeBlocked = everything, openBlocked = everything, updatingApps = true, heldBack = everything, installing = "com.example.game"),
        )
    }

    @Test
    fun `strong mode never hides or suspends the phone, Messages or the system dialer`() {
        for ((label, config) in hostileConfigs()) {
            val device = FakeDevice(launchable = launchable.toMutableSet(), core = core)
            device.telephony = TelephonyApps(setOf(own, systemDialer, "com.maker.extra.dialer"), emptySet(), systemDialer)
            val store = MemoryHiddenStore()
            PolicyApplier(device, store, sdkInt = 35).apply(config)
            assertWithMessage(label).that(device.hidden intersect callApps).isEmpty()
            assertWithMessage(label).that(device.suspended intersect callApps).isEmpty()
        }
    }

    @Test
    fun `light mode never blocks the phone, Messages or the system dialer`() {
        for ((label, config) in hostileConfigs()) {
            val plan = LightPlan.build(
                launchable = launchable, core = core, allowed = config.visibleAmong(launchable), ownPackage = own,
                telephony = setOf("com.maker.extra.dialer"), timeBlocked = config.timeBlocked, installing = config.installing,
                protectedCalls = setOf(systemDialer),
            )
            for (pkg in callApps) assertWithMessage("$label: $pkg").that(plan.why(pkg)).isNull()
        }
    }

    // --- Tripwires: a new rule must be looked at --------------------------------------------------

    private fun fields(type: Class<*>) = type.declaredFields.filterNot { it.isSynthetic || java.lang.reflect.Modifier.isStatic(it.modifiers) }
        .map { it.name }.toSet()

    @Test
    fun `a new field in the contact rules or the app rules fails here until it has been checked`() {
        val reviewed = mapOf(
            ContactRules::class.java to setOf("enforced", "contacts", "country", "help", "replyAgeMs", "selfProfile", "childProfile",
                "suggestDeviceContacts", "silentBedtime", "bedtimeRingers"),
            PolicyConfig::class.java to setOf("dnsHost", "filterMethod", "allowedPackages", "frpAccountIds", "pinHashHex", "pinSaltHex",
                "relockMinutes", "countryCallingCode", "seedContacts", "serverUrl", "enrollToken", "server", "timeBlocked", "installing",
                "updatingApps", "heldBack", "lockSystemLanguage", "openBlocked"),
            ServerOverlay::class.java to setOf("windowActive", "locationRequired", "settings", "quietBedtime"),
        )
        for ((type, known) in reviewed) {
            assertWithMessage(
                "${type.simpleName} has a new field. Can it stop a call, a text or an app the phone needs? Add it to " +
                    "hostileConfigs() or the rules states in AlwaysReachableTest, then to this list (docs/always-reachable.md).",
            ).that(fields(type)).isEqualTo(known)
        }
    }

    private fun assertWithMessage(message: String) = com.google.common.truth.Truth.assertWithMessage(message)
}
