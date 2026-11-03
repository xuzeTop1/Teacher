import java.security.MessageDigest

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.hxz.alerttime.app"
    compileSdk = 36
    ndkVersion = "28.2.13676358"
    providers.gradleProperty("alerttime.ndkPath").orNull?.let { ndkPath = it }

    defaultConfig {
        applicationId = "com.hxz.alerttime.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        manifestPlaceholders["appLabel"] = "@string/app_name"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk { abiFilters += "arm64-v8a" }
        externalNativeBuild {
            cmake {
                arguments += listOf("-DANDROID_STL=c++_shared", "-DCMAKE_BUILD_TYPE=Release")
            }
        }
    }

    buildTypes {
        debug {
            // Opt-in separate install for real-device tests when the original signing key is unavailable.
            if (providers.gradleProperty("alerttime.isolatedModelTest").orNull == "true") {
                applicationIdSuffix = ".localcoach"
                versionNameSuffix = "-localcoach"
                manifestPlaceholders["appLabel"] = "Alert 本地模型测试"
            }
        }
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        jvmToolchain(17)
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }
    androidResources { noCompress += "gguf" }

    sourceSets {
        getByName("androidTest").assets.srcDir("$projectDir/schemas")
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

// A source checkout without prepared weights must fail before packaging a misleading APK.
val verifyLocalModelAssets by tasks.registering {
    val model = layout.projectDirectory.file("src/main/assets/local-coach/qwen2.5-0.5b-bkt-v2-q4_k_m.gguf")
    inputs.file(model)
    doLast {
        check(model.asFile.isFile) { "Run scripts/prepare-local-model.ps1 first" }
        val digest = MessageDigest.getInstance("SHA-256")
        model.asFile.inputStream().use { stream ->
            val buffer = ByteArray(1024 * 1024)
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        check(digest.digest().joinToString("") { "%02x".format(it) } ==
            "daed6c55a53da9196c8ce1f6ce5b645d731ad628d3b78946b0f564dd56e83cf8") {
            "Bundled model does not match the pinned Qwen v2 weights"
        }
    }
}
tasks.named("preBuild") { dependsOn(verifyLocalModelAssets) }

dependencies {
    val roomVersion = "2.7.2"

    implementation(platform("androidx.compose:compose-bom:2026.01.00"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.navigation:navigation-compose:2.9.0")
    implementation("androidx.work:work-runtime-ktx:2.10.1")

    implementation("androidx.room:room-runtime:$roomVersion")
    implementation("androidx.room:room-ktx:$roomVersion")
    ksp("androidx.room:room-compiler:$roomVersion")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    // Stable with Kotlin 2.1.21; keep the Android toolchain unchanged.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Teacher 同步二维码扫描（zxing CaptureActivity）。
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")

    testImplementation("junit:junit:4.13.2")

    androidTestImplementation(platform("androidx.compose:compose-bom:2026.01.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:core-ktx:1.6.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestImplementation("androidx.room:room-testing:$roomVersion")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
