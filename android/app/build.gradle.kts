// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
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
        minSdk = 29
        targetSdk = 37
        versionCode = 11
        versionName = "0.1.10"
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
            // R8 and resource shrinking: about 23 MB unshrunk. Keep rules in proguard-rules.pro.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
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

    sourceSets["main"].assets.directories.add(rootProject.file("../server/catalog/helplines").absolutePath)

    androidResources {
        localeFilters += listOf("en", "da")
    }

    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }

    buildFeatures {
        compose = true
    }

    sourceSets.named("test") {
        resources.directories.add("../../web/test-fixtures")
        resources.directories.add("../../docs/encryption-test-vectors")
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    lint {
        abortOnError = true
        warningsAsErrors = false
        error += listOf("WakelockTimeout", "ScheduleExactAlarm", "ExactAlarm", "BatteryLife")
        // The app calls the platform APIs directly and does not use core-ktx (only Compose pulls it in).
        disable += "UseKtx"
        // androidx.lifecycle ships lint checks built against an older lint API; nothing to fix on our side.
        disable += "ObsoleteLintCustomCheck"
    }
}

dependencies {
    // Phone and messages UI (phase 2).
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.activity:activity-compose:1.13.0")
    // Phase 4: rule sync in the background.
    implementation("androidx.work:work-runtime:2.12.0")

    implementation("com.google.crypto.tink:tink-android:1.24.0")
    implementation("com.google.code.gson:gson:2.13.2")
    implementation("io.github.erdtman:java-json-canonicalization:1.1")

    testImplementation("org.bouncycastle:bcprov-jdk18on:1.86")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.18")
    testImplementation("androidx.test:core:1.7.0")
    testImplementation("com.google.truth:truth:1.4.5")
    testImplementation("androidx.work:work-testing:2.12.0")
    // Screenshots of the home screen under Robolectric (native graphics), see HomeScreenshotTest.
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
