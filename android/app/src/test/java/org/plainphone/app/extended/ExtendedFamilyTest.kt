// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.extended

import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.sync.ContactStatus
import org.plainphone.app.sync.ExtendedContact
import org.plainphone.app.sync.ExtendedLine
import org.plainphone.app.sync.ExtendedRules
import org.plainphone.app.sync.LocationFix
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.SnapshotRules
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner

/**
 * Extended family contacts and location snapshots (docs/extended-family.md). Every time is a fixed
 * number or instant; nothing depends on today's date. 2027-01-04 is a Monday.
 */
@RunWith(RobolectricTestRunner::class) // org.json is Android's
class ExtendedFamilyTest {
    private val day = 86_400_000L
    private val t0 = 1_800_000_000_000L

    private fun contact(id: String, name: String, status: ContactStatus, group: String = "others", rev: Int = 1) =
        ExtendedContact(id, name, status, group, rev)

    // ---- Rules

    private fun rules(block: JSONObject.() -> Unit): ServerRules = ServerRules.parse(JSONObject(rulesJson()).apply(block).toString())

    @Test
    fun `without the blocks the rules are off, also from an older server`() {
        val r = ServerRules.parse(rulesJson())
        assertThat(r.extended).isEqualTo(ExtendedRules.OFF)
        assertThat(r.locationSnapshot).isEqualTo(SnapshotRules.OFF)
        assertThat(r.extended.enabled).isFalse()
    }

    @Test
    fun `a paused block keeps the roster to see and block, with nothing to send`() {
        val r = rules {
            put(
                "extended",
                JSONObject("""{"enabled":false,"quickMessages":true,"contacts":[
                  {"id":"c1","name":"Grandma","status":"active","group":"family","rev":3}]}"""),
            )
            put("locationSnapshot", JSONObject("""{"enabled":false,"minutes":60}"""))
        }
        assertThat(r.extended.enabled).isFalse()
        assertThat(r.extended.quickMessages).isFalse()
        assertThat(r.extended.present).isTrue()
        assertThat(r.extended.contacts.map { it.id }).containsExactly("c1")
        assertThat(r.locationSnapshot).isEqualTo(SnapshotRules.OFF)
    }

    @Test
    fun `an enabled block carries the roster and the snapshot window`() {
        val r = rules {
            put(
                "extended",
                JSONObject(
                    """{"enabled":true,"quickMessages":true,"contacts":[
                      {"id":"c1","name":"Grandma","status":"active","group":"family","rev":3},
                      {"id":"c2","name":"Sam","status":"waitingForChild","group":"others","rev":1},
                      {"id":"c3","name":"Future","status":"somethingNew","group":"others","rev":1}]}""",
                ),
            )
            put("locationSnapshot", JSONObject("""{"enabled":true,"minutes":90}"""))
        }
        assertThat(r.extended.enabled).isTrue()
        assertThat(r.extended.quickMessages).isTrue()
        // A state this app does not know is left out, not guessed.
        assertThat(r.extended.contacts.map { it.id }).containsExactly("c1", "c2").inOrder()
        assertThat(r.extended.contacts[0]).isEqualTo(contact("c1", "Grandma", ContactStatus.ACTIVE, "family", 3))
        assertThat(r.locationSnapshot).isEqualTo(SnapshotRules(true, 90))
    }

    // ---- Roster changes

    @Test
    fun `a person who joins and one with a new link get a line each`() {
        val before = listOf(
            KnownContact("c1", "Grandma", ContactStatus.WAITING_FOR_CONTACT, false),
            KnownContact("c2", "Sam", ContactStatus.ACTIVE, true),
        )
        val now = listOf(
            contact("c1", "Grandma", ContactStatus.ACTIVE),
            // The parents made a new link: back to waiting for the child after having been active.
            contact("c2", "Sam", ContactStatus.WAITING_FOR_CHILD),
        )
        val r = RosterDiff.diff(before, now, emptyList(), t0)
        assertThat(r.log.map { it.kind to it.name }).containsExactly(ChangeKind.NEW_LINK to "Sam", ChangeKind.JOINED to "Grandma")
        assertThat(r.known.first { it.id == "c1" }.everActive).isTrue()
        assertThat(r.removedIds).isEmpty()
    }

    @Test
    fun `a person who disappeared while the phone was offline still gets a line, and is reported as removed`() {
        val before = listOf(KnownContact("c1", "Grandma", ContactStatus.ACTIVE, true), KnownContact("c2", "Sam", ContactStatus.ACTIVE, true))
        val r = RosterDiff.diff(before, listOf(contact("c2", "Sam", ContactStatus.ACTIVE)), emptyList(), t0)
        assertThat(r.log).containsExactly(ChangeLine(ChangeKind.REMOVED, "Grandma", t0))
        assertThat(r.removedIds).containsExactly("c1")
        assertThat(r.known.map { it.id }).containsExactly("c2")
    }

    @Test
    fun `a block and a first invitation are lines, an unchanged roster is not`() {
        val before = listOf(KnownContact("c1", "Grandma", ContactStatus.ACTIVE, true))
        val now = listOf(contact("c1", "Grandma", ContactStatus.BLOCKED), contact("c2", "Sam", ContactStatus.WAITING_FOR_CHILD))
        val first = RosterDiff.diff(before, now, emptyList(), t0)
        assertThat(first.log.map { it.kind to it.name }).containsExactly(ChangeKind.BLOCKED to "Grandma", ChangeKind.INVITED to "Sam")
        val again = RosterDiff.diff(first.known, now, first.log, t0 + 1_000)
        assertThat(again.log).isEqualTo(first.log)
    }

    @Test
    fun `the child's own yes is not a change, and the first look lists everyone`() {
        val before = listOf(KnownContact("c1", "Grandma", ContactStatus.WAITING_FOR_CHILD, false))
        val said = RosterDiff.diff(before, listOf(contact("c1", "Grandma", ContactStatus.WAITING_FOR_CONTACT)), emptyList(), t0)
        assertThat(said.log).isEmpty()
        val first = RosterDiff.diff(
            emptyList(), listOf(contact("c1", "Grandma", ContactStatus.ACTIVE), contact("c2", "Sam", ContactStatus.WAITING_FOR_CONTACT)), emptyList(), t0,
        )
        assertThat(first.log.map { it.kind }).containsExactly(ChangeKind.INVITED, ChangeKind.JOINED)
    }

    @Test
    fun `the list keeps 30 lines and 30 days, newest first`() {
        val old = ChangeLine(ChangeKind.JOINED, "Old", t0 - 31 * day)
        val many = (1..40).map { ChangeLine(ChangeKind.INVITED, "P$it", t0 - it) }
        val r = RosterDiff.diff(emptyList(), listOf(contact("c1", "New", ContactStatus.WAITING_FOR_CHILD)), listOf(old) + many, t0)
        assertThat(r.log).hasSize(RosterDiff.KEEP_LINES)
        assertThat(r.log.first().name).isEqualTo("New")
        assertThat(r.log.map { it.name }).doesNotContain("Old")
    }

    @Test
    fun `lines survive the round trip through json`() {
        val line = ChangeLine(ChangeKind.NEW_LINK, "Sam", t0)
        assertThat(ChangeLine.parse(JSONObject(line.toJson().toString()))).isEqualTo(line)
        val known = KnownContact("c1", "Sam", ContactStatus.BLOCKED, true)
        assertThat(KnownContact.parse(JSONObject(known.toJson().toString()))).isEqualTo(known)
    }

    // ---- What the child chose

    @Test
    fun `a yes or a block shows at once and only while the rules still say what they said`() {
        val roster = listOf(contact("c1", "Grandma", ContactStatus.WAITING_FOR_CHILD), contact("c2", "Sam", ContactStatus.ACTIVE), contact("c3", "Kim", ContactStatus.WAITING_FOR_CHILD))
        val actions = listOf(
            LocalAction("c1", LocalActionKind.YES, ContactStatus.WAITING_FOR_CHILD, t0),
            LocalAction("c2", LocalActionKind.BLOCK, ContactStatus.ACTIVE, t0),
            LocalAction("c3", LocalActionKind.NO, ContactStatus.WAITING_FOR_CHILD, t0),
        )
        val shown = LocalActions.effective(roster, actions)
        assertThat(shown.map { it.id to it.status }).containsExactly("c1" to ContactStatus.WAITING_FOR_CONTACT, "c2" to ContactStatus.BLOCKED).inOrder()
        // The parents then send a new link to Sam: the old block no longer hides the truth.
        val relinked = listOf(contact("c2", "Sam", ContactStatus.WAITING_FOR_CHILD))
        assertThat(LocalActions.effective(relinked, actions).single().status).isEqualTo(ContactStatus.WAITING_FOR_CHILD)
    }

    @Test
    fun `a choice is dropped once the server has it and the rules caught up, and kept until it is sent`() {
        val a = LocalAction("c1", LocalActionKind.YES, ContactStatus.WAITING_FOR_CHILD, t0)
        val caughtUp = listOf(contact("c1", "Grandma", ContactStatus.ACTIVE))
        assertThat(LocalActions.prune(listOf(a.copy(sent = true)), caughtUp, t0 + 1)).isEmpty()
        assertThat(LocalActions.prune(listOf(a), caughtUp, t0 + 1)).containsExactly(a)
        assertThat(LocalActions.prune(listOf(a), caughtUp, t0 + 8 * day)).isEmpty()
    }

    // ---- Conversation states

    private fun line(id: String, fromChild: Boolean, at: Long, received: Long? = null, kind: String = if (fromChild) "quick" else "reply") =
        ExtendedLine(id, fromChild, kind, "text $id", at, received)

    private fun item(id: String, at: Long, status: OutboxStatus = OutboxStatus.PENDING, target: String = "c1", kind: String = "quick") =
        OutboxItem(id, target, kind, "text $id", at, status)

    @Test
    fun `a message is sending, then sent, then delivered`() {
        val pending = ConversationMerge.merge(emptyList(), listOf(item("m1", t0)), "c1", t0 + 1_000)
        assertThat(pending.single().state).isEqualTo(LineState.SENDING)
        val stored = ConversationMerge.merge(emptyList(), listOf(item("m1", t0, OutboxStatus.STORED)), "c1", t0 + 1_000)
        assertThat(stored.single().state).isEqualTo(LineState.SENT)
        val onServer = ConversationMerge.merge(listOf(line("m1", true, t0)), listOf(item("m1", t0, OutboxStatus.STORED)), "c1", t0 + 1_000)
        assertThat(onServer.single().state).isEqualTo(LineState.SENT)
        val delivered = ConversationMerge.merge(listOf(line("m1", true, t0, received = t0 + 500)), emptyList(), "c1", t0 + 1_000)
        assertThat(delivered.single().state).isEqualTo(LineState.DELIVERED)
    }

    @Test
    fun `a message to a person who is gone, or that waited a day, is not delivered`() {
        val gone = ConversationMerge.merge(emptyList(), listOf(item("m1", t0, OutboxStatus.FAILED)), "c1", t0 + 1_000)
        assertThat(gone.single().state).isEqualTo(LineState.NOT_DELIVERED)
        val pending = listOf(item("m2", t0))
        assertThat(ConversationMerge.merge(emptyList(), pending, "c1", t0 + day).single().state).isEqualTo(LineState.SENDING)
        assertThat(ConversationMerge.merge(emptyList(), pending, "c1", t0 + day + 1).single().state).isEqualTo(LineState.NOT_DELIVERED)
    }

    @Test
    fun `the conversation is the server's lines and this phone's own, by time, and only for this person`() {
        val server = listOf(line("r1", false, t0 + 2_000), line("m1", true, t0))
        val merged = ConversationMerge.merge(
            server, listOf(item("m2", t0 + 3_000), item("x", t0 + 1_000, target = "c2")), "c1", t0 + 4_000,
        )
        assertThat(merged.map { it.key }).containsExactly("m1", "r1", "m2").inOrder()
        // Replies carry no state of their own.
        assertThat(merged.first { it.key == "r1" }.state).isNull()
    }

    // ---- Outbox

    @Test
    fun `a retry keeps the same id, so the server never gets a second line`() {
        val sent = mutableListOf<String>()
        val first = listOf(item("m1", t0))
        val offline = Outbox.flush(first, t0 + 1_000) { sent += it.id; Attempt.RETRY }
        assertThat(offline).isEqualTo(first)
        val online = Outbox.flush(offline, t0 + 60_000) { sent += it.id; Attempt.STORED }
        assertThat(sent).containsExactly("m1", "m1").inOrder()
        assertThat(online.single().status).isEqualTo(OutboxStatus.STORED)
        // Done is done: a stored item is not sent again.
        Outbox.flush(online, t0 + 120_000) { error("sent again") }
    }

    @Test
    fun `gone and rejected fail at once, and after a day a retry gives up`() {
        val gone = Outbox.flush(listOf(item("m1", t0)), t0 + 1) { Attempt.GONE }
        assertThat(gone.single().status).isEqualTo(OutboxStatus.FAILED)
        val rejected = Outbox.flush(listOf(item("m1", t0)), t0 + 1) { Attempt.REJECTED }
        assertThat(rejected.single().status).isEqualTo(OutboxStatus.FAILED)
        val late = Outbox.flush(listOf(item("m1", t0)), t0 + day + 1) { error("too late to send") }
        assertThat(late.single().status).isEqualTo(OutboxStatus.FAILED)
    }

    @Test
    fun `the first retry ends the pass, so a missing network is tried once`() {
        val sent = mutableListOf<String>()
        val out = Outbox.flush(listOf(item("a", t0), item("b", t0 + 1)), t0 + 10) { sent += it.id; Attempt.RETRY }
        assertThat(sent).containsExactly("a")
        assertThat(out.map { it.status }).containsExactly(OutboxStatus.PENDING, OutboxStatus.PENDING)
    }

    @Test
    fun `a snapshot keeps its position only while it is pending, and is not sent after an hour`() {
        val fix = LocationFix(55.5, 12.25, 18f, t0)
        val snap = OutboxItem("s1", "parents", "snapshot", "Location", t0, fix = fix)
        assertThat(OutboxItem.parse(JSONObject(snap.toJson().toString()))).isEqualTo(snap)
        val stored = Outbox.flush(listOf(snap), t0 + 1_000) { Attempt.STORED }.single()
        assertThat(stored.fix).isNull()
        val late = Outbox.flush(listOf(snap), t0 + Outbox.SNAPSHOT_GIVE_UP_MS + 1) { error("an hour is over") }.single()
        assertThat(late.status).isEqualTo(OutboxStatus.FAILED)
        assertThat(late.fix).isNull()
    }

    @Test
    fun `stored items go once the server holds them`() {
        val items = listOf(item("a", t0, OutboxStatus.STORED), item("b", t0, OutboxStatus.PENDING), item("c", t0, OutboxStatus.STORED))
        assertThat(Outbox.prune(items, setOf("a"), t0 + 1).map { it.id }).containsExactly("b", "c")
        assertThat(Outbox.prune(items, emptySet(), t0 + 31 * day)).isEmpty()
    }

    // ---- Modes

    private val cph = ZoneId.of("Europe/Copenhagen")
    private fun at(text: String): Instant = ZonedDateTime.of(LocalDateTime.parse(text), cph).toInstant()

    private fun modeRules(parents: String = """[{"name":"Mum","number":"+4512345678"}]""", profile: String = "child", modes: Boolean = true): ServerRules {
        val json = JSONObject(rulesJson(contacts = """[{"name":"Mum","number":"+4512345678","group":"family"}]"""))
        json.put("profile", profile)
        json.put("sos", JSONObject("""{"name":"Alex","parents":$parents}"""))
        if (modes) json.put(
            "modes",
            JSONObject(
                """{"enabled":true,"defaultModeId":"free","list":[
                  {"id":"free","preset":"free","name":null,"allApps":true,"allowedPackages":[],"contactGroups":["family","friends","others"],"quiet":false},
                  {"id":"school","preset":"school","name":null,"allApps":false,"allowedPackages":[],"contactGroups":["family"],"quiet":false}],
                 "slots":[{"id":"s1","modeId":"school","days":[1,2,3,4,5],"start":"08:00","end":"14:00"}]}""",
            ),
        )
        return ServerRules.parse(json.toString())
    }

    @Test
    fun `during school only the family group can be written to`() {
        val r = modeRules()
        val school = at("2027-01-04T10:00")
        assertThat(ExtendedModes.blockedBy(r, true, "others", school)!!.mode!!.id).isEqualTo("school")
        assertThat(ExtendedModes.blockedBy(r, true, "friends", school)).isNotNull()
        assertThat(ExtendedModes.blockedBy(r, true, "family", school)).isNull()
        // Outside a slot the default mode lets every group through.
        assertThat(ExtendedModes.blockedBy(r, true, "others", at("2027-01-04T15:00"))).isNull()
    }

    @Test
    fun `groups do not block when they do not narrow calls either`() {
        val school = at("2027-01-04T10:00")
        // The list is not enforced.
        assertThat(ExtendedModes.blockedBy(modeRules(), false, "others", school)).isNull()
        // No parent is marked, so the phone cannot tell who is always reachable.
        assertThat(ExtendedModes.blockedBy(modeRules(parents = "[]"), true, "others", school)).isNull()
        // Modes are off.
        assertThat(ExtendedModes.blockedBy(modeRules(modes = false), true, "others", school)).isNull()
        assertThat(ExtendedModes.blockedBy(null, true, "others", school)).isNull()
        // Not a child phone.
        assertThat(ExtendedModes.blockedBy(modeRules(profile = "self"), true, "others", school)).isNull()
    }

    // ---- Snapshots

    @Test
    fun `the confirmation names the family inbox recipients, or the person`() {
        assertThat(SnapshotConfirm.recipients(ShareTarget.Parents, listOf("Mum", "Dad", " "))).containsExactly("Mum", "Dad").inOrder()
        // Not known yet: empty, and the screen says "your parents".
        assertThat(SnapshotConfirm.recipients(ShareTarget.Parents, emptyList())).isEmpty()
        assertThat(SnapshotConfirm.recipients(ShareTarget.Person("c1", "Grandma"), listOf("Mum"))).containsExactly("Grandma")
        assertThat(ShareTarget.Parents.wire).isEqualTo("parents")
        assertThat(ShareTarget.Person("c1", "Grandma").wire).isEqualTo("c1")
    }

    @Test
    fun `an hour is told in hours and anything else in minutes`() {
        assertThat(SnapshotConfirm.duration(60)).isEqualTo(1 to true)
        assertThat(SnapshotConfirm.duration(120)).isEqualTo(2 to true)
        assertThat(SnapshotConfirm.duration(45)).isEqualTo(45 to false)
    }

    @Test
    fun `without the permission, with location off or with no fix nothing is found`() {
        val fix = LocationFix(55.5, 12.25, 18f, t0)
        assertThat(LookupOutcome.of(permissionGranted = false, locationEnabled = true, fix = fix)).isEqualTo(LookupOutcome.Off)
        assertThat(LookupOutcome.of(permissionGranted = true, locationEnabled = false, fix = fix)).isEqualTo(LookupOutcome.Off)
        assertThat(LookupOutcome.of(permissionGranted = true, locationEnabled = true, fix = null)).isEqualTo(LookupOutcome.NoFix)
        assertThat(LookupOutcome.of(permissionGranted = true, locationEnabled = true, fix = fix)).isEqualTo(LookupOutcome.Found(fix))
    }

    @Test
    fun `the phone's own log keeps every snapshot for 30 days, newest first`() {
        val old = SnapshotLogEntry("Mum, Dad", t0 - 31 * day, t0 - 31 * day + 3_600_000)
        val mid = SnapshotLogEntry("Grandma", t0 - day, t0 - day + 3_600_000)
        val fresh = SnapshotLogEntry("Grandma", t0, t0 + 3_600_000)
        val log = SnapshotLogEntry.add(listOf(mid, old), fresh, t0)
        assertThat(log).containsExactly(fresh, mid).inOrder()
        assertThat(SnapshotLogEntry.parse(JSONObject(fresh.toJson().toString()))).isEqualTo(fresh)
    }

    @Test
    fun `a snapshot that never arrived leaves the phone's own log`() {
        val sent = SnapshotLogEntry("Grandma", t0, t0 + 3_600_000, "s1")
        val lost = SnapshotLogEntry("Mum, Dad", t0 - 1, t0 + 3_599_999, "s2")
        val older = SnapshotLogEntry("Grandma", t0 - day, t0 - day + 3_600_000)
        val outbox = listOf(
            OutboxItem("s1", "c1", "snapshot", "Location", t0, OutboxStatus.STORED),
            OutboxItem("s2", "parents", "snapshot", "Location", t0 - 1, OutboxStatus.FAILED),
        )
        assertThat(SnapshotLogEntry.dropFailed(listOf(sent, lost, older), outbox)).containsExactly(sent, older).inOrder()
    }
}
