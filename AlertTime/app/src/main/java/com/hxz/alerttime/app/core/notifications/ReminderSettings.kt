package com.hxz.alerttime.app.core.notifications

import java.time.Instant
import java.time.ZoneId
import java.time.Duration

data class ReminderSettings(
    val planRemindersEnabled: Boolean = true,
    val weeklyGoalRemindersEnabled: Boolean = true,
    val awayReminderEnabled: Boolean = true,
    val manualPauseReminderEnabled: Boolean = true,
    val aiPauseReminderEnabled: Boolean = true,
    val awayMinutes: Int = 10,
    val manualPauseMinutes: Int = 20,
    val aiPauseMinutes: Int = 30,
    val dailyReminderHour: Int = 20,
    val quietStartMinuteOfDay: Int = 22 * 60 + 30,
    val quietEndMinuteOfDay: Int = 8 * 60
) {
    fun encode(): String {
        return listOf(
            "plan=${planRemindersEnabled.asInt()}",
            "weekly=${weeklyGoalRemindersEnabled.asInt()}",
            "away=${awayReminderEnabled.asInt()}",
            "pause=${manualPauseReminderEnabled.asInt()}",
            "ai=${aiPauseReminderEnabled.asInt()}",
            "awayMinutes=$awayMinutes",
            "pauseMinutes=$manualPauseMinutes",
            "aiMinutes=$aiPauseMinutes",
            "dailyHour=$dailyReminderHour",
            "quietStart=$quietStartMinuteOfDay",
            "quietEnd=$quietEndMinuteOfDay"
        ).joinToString(";")
    }

    fun normalized(): ReminderSettings {
        return copy(
            awayMinutes = awayMinutes.coerceIn(1, 180),
            manualPauseMinutes = manualPauseMinutes.coerceIn(1, 180),
            aiPauseMinutes = aiPauseMinutes.coerceIn(1, 180),
            dailyReminderHour = dailyReminderHour.coerceIn(0, 23),
            quietStartMinuteOfDay = quietStartMinuteOfDay.coerceIn(0, 1439),
            quietEndMinuteOfDay = quietEndMinuteOfDay.coerceIn(0, 1439)
        )
    }

    fun isQuietTime(
        millis: Long = System.currentTimeMillis(),
        zoneId: ZoneId = ZoneId.systemDefault()
    ): Boolean {
        val localTime = Instant.ofEpochMilli(millis).atZone(zoneId).toLocalTime()
        val minuteOfDay = localTime.hour * 60 + localTime.minute
        if (quietStartMinuteOfDay == quietEndMinuteOfDay) return false
        return if (quietStartMinuteOfDay < quietEndMinuteOfDay) {
            minuteOfDay in quietStartMinuteOfDay until quietEndMinuteOfDay
        } else {
            minuteOfDay >= quietStartMinuteOfDay || minuteOfDay < quietEndMinuteOfDay
        }
    }

    fun millisUntilQuietTimeEnds(
        millis: Long = System.currentTimeMillis(),
        zoneId: ZoneId = ZoneId.systemDefault()
    ): Long {
        if (!isQuietTime(millis, zoneId)) return 0
        val now = Instant.ofEpochMilli(millis).atZone(zoneId)
        val endTime = java.time.LocalTime.of(
            quietEndMinuteOfDay / 60,
            quietEndMinuteOfDay % 60
        )
        var end = now.toLocalDate().atTime(endTime).atZone(zoneId)
        if (!end.isAfter(now)) end = end.plusDays(1)
        return Duration.between(now, end).toMillis().coerceAtLeast(0)
    }

    companion object {
        const val SETTING_KEY = "reminder_settings_v1"

        fun decode(value: String?): ReminderSettings {
            if (value.isNullOrBlank()) return ReminderSettings()
            val values = value.split(';')
                .mapNotNull { entry ->
                    val separator = entry.indexOf('=')
                    if (separator <= 0) null
                    else entry.substring(0, separator) to entry.substring(separator + 1)
                }
                .toMap()
            fun bool(key: String, fallback: Boolean) =
                values[key]?.toIntOrNull()?.let { it != 0 } ?: fallback
            fun int(key: String, fallback: Int) = values[key]?.toIntOrNull() ?: fallback
            val defaults = ReminderSettings()
            return ReminderSettings(
                planRemindersEnabled = bool("plan", defaults.planRemindersEnabled),
                weeklyGoalRemindersEnabled = bool("weekly", defaults.weeklyGoalRemindersEnabled),
                awayReminderEnabled = bool("away", defaults.awayReminderEnabled),
                manualPauseReminderEnabled = bool("pause", defaults.manualPauseReminderEnabled),
                aiPauseReminderEnabled = bool("ai", defaults.aiPauseReminderEnabled),
                awayMinutes = int("awayMinutes", defaults.awayMinutes),
                manualPauseMinutes = int("pauseMinutes", defaults.manualPauseMinutes),
                aiPauseMinutes = int("aiMinutes", defaults.aiPauseMinutes),
                dailyReminderHour = int("dailyHour", defaults.dailyReminderHour),
                quietStartMinuteOfDay = int("quietStart", defaults.quietStartMinuteOfDay),
                quietEndMinuteOfDay = int("quietEnd", defaults.quietEndMinuteOfDay)
            ).normalized()
        }
    }
}

private fun Boolean.asInt(): Int = if (this) 1 else 0
