import org.gradle.api.tasks.compile.JavaCompile

plugins {
    id("com.android.application")
    // START: FlutterFire Configuration
    id("com.google.gms.google-services")
    id("com.google.firebase.firebase-perf")
    id("com.google.firebase.crashlytics")
    // END: FlutterFire Configuration
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "za.co.developify.developify_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Confirm the distribution identifier before registering production services.
        applicationId = "za.co.developify.developify_mobile"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // Local release-mode validation uses debug signing; see docs/SETUP_GUIDE.md.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

tasks.withType<JavaCompile>().configureEach {
    if (name == "compileReleaseJavaWithJavac") {
        doFirst {
            val registrant = layout.projectDirectory.file(
                "src/main/java/io/flutter/plugins/GeneratedPluginRegistrant.java",
            ).asFile
            val source = registrant.readText()
            val releaseOnlyFilter = Regex(
                """(?ms)^\s*try \{\r?\n\s*flutterEngine\.getPlugins\(\)\.add\(new dev\.flutter\.plugins\.integration_test\.IntegrationTestPlugin\(\)\);\r?\n\s*\} catch \(Exception e\) \{\r?\n\s*Log\.e\(TAG, "Error registering plugin integration_test, dev\.flutter\.plugins\.integration_test\.IntegrationTestPlugin", e\);\r?\n\s*\}\r?\n""",
            )
            val filteredSource = source.replace(releaseOnlyFilter, "")
            if (
                filteredSource == source &&
                source.contains("dev.flutter.plugins.integration_test.IntegrationTestPlugin")
            ) {
                throw GradleException(
                    "Could not exclude the test-only integration_test plugin from the release registrant.",
                )
            }
            if (filteredSource != source) {
                registrant.writeText(filteredSource)
            }
        }
    }
}
