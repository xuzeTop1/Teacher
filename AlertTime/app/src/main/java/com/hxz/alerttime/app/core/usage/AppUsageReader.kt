package com.hxz.alerttime.app.core.usage

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.util.Log
import com.hxz.alerttime.app.data.local.entity.StudySessionEntity
import com.hxz.alerttime.app.data.sync.ExternalAiUsageReader

data class ForegroundAppInfo(
    val packageName: String,
    val label: String,
    val timestamp: Long
) {
    val displayText: String = "$label ($packageName)"
    val displayLabel: String = label
}

class AppUsageReader(
    private val context: Context
) {
    fun hasUsageAccess(): Boolean {
        val appOpsManager = context.getSystemService(AppOpsManager::class.java)
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOpsManager.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        } else {
            @Suppress("DEPRECATION")
            appOpsManager.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    fun usageAccessSettingsIntent(): Intent {
        return Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    fun findForegroundAppAfter(
        sinceMillis: Long,
        untilMillis: Long = System.currentTimeMillis()
    ): ForegroundAppInfo? {
        if (!hasUsageAccess()) {
            Log.d(TAG, "Usage access is not granted.")
            return null
        }

        val usageStatsManager = context.getSystemService(UsageStatsManager::class.java)
        val queryStartMillis = (sinceMillis - LOOKBACK_PADDING_MS).coerceAtLeast(0L)
        val events = usageStatsManager.queryEvents(queryStartMillis, untilMillis)
        val event = UsageEvents.Event()
        val launcherPackages = launcherPackages()
        var latestPackageNameAfterStop: String? = null
        var latestTimestampAfterStop = 0L
        var latestPackageNameNearStop: String? = null
        var latestTimestampNearStop = 0L
        var latestSelfTimestamp = 0L

        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val packageName = event.packageName ?: continue
            val reason = when {
                packageName == context.packageName -> "self"
                packageName in launcherPackages -> "launcher"
                packageName in IGNORED_PACKAGES -> "ignored"
                event.timeStamp < queryStartMillis -> "before-window"
                event.timeStamp < sinceMillis -> "near-stop"
                else -> "candidate"
            }
            if (!isForegroundEvent(event.eventType)) {
                continue
            }

            when (reason) {
                "self" -> {
                    if (event.timeStamp > latestSelfTimestamp) {
                        latestSelfTimestamp = event.timeStamp
                    }
                }
                "candidate" -> {
                    if (event.timeStamp >= latestTimestampAfterStop) {
                        latestPackageNameAfterStop = packageName
                        latestTimestampAfterStop = event.timeStamp
                    }
                }
                "near-stop" -> {
                    if (event.timeStamp >= latestTimestampNearStop) {
                        latestPackageNameNearStop = packageName
                        latestTimestampNearStop = event.timeStamp
                    }
                }
            }
        }

        if (latestPackageNameNearStop != null && latestTimestampNearStop < latestSelfTimestamp) {
            latestPackageNameNearStop = null
            latestTimestampNearStop = 0L
        }

        val eventPackageName = latestPackageNameAfterStop ?: latestPackageNameNearStop
        val eventTimestamp = if (latestPackageNameAfterStop != null) {
            latestTimestampAfterStop
        } else {
            latestTimestampNearStop
        }

        if (eventPackageName != null) {
            return ForegroundAppInfo(
                packageName = eventPackageName,
                label = resolveAppLabel(eventPackageName),
                timestamp = eventTimestamp
            )
        }

        val effectiveStartMillis = if (latestSelfTimestamp > 0) latestSelfTimestamp else queryStartMillis
        val statsFallback = findLatestUsageStatsApp(
            usageStatsManager = usageStatsManager,
            queryStartMillis = effectiveStartMillis,
            untilMillis = untilMillis,
            launcherPackages = launcherPackages
        )
        if (statsFallback != null) return statsFallback

        Log.d(TAG, "No foreground app found.")
        return null
    }

    /**
     * 一次性统计多个已结束会话中的外部 AI 前台时长。
     *
     * UsageStats queryEvents 只调用一次，随后在内存中把同一批前台区间归属到各个
     * 会话。未授权或系统查询异常时，每个会话返回 null；已授权但没有重叠区间时返回 0。
     */
    fun externalAppForegroundSecondsBetween(
        sessions: List<StudySessionEntity>,
        targetPackages: Set<String>
    ): Map<Long, Long?> {
        val result = sessions.associate { it.id to (null as Long?) }.toMutableMap()
        val completed = sessions.filter { session ->
            val endTime = session.endTime
            endTime != null && endTime > session.startTime
        }
        if (completed.isEmpty() || targetPackages.isEmpty()) return result
        if (!runCatching { hasUsageAccess() }.getOrDefault(false)) return result

        return runCatching {
            val queryStartMillis = (completed.minOf { it.startTime } - LOOKBACK_PADDING_MS).coerceAtLeast(0L)
            val queryEndMillis = completed.maxOf { requireNotNull(it.endTime) }
            val usageStatsManager = context.getSystemService(UsageStatsManager::class.java)
            val events = usageStatsManager.queryEvents(queryStartMillis, queryEndMillis)
            val event = UsageEvents.Event()
            val resumedAt = mutableMapOf<String, Long>()
            val intervals = mutableListOf<UsageInterval>()

            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                val packageName = event.packageName ?: continue
                if (packageName !in targetPackages) continue
                when (event.eventType) {
                    UsageEvents.Event.ACTIVITY_RESUMED -> {
                        // 重复 RESUME 不覆盖更早的开始时间。
                        resumedAt.putIfAbsent(packageName, event.timeStamp)
                    }
                    UsageEvents.Event.ACTIVITY_PAUSED,
                    UsageEvents.Event.ACTIVITY_STOPPED -> {
                        val start = resumedAt.remove(packageName) ?: continue
                        val end = event.timeStamp.coerceAtMost(queryEndMillis)
                        if (end > start) {
                            intervals += UsageInterval(packageName, start, end)
                        }
                    }
                    else -> Unit
                }
            }
            // 查询窗口结束时仍在前台的区间，按窗口末端截断。
            resumedAt.forEach { (packageName, start) ->
                if (queryEndMillis > start) {
                    intervals += UsageInterval(packageName, start, queryEndMillis)
                }
            }

            result += attributeUsageSecondsBySession(completed, intervals)
            result
        }.getOrDefault(result)
    }

    private fun findLatestUsageStatsApp(
        usageStatsManager: UsageStatsManager,
        queryStartMillis: Long,
        untilMillis: Long,
        launcherPackages: Set<String>
    ): ForegroundAppInfo? {
        val stats = usageStatsManager.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY,
            queryStartMillis,
            untilMillis
        )
        val latest = stats
            .asSequence()
            .mapNotNull { usageStats ->
                val packageName = usageStats.packageName ?: return@mapNotNull null
                if (packageName == context.packageName || packageName in launcherPackages || packageName in IGNORED_PACKAGES) {
                    return@mapNotNull null
                }

                val timestamp = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    maxOf(usageStats.lastTimeUsed, usageStats.lastTimeVisible)
                } else {
                    usageStats.lastTimeUsed
                }
                if (timestamp < queryStartMillis || timestamp > untilMillis) {
                    return@mapNotNull null
                }

                packageName to timestamp
            }
            .maxByOrNull { (_, timestamp) -> timestamp }
            ?: return null

        Log.d(TAG, "Usage stats fallback found a foreground app.")
        return ForegroundAppInfo(
            packageName = latest.first,
            label = resolveAppLabel(latest.first),
            timestamp = latest.second
        )
    }

    private fun isForegroundEvent(eventType: Int): Boolean {
        return eventType == UsageEvents.Event.MOVE_TO_FOREGROUND ||
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                eventType == UsageEvents.Event.ACTIVITY_RESUMED)
    }

    private fun launcherPackages(): Set<String> {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val packageManager = context.packageManager
        val launchers = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.queryIntentActivities(
                intent,
                PackageManager.ResolveInfoFlags.of(0)
            )
        } else {
            @Suppress("DEPRECATION")
            packageManager.queryIntentActivities(intent, 0)
        }
        return launchers.mapNotNullTo(mutableSetOf()) { it.activityInfo?.packageName }
    }

    private fun resolveAppLabel(packageName: String): String {
        return runCatching {
            val packageManager = context.packageManager
            val appInfo: ApplicationInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getApplicationInfo(
                    packageName,
                    android.content.pm.PackageManager.ApplicationInfoFlags.of(0)
                )
            } else {
                @Suppress("DEPRECATION")
                packageManager.getApplicationInfo(packageName, 0)
            }
            packageManager.getApplicationLabel(appInfo).toString()
        }.getOrDefault(packageName)
    }

    private companion object {
        const val TAG = "AlertTimeDistraction"
        const val LOOKBACK_PADDING_MS = 300_000L
        val IGNORED_PACKAGES = setOf("com.miui.securitycenter", "com.android.systemui")
    }
}

/** 内置的外部 AI 目标 App 包名（与 AndroidManifest queries 声明一致）。 */
val DEFAULT_AI_PACKAGES: Set<String> = setOf(
    "com.google.android.apps.bard", // Gemini
    "com.openai.chatgpt" // ChatGPT
)

/**
 * 外部 AI App 时长统计的同步适配器：按会话区间（startTime..endTime）统计目标 App
 * 前台秒数。进行中会话（endTime 为空）不统计（返回 null）；未授权 UsageStats 返回 null。
 */
class AppUsageExternalAiReader(
    private val appUsageReader: AppUsageReader,
    private val targetPackages: Set<String> = DEFAULT_AI_PACKAGES
) : ExternalAiUsageReader {
    override fun externalAiAppSecondsForCompleted(
        sessions: List<StudySessionEntity>
    ): Map<Long, Long?> = appUsageReader.externalAppForegroundSecondsBetween(sessions, targetPackages)
}

/** 一个系统 UsageStats 扫描得到的、可被多个学习会话复用的前台区间。 */
data class UsageInterval(
    val packageName: String,
    val startMillis: Long,
    val endMillis: Long
)

/**
 * 将已经扫描出的外部 AI 前台区间归属到会话，保持会话间隔互不串数据。
 * 这是纯内存函数，便于验证单次系统扫描后的多会话区间边界。
 */
fun attributeUsageSecondsBySession(
    sessions: List<StudySessionEntity>,
    intervals: List<UsageInterval>
): Map<Long, Long> = sessions.associate { session ->
    val endTime = session.endTime
    val totalMillis = if (endTime == null || endTime <= session.startTime) {
        0L
    } else {
        intervals.sumOf { interval ->
            val overlapStart = maxOf(session.startTime, interval.startMillis)
            val overlapEnd = minOf(endTime, interval.endMillis)
            (overlapEnd - overlapStart).coerceAtLeast(0L)
        }
    }
    session.id to (totalMillis / 1000).coerceAtLeast(0L)
}
