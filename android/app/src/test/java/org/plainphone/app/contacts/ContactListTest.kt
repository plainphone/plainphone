// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class ContactListTest {
    private val dk = PhoneNumbers.countryForIso("dk")

    @Test
    fun `codec round trip`() {
        val list = listOf(ApprovedContact("Mum", "+4512345678"), ApprovedContact("Grandpa Ole", "+4587654321"))
        assertThat(ContactCodec.decode(ContactCodec.encode(list))).isEqualTo(list)
    }

    @Test
    fun `codec reads the QR format and tolerates noise`() {
        assertThat(ContactCodec.decode(" Mum = +45 12 34 56 78 ; Dad=87654321;;\n+4511111111 "))
            .containsExactly(
                ApprovedContact("Mum", "+45 12 34 56 78"),
                ApprovedContact("Dad", "87654321"),
                ApprovedContact("+4511111111", "+4511111111"),
            ).inOrder()
        assertThat(ContactCodec.decode(null)).isEmpty()
        assertThat(ContactCodec.decode("Nobody=")).isEmpty()
    }

    @Test
    fun `names cannot break the format`() {
        val tricky = ApprovedContact("A;B=C\nD", "+4512345678")
        val decoded = ContactCodec.decode(ContactCodec.encode(listOf(tricky)))
        assertThat(decoded).containsExactly(ApprovedContact("A B C D", "+4512345678"))
    }

    @Test
    fun `add stores the normalized number and replaces duplicates`() {
        var list = ContactList.add(emptyList(), ApprovedContact("Mum", "12 34 56 78"), dk).getOrThrow()
        assertThat(list).containsExactly(ApprovedContact("Mum", "+4512345678"))
        list = ContactList.add(list, ApprovedContact("Mother", "+45 12345678"), dk).getOrThrow()
        assertThat(list).containsExactly(ApprovedContact("Mother", "+4512345678"))
    }

    @Test
    fun `add sorts by name and rejects non-numbers`() {
        var list = ContactList.add(emptyList(), ApprovedContact("Zoe", "+4511111111"), dk).getOrThrow()
        list = ContactList.add(list, ApprovedContact("anna", "+4522222222"), dk).getOrThrow()
        assertThat(list.map { it.name }).containsExactly("anna", "Zoe").inOrder()
        assertThat(ContactList.add(list, ApprovedContact("X", "*#06#"), dk).isFailure).isTrue()
        assertThat(ContactList.add(list, ApprovedContact("X", "12345678"), null).isFailure).isTrue()
    }

    @Test
    fun `an empty name falls back to the number`() {
        val list = ContactList.add(emptyList(), ApprovedContact("  ", "+4512345678"), dk).getOrThrow()
        assertThat(list.single().name).isEqualTo("+4512345678")
    }

    @Test
    fun `remove matches any format`() {
        val list = listOf(ApprovedContact("Mum", "+4512345678"), ApprovedContact("Dad", "+4587654321"))
        assertThat(ContactList.remove(list, "12 34 56 78", dk)).containsExactly(ApprovedContact("Dad", "+4587654321"))
    }

    @Test
    fun `blocked events round trip and are capped`() {
        val e = BlockedEvent(1_700_000_000_000, Channel.SMS, Direction.INCOMING, "+45\t1")
        val decoded = BlockedEvent.decode(e.encode())
        assertThat(decoded).isEqualTo(e.copy(number = "+45 1"))
        assertThat(BlockedEvent.decode("garbage")).isNull()
        var list = emptyList<BlockedEvent>()
        repeat(5) { i -> list = BlockedEvent.append(list, e.copy(atMs = i.toLong()), max = 3) }
        assertThat(list.map { it.atMs }).containsExactly(4L, 3L, 2L).inOrder()
    }
}
