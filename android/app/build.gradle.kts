// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing is read from a properties file OUTSIDE the repository.
// Point PLAINPHONE_SIGNING at it (see README "Signing"). Without it, the
// release build falls back to the local debug key so CI can still build.
val signingProps: Properties? = System.getenv("PLAINPHONE_SIGNING")
    ?.let { file(it) }
    ?.takeIf { it.isFile }
    ?.let { f -> Properties().apply { f.inputStream().use { load(it) } } }

android {
    namespace = "org.plainphone.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "org.plainphone.app"
        minSdk = 34
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        if (signingProps != null) {
            create("plainphone") {
                storeFile = file(signingProps.getProperty("storeFile"))
                storePassword = signingProps.getProperty("storePassword")
                keyAlias = signingProps.getProperty("keyAlias")
                keyPassword = signingProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (signingProps != null) {
                signingConfigs.getByName("plainphone")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    lint {
        abortOnError = true
        warningsAsErrors = false
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.18")
    testImplementation("androidx.test:core:1.7.0")
    testImplementation("com.google.truth:truth:1.4.5")
}
