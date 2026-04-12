# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# --- Capacitor ---
# Keep all Capacitor classes (plugins, bridges, annotations)
-keep class com.getcapacitor.** { *; }
-dontwarn com.getcapacitor.**

# Keep Capacitor plugin annotations
-keepattributes *Annotation*

# --- Pennivo app classes ---
# Keep all app classes (ShareIntentPlugin, MainActivity, etc.)
-keep class app.pennivo.editor.** { *; }

# --- WebView JavaScript interfaces ---
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# --- Cordova/Capacitor plugin bridge ---
-keep public class * extends com.getcapacitor.Plugin {
    public <methods>;
}

# --- Preserve line numbers for stack traces ---
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# --- AndroidX ---
-dontwarn androidx.**
-keep class androidx.** { *; }

# --- Splash screen ---
-keep class androidx.core.splashscreen.** { *; }
