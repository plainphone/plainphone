// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.requests

import com.google.common.truth.Truth.assertThat
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.sync.MoreTimeRequest
import org.robolectric.RobolectricTestRunner

/** A request for more time is listed with the others and can be approved with the parent PIN. */
@RunWith(RobolectricTestRunner::class)
class MoreTimeRequestRowTest {
    private fun moreTime(status: String, pkg: String = "com.example.game", via: String? = null) = MoreTimeRequest.parse(
        JSONObject(
            """{"id":"m1","packageName":"$pkg","reason":null,"day":"2026-11-19","status":"$status","answer":null,
            "grantedMinutes":null,"createdAt":"2026-11-19T10:00:00.000Z","decidedAt":null,
            "decidedVia":${via?.let { "\"$it\"" }}}""",
        ),
    )

    @Test
    fun `a waiting ask for more time is a pending request that can be approved`() {
        val r = PhoneRequest.fromMoreTime(moreTime("pending"))!!
        assertThat(r.kind).isEqualTo(PhoneRequest.Kind.MORE_TIME)
        assertThat(r.pending).isTrue()
        assertThat(r.packageName).isEqualTo("com.example.game")
        val row = requestRows(listOf(r), emptySet()) { "Game" }.single()
        assertThat(row.state).isEqualTo(RowState.WAITING)
    }

    @Test
    fun `the daily limit has no package`() {
        assertThat(PhoneRequest.fromMoreTime(moreTime("pending", pkg = "*"))!!.packageName).isNull()
    }

    @Test
    fun `an approval on the phone shows as approved on the phone, a no as declined`() {
        assertThat(PhoneRequest.fromMoreTime(moreTime("approved", via = "phone"))!!.approvedOnPhone).isTrue()
        val parent = PhoneRequest.fromMoreTime(moreTime("approved", via = "parent"))!!
        assertThat(parent.approvedOnPhone).isFalse()
        assertThat(PhoneRequest.fromMoreTime(moreTime("declined"))!!.status).isEqualTo(PhoneRequest.Status.REJECTED)
    }

    @Test
    fun `an ask nobody answered in time is not listed`() {
        assertThat(PhoneRequest.fromMoreTime(moreTime("expired"))).isNull()
    }

    @Test
    fun `a missing decidedVia from an older server is fine`() {
        val old = MoreTimeRequest.parse(
            JSONObject(
                """{"id":"m1","packageName":"*","reason":null,"day":"2026-11-19","status":"approved","answer":"15",
                "grantedMinutes":15,"createdAt":"2026-11-19T10:00:00.000Z","decidedAt":"2026-11-19T10:01:00.000Z"}""",
            ),
        )
        assertThat(old.decidedVia).isNull()
    }
}
