// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
import groovy.json.JsonSlurper
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

// The Play upload key, also outside the repository (docs/play/play-edition.md). Only bundlePlayRelease uses it.
val playUploadProps: Properties? = System.getenv("PLAINPHONE_PLAY_UPLOAD")
    ?.let { file(it) }
    ?.takeIf { it.isFile }
    ?.let { f -> Properties().apply { f.inputStream().use { load(it) } } }

val fcmEnabled = providers.gradleProperty("plainphoneFcm").orNull == "true"
// E2EE phase 0 prototype (docs/e2ee-prototype.md): -PplainphoneE2eePrototype=true packages the
// OpenMLS core from e2ee/mls-core/scripts/build-android.sh into DEBUG builds. Release never has it.
val e2eePrototype = providers.gradleProperty("plainphoneE2eePrototype").orNull == "true"
val mlsHostLib = providers.gradleProperty("plainphoneMlsHostLib").orNull

android {
    namespace = "org.plainphone.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "org.plainphone.app"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        minSdk = 29
        targetSdk = 37
        versionCode = 21
        versionName = "0.1.20"
        if (fcmEnabled) {
            val config = providers.environmentVariable("PLAINPHONE_GOOGLE_SERVICES_FILE").orNull
                ?.let { file(it) } ?: file("google-services.json")
            require(config.isFile) { "FCM requires the child app's google-services.json" }
            val json = JsonSlurper().parse(config) as Map<*, *>
            val project = json["project_info"] as Map<*, *>
            val client = (json["client"] as List<*>).filterIsInstance<Map<*, *>>().first {
                val info = it["client_info"] as Map<*, *>
                (info["android_client_info"] as Map<*, *>)["package_name"] == applicationId
            }
            val info = client["client_info"] as Map<*, *>
            val key = (client["api_key"] as List<*>).first() as Map<*, *>
            resValue("string", "google_app_id", info.get("mobilesdk_app_id") as String)
            resValue("string", "gcm_defaultSenderId", project.get("project_number") as String)
            resValue("string", "project_id", project.get("project_id") as String)
            resValue("string", "google_api_key", key.get("current_key") as String)
        }
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
        if (playUploadProps != null) {
            create("playUpload") {
                storeFile = file(playUploadProps.getProperty("storeFile"))
                storePassword = playUploadProps.getProperty("storePassword")
                keyAlias = playUploadProps.getProperty("keyAlias")
                keyPassword = playUploadProps.getProperty("keyPassword")
            }
        }
    }

    // Where the app is distributed (docs/play/play-edition.md). `github` is today's app for GitHub
    // Releases and F-Droid, and the default. `play` is the Google Play edition: light mode, Child
    // profile, no self-updater; its differences live in src/play (Distribution.kt, the manifest).
    flavorDimensions += "distribution"
    productFlavors {
        create("github") {
            dimension = "distribution"
            isDefault = true
        }
        create("play") {
            dimension = "distribution"
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

    sourceSets["main"].kotlin.directories.add(if (fcmEnabled) "src/fcm/java" else "src/noFcm/java")
    if (fcmEnabled) {
        sourceSets["debug"].manifest.srcFile("src/fcm/AndroidManifest.xml")
        sourceSets["release"].manifest.srcFile("src/fcm/AndroidManifest.xml")
    }
    sourceSets["main"].assets.directories.add(rootProject.file("../server/catalog/helplines").absolutePath)
    if (e2eePrototype) {
        val libs = rootProject.file("../e2ee/mls-core/target/jniLibs")
        require(libs.resolve("arm64-v8a/libplainphone_mls.so").isFile) {
            "Run e2ee/mls-core/scripts/build-android.sh before -PplainphoneE2eePrototype=true"
        }
        sourceSets["debug"].jniLibs.directories.add(libs.absolutePath)
    }

    androidResources {
        localeFilters += listOf("en", "da", "sv", "nb", "de")
    }

    bundle {
        language {
            enableSplit = false
        }
    }

    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }

    buildFeatures {
        compose = true
        resValues = fcmEnabled
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

androidComponents {
    // The Play bundle is signed with the upload key when PLAINPHONE_PLAY_UPLOAD is set, otherwise like
    // every release. Google Play re-signs it with the app signing key (docs/play/play-edition.md).
    onVariants(selector().withFlavor("distribution" to "play").withBuildType("release")) { variant ->
        if (playUploadProps != null) variant.signingConfig.setConfig(android.signingConfigs.getByName("playUpload"))
    }
}

val robolectricArtifacts = Properties().apply {
    val manifest = rootProject.layout.projectDirectory.file("gradle/robolectric.properties")
    load(providers.fileContents(manifest).asText.get().reader())
}
val robolectricVersion = requireNotNull(robolectricArtifacts.remove("robolectric"))
val robolectricSdkVersions = robolectricArtifacts.stringPropertyNames().sorted()
    .map(robolectricArtifacts::getProperty)
// Keep the restored cache available when clean and the tests run together.
val robolectricDependencyDir = rootProject.layout.projectDirectory.dir(".gradle/robolectric")
val prepareRobolectricSdks = tasks.register<Sync>("prepareRobolectricSdks") {
    // Separate configurations let Gradle resolve several versions of the same module.
    from(robolectricSdkVersions.map { version ->
        configurations.detachedConfiguration(
            project.dependencies.create("org.robolectric:android-all-instrumented:$version")
        ).apply { isTransitive = false }
    })
    into(robolectricDependencyDir)
}
val restoredRobolectricSdks = providers.environmentVariable("ROBOLECTRIC_SDK_CACHE_HIT").orNull == "true" &&
    robolectricSdkVersions.all { version ->
        robolectricDependencyDir.file("android-all-instrumented-$version.jar").asFile.isFile
    }

tasks.withType<Test>().configureEach {
    // Robolectric and Compose screenshot tests outgrow the 512 MB default test heap.
    maxHeapSize = "1536m"
    // MlsCoreJniTest (E2EE prototype) runs only with a host build of the core.
    if (mlsHostLib != null) systemProperty("plainphone.mlsHostLib", mlsHostLib)
    if (!restoredRobolectricSdks) dependsOn(prepareRobolectricSdks)
    inputs.dir(robolectricDependencyDir).withPropertyName("robolectricSdks")
    systemProperty("robolectric.offline", "true")
    systemProperty("robolectric.dependency.dir", robolectricDependencyDir.asFile.absolutePath)
}

dependencies {
    if (fcmEnabled) implementation("com.google.firebase:firebase-messaging:25.0.1")
    // The play flavor (src/play) pays through Google Play Billing; the github flavor has no store.
    "playImplementation"("com.android.billingclient:billing:9.1.0")
    // Billing's Play services pull in fragment 1.1, too old for the activity result APIs (lint error).
    "playImplementation"("androidx.fragment:fragment:1.9.1")
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

    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")

    testImplementation("org.bouncycastle:bcprov-jdk18on:1.86")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:$robolectricVersion")
    testImplementation("androidx.test:core:1.7.0")
    testImplementation("com.google.truth:truth:1.4.5")
    testImplementation("androidx.work:work-testing:2.12.0")
    // Screenshots of the home screen under Robolectric (native graphics), see HomeScreenshotTest.
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
