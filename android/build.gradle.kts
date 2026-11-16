// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
plugins {
    id("com.android.application") version "9.5.1" apply false
    // Same Kotlin version as the compiler AGP uses for the app (see app/build.gradle.kts).
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
}
