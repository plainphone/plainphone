// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.content.Context
import android.content.Intent
import android.net.Uri
import java.net.URI
import java.net.URISyntaxException
import java.util.Locale

internal class HelpLinks(context: Context) {
    private val directories = PhoneNumbers.COUNTRIES.values.distinct().map { Helplines.forCountry(context, it) }

    fun secureUrl(url: String?): String? {
        if (url == null) return null
        val uri = try {
            URI(url)
        } catch (_: URISyntaxException) {
            return null
        }
        val scheme = uri.scheme?.lowercase(Locale.ROOT)
        val host = uri.host ?: return null
        if (uri.rawUserInfo != null || directories.none { it.allowsHost(host) }) return null
        val defaultPort = when (scheme) {
            "https" -> 443
            "http" -> 80
            else -> return null
        }
        if (uri.port != -1 && uri.port != defaultPort) return null

        val secure = Uri.parse(url).buildUpon().scheme("https")
        if (scheme == "http") secure.encodedAuthority(host)
        return secure.build().toString()
    }

    fun allowsNavigation(uri: Uri): Boolean =
        uri.scheme == "https" && secureUrl(uri.toString()) != null

    fun intent(context: Context, url: String): Intent? =
        secureUrl(url)?.let { Intent(Intent.ACTION_VIEW, Uri.parse(it), context, HelpActivity::class.java) }
}
