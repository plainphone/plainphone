// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "plainphone"
include(":app", ":e2e-fixture")
