# ============================================================
# AlertTime ProGuard / R8 Rules
# ============================================================

# ---- General Android ----
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# ---- Kotlin ----
-dontwarn kotlin.**
-keep class kotlin.Metadata { *; }

# ---- Room ----
-keep class * extends androidx.room.RoomDatabase { *; }
-keep @androidx.room.Entity class * { *; }
-keep @androidx.room.Dao interface * { *; }
-dontwarn androidx.room.paging.**

# ---- Jetpack Compose ----
-dontwarn androidx.compose.**

# ---- Coroutines ----
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-keepclassmembers class kotlinx.coroutines.** {
    volatile <fields>;
}

# ---- Keep data classes used with Gson / serialization ----
-keep class com.hxz.alerttime.app.data.local.entity.** { *; }

# ---- kotlinx.serialization (backup JSON protocol) ----
# The backup DTOs are (de)serialized through statically resolved serializers;
# keep their generated serializer companions and descriptors for release builds.
-keep,includedescriptorclasses class com.hxz.alerttime.app.data.backup.**$$serializer { *; }
-keepclassmembers class com.hxz.alerttime.app.data.backup.** {
    *** Companion;
}
-keepclasseswithmembers class com.hxz.alerttime.app.data.backup.** {
    kotlinx.serialization.KSerializer serializer(...);
}
