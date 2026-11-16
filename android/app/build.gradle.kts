plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// Nothing's SDK licence does not allow redistributing the .aar, so it is not in
// this repo. scripts/fetch-sdk downloads it from Nothing's own GitHub.
val glyphSdk = file("libs/glyph-matrix-sdk-2.0.aar")

android {
    namespace = "io.github.matrixbridge.phone"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.matrixbridge.phone"
        minSdk = 34
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so GitHub release builds install without extra setup.
            // Swap in your own keystore before publishing anywhere that matters.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
    buildFeatures {
        compose = true
    }
    testOptions {
        // Lets plain JVM tests call code that logs with android.util.Log.
        unitTests.isReturnDefaultValues = true
    }
}

tasks.named("preBuild") {
    doFirst {
        if (!glyphSdk.exists()) {
            throw GradleException(
                "Glyph Matrix SDK not found at ${glyphSdk.path}.\n" +
                    "Run scripts/fetch-sdk.ps1 (Windows) or scripts/fetch-sdk.sh from the repo root first."
            )
        }
    }
}

dependencies {
    implementation(files(glyphSdk))
    implementation(libs.java.websocket)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    debugImplementation(libs.androidx.ui.tooling)

    testImplementation(libs.junit)
    // android.jar only has stubs for org.json; unit tests need the real thing.
    testImplementation(libs.org.json)
}
