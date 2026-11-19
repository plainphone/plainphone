// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

/** A person the phone may call and text, and who may call and text the phone. */
data class ApprovedContact(val name: String, val number: String)

/**
 * The rules for calls and messages at one moment.
 *
 * @param enforced false while the phone is not locked (no Device Owner, or a
 *   maintenance unlock). Then everything is allowed, like a normal phone.
 * @param country the phone's home country, for numbers written without +code.
 */
data class ContactRules(
    val enforced: Boolean,
    val contacts: List<ApprovedContact>,
    val country: PhoneNumbers.Country?,
    val help: HelpDirectory = HelpDirectory(),
    val replyAgeMs: (Channel, String) -> Long? = { _, _ -> null },
    val selfProfile: Boolean = false,
    val childProfile: Boolean = false,
    val suggestDeviceContacts: Boolean = false,
    /** Silent bedtime is on right now: only [bedtimeRingers], help lines and an emergency call-back ring. */
    val silentBedtime: Boolean = false,
    val bedtimeRingers: List<ApprovedContact> = emptyList(),
) {
    fun isBedtimeRinger(number: String?): Boolean {
        val key = PhoneNumbers.normalize(number, country) ?: return false
        return bedtimeRingers.any { PhoneNumbers.normalize(it.number, country) == key }
    }

    fun helpContact(number: String?, channel: Channel): ApprovedContact? =
        help.contactFor(number, Helplines.country(country), channel)

    fun replyHelpContact(number: String?, channel: Channel): ApprovedContact? =
        help.contactFor(number, Helplines.country(country), channel, replyOnly = true)

    fun incomingHelpContact(number: String?, channel: Channel): ApprovedContact? =
        replyHelpContact(number, channel)?.takeIf {
            val age = replyAgeMs(channel, it.number)
            age != null && age in 0 until help.replyWindowMs(it, channel)
        }

    fun isHelpNumber(number: String?): Boolean = help.contains(number, Helplines.country(country))

    /** The approved contact behind [number], if any. */
    fun contactFor(number: String?): ApprovedContact? {
        val key = PhoneNumbers.normalize(number, country) ?: return null
        return contacts.firstOrNull { PhoneNumbers.normalize(it.number, country) == key }
    }
}

enum class Direction { INCOMING, OUTGOING }
enum class Channel { CALL, SMS }

sealed interface Decision {
    val allowed: Boolean

    data class Allow(val why: String) : Decision {
        override val allowed = true
    }

    data class Block(val why: String) : Decision {
        override val allowed = false
    }
}

/**
 * The approved-contacts rule. Pure logic: Android services feed it numbers and
 * act on the answer.
 */
class ContactPolicy(
    private val emergency: EmergencyCheck,
    /** Milliseconds since the last emergency call, or null if none is known. */
    private val sinceLastEmergencyMs: () -> Long? = { null },
) {
    fun decide(
        rules: ContactRules, channel: Channel, direction: Direction, number: String?,
        allowHelpReply: Boolean = true,
    ): Decision {
        // Calling and texting emergency numbers always works, whatever the rules say. Only outgoing:
        // an incoming "112" is just a caller ID, which is easy to spoof. Real call-backs are
        // covered by the call-back window below.
        if (direction == Direction.OUTGOING && number != null && emergency.isEmergency(number)) {
            return Decision.Allow("emergency number")
        }
        val help = when (direction) {
            Direction.OUTGOING -> rules.helpContact(number, channel)
            Direction.INCOMING -> if (allowHelpReply) rules.incomingHelpContact(number, channel) else null
        }
        if (help != null) return Decision.Allow("help line")
        if (!rules.enforced) return Decision.Allow("lock not active")

        // After an emergency call, the emergency service must be able to call back,
        // often from a number that is hidden or not on the list.
        if (channel == Channel.CALL && direction == Direction.INCOMING) {
            val since = sinceLastEmergencyMs()
            if (since != null && since in 0..EMERGENCY_CALLBACK_WINDOW_MS) {
                return Decision.Allow("emergency callback window")
            }
        }

        if (number.isNullOrBlank()) return Decision.Block("hidden or unknown number")
        if (PhoneNumbers.normalize(number, rules.country) == null) return Decision.Block("not a phone number")
        val contact = rules.contactFor(number) ?: return Decision.Block("not an approved contact")
        return Decision.Allow("approved contact ${contact.name}")
    }

    /**
     * Whether an incoming call that [decide] allowed may also make the phone ring. Always true unless
     * silent bedtime is on. Then only parents, help lines and the call-back after an emergency call ring.
     */
    fun ringsAtBedtime(rules: ContactRules, number: String?): Boolean {
        if (!rules.silentBedtime) return true
        if (rules.incomingHelpContact(number, Channel.CALL) != null) return true
        val since = sinceLastEmergencyMs()
        if (since != null && since in 0..EMERGENCY_CALLBACK_WINDOW_MS) return true
        return rules.isBedtimeRinger(number)
    }

    companion object {
        /** How long incoming calls from anyone are let through after an emergency call. */
        const val EMERGENCY_CALLBACK_WINDOW_MS = 60 * 60_000L
    }
}
