// SPDX-License-Identifier: Apache-2.0
plugins {
    id("com.android.application")
}

android {
    namespace = "org.plainphone.fixture"
    compileSdk = 37
    defaultConfig {
        applicationId = "org.plainphone.fixture"
        minSdk = 29
        targetSdk = 37
    }
}
