// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import org.junit.Test
import org.plainphone.app.sync.Schedule
import org.plainphone.app.sync.ServerRules

class HomeModelTest {
    private val zone = ZoneId.of("Europe/Copenhagen")
    // Monday 4 January 2027, 10:00 local time.
    private val mondayMorning = Instant.parse("2027-01-04T09:00:00Z")

    private fun app(pkg: String, label: String) = LaunchableApp(pkg, label, "$pkg/.Main")

    private val apps = listOf(
        app("com.spotify.music", "Spotify"),
        app("com.google.android.apps.maps", "Maps"),
        app("com.example.game", "Game"),
        app("com.android.camera", "Camera"),
        app("org.plainphone.app", "Plainphone"),
        app("dk.dr.radio", "DR LYD"),
    )

    private fun rules(
        hidden: Set<String> = setOf("com.example.game"),
        schedules: List<Schedule> = emptyList(),
        home: HomePrefs = HomePrefs.DEFAULT,
    ) = ServerRules(
        phoneId = "p",
        profile = "child",
        timezone = zone,
        allowedApps = setOf("com.spotify.music", "com.google.android.apps.maps", "dk.dr.radio"),
        hiddenApps = hidden,
        contacts = emptyList(),
        schedules = schedules,
        dnsHost = null,
        dnsReady = false,
        locationEnabled = false,
        locationIntervalMinutes = 5,
        locateRequestedAt = null,
        pollSeconds = 60,
        home = home,
    )

    /** Camera stands in for a core app, and Plainphone's own status screen is always there. */
    private val core = setOf("com.android.camera", "org.plainphone.app")

    private val school = Schedule("s", "school", setOf(1, 2, 3, 4, 5), LocalTime.of(8, 0), LocalTime.of(14, 0), setOf("com.google.android.apps.maps"))

    @Test
    fun `apps the parent hid never show, even in light mode where Android does not hide them`() {
        val s = HomeModel.build(apps, rules(), mondayMorning, core = core)
        assertThat(s.all.map { it.label }).containsExactly("Camera", "DR LYD", "Maps", "Plainphone", "Spotify").inOrder()
    }

    @Test
    fun `an app the rules do not list yet stays off the home screen`() {
        val s = HomeModel.build(apps + app("com.example.newgame", "New game"), rules(hidden = emptySet()), mondayMorning, core = core)
        assertThat(s.all.map { it.packageName }).doesNotContain("com.example.newgame")
        assertThat(s.all.map { it.packageName }).doesNotContain("com.example.game")
    }

    @Test
    fun `the front page follows the parent's order and skips apps that are not there`() {
        val home = HomePrefs(apps = listOf("dk.dr.radio", "com.example.game", "not.installed", "com.spotify.music"))
        val s = HomeModel.build(apps, rules(home = home), mondayMorning)
        assertThat(s.favourites.map { it.label }).containsExactly("DR LYD", "Spotify").inOrder()
    }

    @Test
    fun `without a choice the front page has no apps, only the clock, phone and messages`() {
        assertThat(HomeModel.build(apps, rules(), mondayMorning).favourites).isEmpty()
    }

    @Test
    fun `app names sort the Danish way`() {
        val danish = listOf(app("a.aa", "Åbent"), app("a.ae", "Ærø"), app("a.z", "Zoo"), app("a.oe", "Øl"))
        val s = HomeModel.build(danish, null, mondayMorning, locale = java.util.Locale.forLanguageTag("da-DK"))
        assertThat(s.all.map { it.label }).containsExactly("Zoo", "Ærø", "Øl", "Åbent").inOrder()
    }

    @Test
    fun `during school time only the window's apps and the core apps show, with a quiet notice`() {
        val home = HomePrefs(apps = listOf("com.spotify.music", "com.google.android.apps.maps"))
        val s = HomeModel.build(apps, rules(schedules = listOf(school), home = home), mondayMorning, core = setOf("com.android.camera"))
        assertThat(s.all.map { it.label }).containsExactly("Camera", "Maps")
        assertThat(s.favourites.map { it.label }).containsExactly("Maps")
        assertThat(s.notice).isEqualTo(WindowNotice(WindowNotice.Kind.SCHOOL, LocalTime.of(14, 0)))
    }

    @Test
    fun `outside school time there is no notice`() {
        val evening = Instant.parse("2027-01-04T17:00:00Z")
        assertThat(HomeModel.build(apps, rules(schedules = listOf(school)), evening).notice).isNull()
    }

    @Test
    fun `bedtime is named as bedtime`() {
        val bedtime = Schedule("b", "bedtime", (1..7).toSet(), LocalTime.of(21, 0), LocalTime.of(7, 0), emptySet())
        val night = Instant.parse("2027-01-04T21:30:00Z")
        assertThat(HomeModel.build(apps, rules(schedules = listOf(bedtime)), night).notice)
            .isEqualTo(WindowNotice(WindowNotice.Kind.BEDTIME, LocalTime.of(7, 0)))
    }

    @Test
    fun `the phone and messages buttons are not listed again`() {
        val s = HomeModel.build(apps, null, mondayMorning, fixed = setOf("org.plainphone.app/.Main"))
        assertThat(s.all.map { it.packageName }).doesNotContain("org.plainphone.app")
        // Not paired yet: everything Android shows is shown, with the default look.
        assertThat(s.all).hasSize(5)
        assertThat(s.prefs).isEqualTo(HomePrefs.DEFAULT)
    }

    @Test
    fun `time left shows next to the app`() {
        val s = HomeModel.build(apps, rules(), mondayMorning, minutesLeft = mapOf("com.spotify.music" to 25))
        assertThat(s.all.first { it.label == "Spotify" }.minutesLeft).isEqualTo(25)
        assertThat(s.all.first { it.label == "Maps" }.minutesLeft).isNull()
    }
}
