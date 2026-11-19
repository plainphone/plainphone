// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app

import android.app.Activity
import android.app.Application
import android.app.LocaleManager
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build
import android.os.Bundle
import android.os.LocaleList
import java.util.Locale

/** Applies dashboard language choices to Plainphone's resources only. */
internal class PhoneLanguage(private val app: Application) {
    private val activities = mutableSetOf<Activity>()
    private var selected: String? = null

    init {
        if (Build.VERSION.SDK_INT < 33) {
            app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
                override fun onActivityPreCreated(activity: Activity, state: Bundle?) {
                    selected?.let { updateResources(activity.resources, locales(it)) }
                }
                override fun onActivityCreated(activity: Activity, state: Bundle?) { activities.add(activity) }
                override fun onActivityDestroyed(activity: Activity) { activities.remove(activity) }
                override fun onActivityStarted(activity: Activity) = Unit
                override fun onActivityResumed(activity: Activity) = Unit
                override fun onActivityPaused(activity: Activity) = Unit
                override fun onActivityStopped(activity: Activity) = Unit
                override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
            })
        }
    }

    /** Activity recreation on older Android refreshes both Compose and view-based screens. */
    fun apply(language: String?) {
        if (Build.VERSION.SDK_INT >= 33) {
            val manager = app.getSystemService(LocaleManager::class.java)
            val requested = locales(language)
            if (manager.applicationLocales != requested) manager.applicationLocales = requested
            return
        }

        if (selected == language) return
        selected = language
        val requested = language?.let(::locales) ?: Resources.getSystem().configuration.locales
        updateResources(app.resources, requested)
        for (activity in activities.toList()) {
            updateResources(activity.resources, requested)
            if (!activity.isFinishing) activity.recreate()
        }
    }

    fun onConfigurationChanged() {
        if (Build.VERSION.SDK_INT >= 33) return
        val language = selected ?: return
        val requested = locales(language)
        updateResources(app.resources, requested)
        for (activity in activities) updateResources(activity.resources, requested)
    }

    @Suppress("DEPRECATION") // API 29–32 have no platform per-app locale API.
    private fun updateResources(resources: Resources, requested: LocaleList) {
        val configuration = resources.configuration
        if (configuration.locales == requested) return
        resources.updateConfiguration(Configuration(configuration).apply { setLocales(requested) }, null)
    }

    companion object {
        private val supported = setOf("da", "en", "sv", "nb", "de")

        fun supportedTag(tag: String?): String? = tag?.takeIf { it in supported }

        fun locales(tag: String?): LocaleList = supportedTag(tag)?.let { LocaleList(Locale.forLanguageTag(it)) }
            ?: LocaleList.getEmptyLocaleList()
    }
}
